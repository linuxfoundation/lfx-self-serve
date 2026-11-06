// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_ATTENDEE_GRID_MAX_ROWS, MEETING_ATTENDEE_RSVP_STATUS, MEETING_ATTENDEE_STATUS_INFO, MEETING_ATTENDEE_STATUS_ORDER } from '../constants';
import type {
  MeetingAttendeeGrid,
  MeetingAttendeeGridOverflow,
  MeetingAttendeeGridPerson,
  MeetingAttendeeStatus,
  MeetingRegistrant,
  PastMeetingParticipant,
} from '../interfaces';

/**
 * Orders a meeting's invitees for the attendee avatar grid and counts them per status.
 * @description Upcoming people take their status from the registrant's RSVP, past people from the participant's attendance.
 * People are ordered by status, then by name A–Z.
 */
export function buildMeetingAttendeeGrid(people: readonly (MeetingRegistrant | PastMeetingParticipant)[], past: boolean): MeetingAttendeeGrid {
  const rank = (status: MeetingAttendeeStatus): number => MEETING_ATTENDEE_STATUS_ORDER.indexOf(status);
  const list = people
    .map((person): MeetingAttendeeGridPerson => {
      const name = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email;
      const status = getMeetingAttendeeStatus(person, past);
      return { id: person.uid, name, avatarUrl: person.avatar_url ?? '', status, label: `${name} · ${MEETING_ATTENDEE_STATUS_INFO[status].label}` };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  const stats = MEETING_ATTENDEE_STATUS_ORDER.map((status) => ({
    status,
    label: MEETING_ATTENDEE_STATUS_INFO[status].label,
    count: list.filter((person) => person.status === status).length,
  })).filter((stat) => stat.count > 0);
  return { people: list, stats };
}

/** How many of `total` people a grid of `columns` shows within its row cap, and whether more are hidden. */
export function getMeetingAttendeeGridOverflow(total: number, columns: number): MeetingAttendeeGridOverflow {
  const capacity = Math.max(1, Math.floor(columns)) * MEETING_ATTENDEE_GRID_MAX_ROWS;
  return { visible: Math.min(total, capacity), more: total > capacity };
}

function getMeetingAttendeeStatus(person: MeetingRegistrant | PastMeetingParticipant, past: boolean): MeetingAttendeeStatus {
  if (past) return 'is_attended' in person && person.is_attended ? 'attended' : 'absent';
  const response = 'rsvp' in person ? person.rsvp?.response_type : undefined;
  return response ? MEETING_ATTENDEE_RSVP_STATUS[response] : 'no_response';
}
