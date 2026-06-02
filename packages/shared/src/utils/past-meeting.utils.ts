// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnrichedPastMeetingParticipant, PastParticipantFilters } from '../interfaces';

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
