// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_PEOPLE_ATTENDANCE_ORDER } from '../constants/meeting.constants';
import type { MeetingPeopleRow, MeetingPeopleRowOptions, MeetingPeopleTallies, MeetingRegistrant } from '../interfaces';
import { getRegistrantAttendanceStatus } from './rsvp-calculator.util';

/**
 * Maps an upcoming meeting's registrants to the people section's rows (E3-04, FR-032).
 * @description Organizers first, then by RSVP (accepted, maybe, pending, declined) when tracking is
 * on, then by name. Each row's RSVP is the combined RSVP / `invite_accepted` status the V1 guest
 * drawer chips show ({@link getRegistrantAttendanceStatus}), and `null` when the meeting predates
 * invite responses, because then no RSVP UI renders at all.
 */
export function buildMeetingPeopleRows(registrants: ReadonlyArray<MeetingRegistrant>, options: MeetingPeopleRowOptions): MeetingPeopleRow[] {
  return (
    registrants
      .map((registrant): MeetingPeopleRow => {
        let attendance: MeetingPeopleRow['attendance'] = null;
        if (options.inviteResponsesEnabled) {
          attendance =
            options.viewerRsvp && isViewerRegistrant(registrant, options.viewer)
              ? options.viewerRsvp
              : getRegistrantAttendanceStatus(registrant, { inviteResponsesEnabled: true });
        }
        return {
          uid: registrant.uid,
          name: getMeetingRegistrantDisplayName(registrant),
          role: formatMeetingRegistrantRole(registrant),
          avatarUrl: registrant.avatar_url || null,
          organizer: registrant.host === true,
          attendance,
          invitation: registrant.type === 'committee' ? 'committee' : 'direct',
        };
      })
      // The locale is pinned so the server and the browser (and every viewer) order names alike.
      .sort((a, b) => rowRank(a) - rowRank(b) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  );
}

/** The people section's RSVP tallies over its rows; all zero when RSVP tracking is off. */
export function countMeetingPeopleTallies(rows: ReadonlyArray<MeetingPeopleRow>): MeetingPeopleTallies {
  const tallies: MeetingPeopleTallies = { accepted: 0, maybe: 0, declined: 0, pending: 0 };
  for (const row of rows) {
    if (row.attendance) {
      tallies[row.attendance]++;
    }
  }
  return tallies;
}

/** A registrant's name: first and last name, else the username, else the email, as V1's preview reads it. */
export function getMeetingRegistrantDisplayName(registrant: Pick<MeetingRegistrant, 'first_name' | 'last_name' | 'username' | 'email'>): string {
  const fullName = `${registrant.first_name ?? ''} ${registrant.last_name ?? ''}`.trim();
  return fullName || registrant.username?.trim() || registrant.email;
}

/** "job title · organization", whichever of the two exist; `null` when neither does. */
export function formatMeetingRegistrantRole(registrant: Pick<MeetingRegistrant, 'job_title' | 'org_name'>): string | null {
  const parts = [registrant.job_title, registrant.org_name].map((part) => part?.trim()).filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : null;
}

function rowRank(row: MeetingPeopleRow): number {
  if (row.organizer) {
    return -1;
  }
  return row.attendance ? MEETING_PEOPLE_ATTENDANCE_ORDER[row.attendance] : 0;
}

function isViewerRegistrant(registrant: Pick<MeetingRegistrant, 'username' | 'email'>, viewer: MeetingPeopleRowOptions['viewer']): boolean {
  const username = viewer?.username?.toLowerCase();
  const email = viewer?.email?.toLowerCase();
  return (!!username && registrant.username?.toLowerCase() === username) || (!!email && registrant.email?.toLowerCase() === email);
}
