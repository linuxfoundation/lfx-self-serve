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
import { getRegistrantAttendanceStatus } from './rsvp-calculator.util';

/**
 * Orders a meeting's invitees for the attendee avatar grid and counts them per status.
 * @description Upcoming people take their status from the registrant's RSVP, else the calendar invite answer; past people
 * from the participant's attendance.
 * People are ordered by status, then by name A–Z.
 */
export function buildMeetingAttendeeGrid(people: readonly (MeetingRegistrant | PastMeetingParticipant)[], past: boolean): MeetingAttendeeGrid {
  const rank = (status: MeetingAttendeeStatus): number => MEETING_ATTENDEE_STATUS_ORDER.indexOf(status);
  const list = people
    .map((person): MeetingAttendeeGridPerson => {
      const name = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.username || 'Guest';
      const status = getMeetingAttendeeStatus(person, past);
      return { id: person.uid, name, avatarUrl: person.avatar_url ?? '', status, label: `${name} · ${MEETING_ATTENDEE_STATUS_INFO[status].label}` };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'en'));
  const stats = MEETING_ATTENDEE_STATUS_ORDER.map((status) => ({
    status,
    label: MEETING_ATTENDEE_STATUS_INFO[status].label,
    count: list.filter((person) => person.status === status).length,
  })).filter((stat) => stat.count > 0);
  return { people: list, stats };
}

/** How many of `total` people a grid of `columns` (a whole count of at least 1) shows within its row cap, and whether more are hidden. */
export function getMeetingAttendeeGridOverflow(total: number, columns: number): MeetingAttendeeGridOverflow {
  const capacity = columns * MEETING_ATTENDEE_GRID_MAX_ROWS;
  return { visible: Math.min(total, capacity), more: total > capacity };
}

function getMeetingAttendeeStatus(person: MeetingRegistrant | PastMeetingParticipant, past: boolean): MeetingAttendeeStatus {
  if (past) return 'is_attended' in person && person.is_attended ? 'attended' : 'absent';
  const status = 'is_attended' in person ? 'pending' : getRegistrantAttendanceStatus(person);
  return status === 'pending' ? 'no_response' : MEETING_ATTENDEE_RSVP_STATUS[status];
}
