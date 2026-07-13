// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnrichedPastMeetingParticipant, PastMeeting, PastMeetingRecording, PastParticipantFilters } from '../interfaces';

const ZERO_DATE_PREFIX = '0001-01-01';

function parsePastMeetingStartIso(iso: string | undefined): number | null {
  if (!iso || iso.startsWith(ZERO_DATE_PREFIX)) {
    return null;
  }
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Zoom/ITX rows sometimes carry a Go zero-date on scheduled_start_time; fall back to start_time.
export function getPastMeetingStartTimeMs(meeting: Pick<PastMeeting, 'scheduled_start_time' | 'start_time'>): number | null {
  return parsePastMeetingStartIso(meeting.scheduled_start_time) ?? parsePastMeetingStartIso(meeting.start_time);
}

// Largest *shareable* session (by total_size) is canonical — a smaller session with a share_url is
// preferred over a larger one without, since the goal is finding a playable URL, not the biggest file.
// Single source of truth for recording availability.
export function getLargestSessionShareUrl(recording: PastMeetingRecording | null): string | null {
  const shareable = recording?.sessions?.filter((session) => session.share_url) ?? [];
  if (shareable.length === 0) {
    return null;
  }
  const largest = shareable.reduce((a, b) => (b.total_size > a.total_size ? b : a));
  return largest.share_url || null;
}

// Past-meeting sub-resources are keyed by meeting_and_occurrence_id; project-scoped lists may
// still expose a distinct id while Me-lens rows normalize id to the composite value.
export function getPastMeetingResourceId(meeting: Pick<PastMeeting, 'id' | 'meeting_and_occurrence_id'>): string {
  return meeting.meeting_and_occurrence_id ?? meeting.id;
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
