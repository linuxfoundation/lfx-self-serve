// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEETING_RECORDING_MEDIA_FILE_TYPES,
  MEETING_RECORDING_SESSION_TOLERANCE_MS,
  PAST_MEETING_ATTENDANCE_RATE_THRESHOLDS,
  PAST_MEETING_IDENTITY_TIER_LABELS,
  PAST_MEETING_IDENTITY_UNKNOWN_LABEL,
  PAST_MEETING_NOTETAKER_BOT_LABEL,
  RECONCILIATION_BOT_NAME_PATTERN,
} from '../constants/meeting.constants';
import {
  EnrichedPastMeetingParticipant,
  Meeting,
  PastMeeting,
  PastMeetingAttendanceCounts,
  PastMeetingAttendanceFigures,
  PastMeetingAttendanceTone,
  PastMeetingIdentityNames,
  PastMeetingIdentityTier,
  PastMeetingParticipant,
  PastMeetingParticipantRow,
  PastMeetingRecording,
  PastParticipantFilters,
  PastRosterAttendanceFilter,
  PastRosterInvitationFilter,
  PublicPastMeetingParticipant,
  RecordingSession,
} from '../interfaces';
import { firstValidTimestampMs } from './iso-timestamp.utils';

// scheduled_start_time can be absent or a Go zero-date depending on the row's source — fall back to
// start_time. (For rows sourced from the v1_past_meeting query-service index specifically,
// scheduled_start_time is verified always absent, never just zero-dated — see the "Meetings"
// paragraph in apps/lfx-one/src/server/services/committee-activity.service.ts's fetchSize comment.
// This function is shared across callers beyond that one leg, so it stays defensive here rather
// than assuming every caller's data shares that same guarantee.)
export function getPastMeetingStartTimeMs(meeting: Pick<PastMeeting, 'scheduled_start_time' | 'start_time'>): number | null {
  return firstValidTimestampMs(meeting.scheduled_start_time, meeting.start_time);
}

/**
 * The largest recording session (by total_size), the canonical one: the one Watch recording opens and
 * the one its length is measured on. The first wins a tie.
 */
export function getLargestRecordingSession(recording: PastMeetingRecording | null | undefined): RecordingSession | null {
  if (!recording?.sessions?.length) {
    return null;
  }
  return recording.sessions.reduce((a, b) => (b.total_size > a.total_size ? b : a));
}

// Largest recording session (by total_size) is canonical; a recording "exists" only if that
// session has a shareable URL. Single source of truth for recording availability.
export function getLargestSessionShareUrl(recording: PastMeetingRecording | null): string | null {
  return getLargestRecordingSession(recording)?.share_url || null;
}

/**
 * The length in seconds of the session `getLargestSessionShareUrl` opens (E4-02, #3256): the total
 * time its media files (MP4 / M4A) cover.
 * @description Sessions carry a start but no end, and files carry no session id, so a file belongs to
 * the session whose start is the latest one at or before the file's own start (allowing
 * `MEETING_RECORDING_SESSION_TOLERANCE_MS`). A multi-session recording therefore measures only the
 * linked (largest) session, never the sum of all of them. Within it, the files' intervals are merged
 * and summed: views of the same span (speaker, gallery, audio) count once, and a gap where the host
 * stopped and restarted recording does not count. `null` rather than a guess when that session has no
 * media file with valid times, when any session start cannot be read, or when the total is zero.
 */
export function getRecordingDurationSeconds(recording: PastMeetingRecording | null | undefined): number | null {
  const largest = getLargestRecordingSession(recording);
  if (!recording || !largest) {
    return null;
  }
  // firstValidTimestampMs, not Date.parse: the upstream converter emits Go's zero time
  // (0001-01-01T00:00:00Z) for a timestamp it could not read, which Date.parse accepts.
  const sessionStarts = recording.sessions.map((session) => firstValidTimestampMs(session.start_time));
  if (sessionStarts.some((start) => start === null)) {
    return null;
  }
  const starts = sessionStarts as number[];
  const largestIndex = recording.sessions.indexOf(largest);

  const intervals: [number, number][] = [];
  for (const file of recording.recording_files ?? []) {
    if (!MEETING_RECORDING_MEDIA_FILE_TYPES.includes((file.file_type ?? '').toUpperCase())) {
      continue;
    }
    const start = firstValidTimestampMs(file.recording_start);
    const end = firstValidTimestampMs(file.recording_end);
    if (start === null || end === null || end <= start || sessionIndexOf(starts, start) !== largestIndex) {
      continue;
    }
    intervals.push([start, end]);
  }

  intervals.sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of intervals) {
    if (current && start <= current[1]) {
      current[1] = Math.max(current[1], end);
    } else {
      if (current) {
        totalMs += current[1] - current[0];
      }
      current = [start, end];
    }
  }
  if (current) {
    totalMs += current[1] - current[0];
  }
  const seconds = Math.round(totalMs / 1000);
  return seconds > 0 ? seconds : null;
}

