// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnrichedPastMeetingParticipant, Meeting, PastMeeting, PastMeetingRecording, PastParticipantFilters } from '../interfaces';
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

// Largest recording session (by total_size) is canonical; a recording "exists" only if that
// session has a shareable URL. Single source of truth for recording availability.
export function getLargestSessionShareUrl(recording: PastMeetingRecording | null): string | null {
  if (!recording?.sessions?.length) {
    return null;
  }
  const largest = recording.sessions.reduce((a, b) => (b.total_size > a.total_size ? b : a));
  return largest.share_url || null;
}

/** Recording file types that carry the meeting's media, as opposed to chat, transcripts or captions. */
const RECORDING_MEDIA_FILE_TYPES = new Set(['MP4', 'M4A']);

/**
 * The length in seconds of the session `getLargestSessionShareUrl` opens (E4-02, #3256): the span from
 * the earliest start to the latest end of that session's media files (MP4 / M4A).
 * @description Sessions carry a start but no end, and files carry no session id, so a file belongs to
 * the session whose start is the latest one at or before the file's own start. A multi-session
 * recording therefore measures only the linked (largest) session, never the sum of all of them.
 * `null` rather than a guess when that session has no media file with valid times.
 */
export function getRecordingDurationSeconds(recording: PastMeetingRecording | null | undefined): number | null {
  if (!recording?.sessions?.length) {
    return null;
  }
  const largest = recording.sessions.reduce((a, b) => (b.total_size > a.total_size ? b : a));
  const sessionStarts = recording.sessions
    .map((session) => Date.parse(session.start_time))
    .filter((start) => Number.isFinite(start))
    .sort((a, b) => a - b);
  const largestStart = Date.parse(largest.start_time);
  if (!Number.isFinite(largestStart)) {
    return null;
  }
  const nextStart = sessionStarts.find((start) => start > largestStart) ?? Number.POSITIVE_INFINITY;

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const file of recording.recording_files ?? []) {
    if (!RECORDING_MEDIA_FILE_TYPES.has((file.file_type ?? '').toUpperCase())) {
      continue;
    }
    const start = Date.parse(file.recording_start);
    const end = Date.parse(file.recording_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < largestStart || start >= nextStart) {
      continue;
    }
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return null;
  }
  return Math.round((latest - earliest) / 1000);
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

// Past-meeting sub-resources are keyed by meeting_and_occurrence_id; project-scoped lists may
// still expose a distinct id while Me-lens rows normalize id to the composite value.
export function getPastMeetingResourceId(meeting: Pick<PastMeeting, 'id' | 'meeting_and_occurrence_id'>): string {
  return meeting.meeting_and_occurrence_id ?? meeting.id;
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