/**
 * Which session a file starting at `fileStart` belongs to, by index into `sessionStarts`: the session
 * whose start is nearest to it, among those that started no later than
 * `MEETING_RECORDING_SESSION_TOLERANCE_MS` after it. A file usually opens at or just after its
 * session's start, sometimes a moment before (the two come from different sources), so the nearest
 * start wins either way, and sessions starting close together each keep their own files. `-1` when
 * no session qualifies.
 */
function sessionIndexOf(sessionStarts: number[], fileStart: number): number {
  let index = -1;
  sessionStarts.forEach((start, i) => {
    if (start - fileStart > MEETING_RECORDING_SESSION_TOLERANCE_MS) {
      return;
    }
    if (index === -1 || Math.abs(start - fileStart) < Math.abs(sessionStarts[index] - fileStart)) {
      index = i;
    }
  });
  return index;
}

/** A recording length as the prototype shows it: `m:ss` under an hour, `h:mm:ss` from an hour. */
export function formatRecordingDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/**
 * A recording length for a screen reader ("58 minutes 24 seconds"), which can read `58:24` as a time
 * of day. Zero parts are left out; `null` like `formatRecordingDuration`.
 */
export function formatRecordingDurationSpoken(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  const parts: [number, string][] = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor((total % 3600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  const spoken = parts.filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`);
  return spoken.length ? spoken.join(' ') : '0 seconds';
}

// Past-meeting sub-resources are keyed by meeting_and_occurrence_id; project-scoped lists may
// still expose a distinct id while Me-lens rows normalize id to the composite value.
export function getPastMeetingResourceId(meeting: Pick<PastMeeting, 'id' | 'meeting_and_occurrence_id'>): string {
  return meeting.meeting_and_occurrence_id ?? meeting.id;
}

/**
 * An attendee's identity tier (N-02, FR-033), or null for someone who did not attend. The flags are not
 * exclusive: reconciliation sets `is_verified` on every match it makes, automatic or AI, so they are
 * read in order. Left unknown, or never verified: `unverified`. Then how the match was made: an AI
 * suggestion an organizer confirmed, then the automatic exact email or username match. A match with
 * neither flag is `verified`.
 */
export function getPastMeetingIdentityTier(
  participant: Pick<PastMeetingParticipant, 'is_attended' | 'is_verified' | 'is_unknown' | 'is_ai_reconciled' | 'is_auto_matched'>
): PastMeetingIdentityTier | null {
  if (!participant.is_attended) {
    return null;
  }
  if (participant.is_unknown || !participant.is_verified) {
    return 'unverified';
  }
  if (participant.is_ai_reconciled) {
    return 'ai-reconciled';
  }
  return participant.is_auto_matched ? 'auto-matched' : 'verified';
}

/**
 * The names behind an attendee's row besides the first and last name it shows (N-02, FR-033): the
 * Zoom display name they joined as, and the invitee reconciliation matched them to, each only where
 * it differs (ignoring case and spacing) from the name shown.
 */
export function getPastMeetingIdentityNames(
  participant: Pick<PastMeetingParticipant, 'first_name' | 'last_name' | 'zoom_user_name' | 'mapped_invitee_name'>
): PastMeetingIdentityNames {
  const normalise = (name: string | null | undefined): string => (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const shown = normalise([participant.first_name, participant.last_name].filter(Boolean).join(' '));
  const unlessShown = (name: string | null | undefined): string | null => {
    const value = normalise(name);
    return value && value !== shown ? (name ?? '').trim() : null;
  };
  return { joinedAs: unlessShown(participant.zoom_user_name), matchedTo: unlessShown(participant.mapped_invitee_name) };
}

/**
 * An admin participant-list row (N-02): the participant with its identity tier, the tier's label
 * (`PAST_MEETING_IDENTITY_TIER_LABELS`, or `PAST_MEETING_IDENTITY_UNKNOWN_LABEL` for an unverified
 * attendee left unknown), and the names behind the row. An attending notetaker bot gets
 * `PAST_MEETING_NOTETAKER_BOT_LABEL` and no tier, whatever its flags.
 */
export function toPastMeetingParticipantRow(participant: EnrichedPastMeetingParticipant): PastMeetingParticipantRow {
  const identity_names = getPastMeetingIdentityNames(participant);
  const tier = getPastMeetingIdentityTier(participant);
  // A bot is labelled a bot, with no tier, whatever its flags (#2253): reconciliation never queues
  // one now, but records reconciled before that can carry a match, and the public roster hides every bot.
  if (tier && isPastMeetingNotetakerBot(participant)) {
    return { ...participant, identity_tier: null, identity_label: PAST_MEETING_NOTETAKER_BOT_LABEL, identity_names, is_notetaker_bot: true };
  }
  let label: string | null = null;
  if (tier) {
    label = tier === 'unverified' && participant.is_unknown ? PAST_MEETING_IDENTITY_UNKNOWN_LABEL : PAST_MEETING_IDENTITY_TIER_LABELS[tier];
  }
  return { ...participant, identity_tier: tier, identity_label: label, identity_names, is_notetaker_bot: false };
}

/**
 * Whether an attendee is a notetaker or recording bot (#2253): its Zoom display name, else its first and
 * last name, matches `RECONCILIATION_BOT_NAME_PATTERN`. Reconciliation never queues one, so it is left
 * out of the unverified count rather than waiting for a review that never comes.
 */
export function isPastMeetingNotetakerBot(participant: Partial<Pick<PastMeetingParticipant, 'first_name' | 'last_name' | 'zoom_user_name'>>): boolean {
  const name = participant.zoom_user_name || [participant.first_name, participant.last_name].filter(Boolean).join(' ');
  return RECONCILIATION_BOT_NAME_PATTERN.test(name.trim());
}

/**
 * An attendee in the `unverified` tier who is not a notetaker bot (N-02): someone nobody has
 * identified. Reconciliation never queues a bot, so a bot is neither listed nor counted as one.
 */
export function isPastMeetingUnverifiedAttendee(
  participant: Pick<PastMeetingParticipant, 'is_attended'> &
    Partial<Pick<PastMeetingParticipant, 'is_verified' | 'is_unknown' | 'is_ai_reconciled' | 'is_auto_matched' | 'first_name' | 'last_name' | 'zoom_user_name'>>
): boolean {
  return getPastMeetingIdentityTier(participant) === 'unverified' && !isPastMeetingNotetakerBot(participant);
}

/** Past-meeting list rows carry scheduled_start_time and/or past-only identity fields. */
export function isPastMeetingCalendarRow(meeting: Meeting | PastMeeting): meeting is PastMeeting {
  const row = meeting as PastMeeting;
  if (typeof row.scheduled_start_time === 'string') {
    return true;
  }
  if (row.meeting_and_occurrence_id) {
    return true;
  }
  if ('meeting_id' in meeting && typeof row.meeting_id === 'string' && row.meeting_id) {
    return true;
  }
  return false;
}

/**
 * Filters past-meeting participants by search, attendance, invitation, and committee group.
 *
 * The past-meeting guest list reuses the upcoming-registrant filter UI, but past
 * participants carry different fields: they have no RSVP response, only attendance
 * (`is_attended`) and invitation (`is_invited`) flags, plus the committee UIDs attached
 * during enrichment (`committee_uids`). This mirrors the upcoming `initFilteredRegistrants`
 * logic against those fields. Each criterion defaults to "all" when omitted, so a call with
 * no filters returns the full list. A participant on multiple committees matches the group
 * filter for any of them.
 *
 * @param participants - The (optionally enriched) past participants to filter.
 * @param filters - The active filter criteria; any omitted criterion is treated as `all`.
 * @returns The participants matching every active criterion, in input order.
 */
export function filterPastMeetingParticipants(
  participants: EnrichedPastMeetingParticipant[],
  filters: PastParticipantFilters = {}
): EnrichedPastMeetingParticipant[] {
  const query = (filters.search ?? '').toLowerCase().trim();
  const attendance = filters.attendance ?? 'all';
  const invitation = filters.invitation ?? 'all';
  const group = filters.group ?? 'all';

  return participants.filter((participant) => {
    const matchesSearch =
      !query ||
      !!participant.first_name?.toLowerCase().includes(query) ||
      !!participant.last_name?.toLowerCase().includes(query) ||
      !!participant.email?.toLowerCase().includes(query) ||
      !!participant.org_name?.toLowerCase().includes(query);

    let matchesAttendance = true;
    if (attendance === 'attended') {
      matchesAttendance = participant.is_attended === true;
    } else if (attendance === 'absent') {
      matchesAttendance = participant.is_attended === false;
    }

    let matchesInvitation = true;
    if (invitation === 'invited') {
      matchesInvitation = participant.is_invited === true;
    } else if (invitation === 'uninvited') {
      matchesInvitation = participant.is_invited === false;
    }

    const matchesGroup = group === 'all' || (participant.committee_uids?.includes(group) ?? false);

    return matchesSearch && matchesAttendance && matchesInvitation && matchesGroup;
  });
}

/**
 * A past meeting's participant counts (E4-05), as the BFF puts them on the meeting: every record, the
 * ones who attended, the ones who were invited, and the attendees nobody has identified yet (N-02,
 * notetaker bots aside). The one place they are counted.
 */
export function countPastMeetingAttendance(
  participants: (Pick<PastMeetingParticipant, 'is_attended' | 'is_invited'> &
    Partial<
      Pick<PastMeetingParticipant, 'is_verified' | 'is_unknown' | 'is_ai_reconciled' | 'is_auto_matched' | 'first_name' | 'last_name' | 'zoom_user_name'>
    >)[]
): PastMeetingAttendanceCounts {
  return {
    participant_count: participants.length,
    attended_count: participants.filter((participant) => participant.is_attended).length,
    individual_registrants_count: participants.filter((participant) => participant.is_invited).length,
    unverified_attended_count: participants.filter(isPastMeetingUnverifiedAttendee).length,
  };
}

/** The band an attendance rate falls in (`PAST_MEETING_ATTENDANCE_RATE_THRESHOLDS`). */
export function getPastMeetingAttendanceTone(rate: number): PastMeetingAttendanceTone {
  if (rate < PAST_MEETING_ATTENDANCE_RATE_THRESHOLDS.medium) {
    return 'low';
  }
  return rate < PAST_MEETING_ATTENDANCE_RATE_THRESHOLDS.high ? 'medium' : 'high';
}

/**
 * The attendance figures both pages show (E4-05), from the BFF's counts on the meeting. Null when the
 * counts are absent (not loaded, or the read failed), so a page can tell "unknown" from a real zero; a
 * meeting with no participants gives zero figures with no rate.
 */
export function getPastMeetingAttendanceFigures(
  counts: Partial<Pick<PastMeetingAttendanceCounts, 'participant_count' | 'attended_count' | 'unverified_attended_count'>> | null | undefined
): PastMeetingAttendanceFigures | null {
  if (counts?.participant_count == null || counts.attended_count == null) {
    return null;
  }
  const total = counts.participant_count;
  const attended = Math.min(counts.attended_count, total);
  const rate = total > 0 ? Math.round((attended / total) * 100) : null;
  const unverified = counts.unverified_attended_count == null ? null : Math.min(counts.unverified_attended_count, attended);
  return { total, attended, absent: total - attended, rate, tone: rate === null ? null : getPastMeetingAttendanceTone(rate), unverified };
}

/**
 * The public past roster's rows that match the V2 page's two filters (E4-05): invited or not, and
 * attended or absent, each independent of the other.
 */
export function filterPublicPastMeetingRoster(
  participants: PublicPastMeetingParticipant[],
  invitation: PastRosterInvitationFilter,
  attendance: PastRosterAttendanceFilter
): PublicPastMeetingParticipant[] {
  return participants.filter(
    (participant) =>
      (invitation === 'all' || participant.is_invited === (invitation === 'invited')) &&
      (attendance === 'all' || participant.is_attended === (attendance === 'attended'))
  );
}
