// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingRegistrant, MeetingRsvp, PastMeetingParticipant, RsvpResponse } from '../interfaces';
import { buildMeetingAttendeeGrid, getMeetingAttendeeGridOverflow } from './meeting-attendee-grid.utils';

function rsvp(uid: string, response: RsvpResponse): MeetingRsvp {
  return {
    id: `rsvp-${uid}`,
    meeting_id: 'm-1',
    registrant_id: uid,
    username: '',
    email: `${uid}@example.org`,
    response_type: response,
    scope: 'all',
    created_at: '',
  };
}

function registrant(uid: string, first: string, last: string, response: RsvpResponse | null, avatar: string | null = null): MeetingRegistrant {
  return {
    uid,
    meeting_id: 'm-1',
    email: `${uid}@example.org`,
    first_name: first,
    last_name: last,
    host: false,
    job_title: null,
    org_name: null,
    occurrence_id: null,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: avatar,
    username: null,
    linkedin_profile: null,
    created_at: '',
    updated_at: '',
    type: 'direct',
    invite_accepted: null,
    attended: null,
    rsvp: response ? rsvp(uid, response) : null,
  };
}

function participant(uid: string, first: string, attended: boolean): PastMeetingParticipant {
  return {
    uid,
    meeting_id: 'm-1',
    meeting_and_occurrence_id: 'm-1',
    past_meeting_id: 'pm-1',
    email: `${uid}@example.org`,
    first_name: first,
    last_name: 'Doe',
    host: false,
    is_attended: attended,
    is_invited: true,
    org_is_member: false,
    org_is_project_member: false,
    created_at: '',
    updated_at: '',
  };
}

describe('buildMeetingAttendeeGrid', () => {
  it('orders upcoming people Yes, Maybe, No, No response and by name inside a status', () => {
    const grid = buildMeetingAttendeeGrid(
      [
        registrant('1', 'Zoe', 'A', null),
        registrant('2', 'Bob', 'B', 'declined'),
        registrant('3', 'Cara', 'C', 'accepted'),
        registrant('4', 'Ana', 'D', 'maybe'),
        registrant('5', 'Ada', 'E', 'accepted'),
      ],
      false
    );

    expect(grid.people.map((person) => [person.name, person.status])).toEqual([
      ['Ada E', 'yes'],
      ['Cara C', 'yes'],
      ['Ana D', 'maybe'],
      ['Bob B', 'no'],
      ['Zoe A', 'no_response'],
    ]);
    expect(grid.stats).toEqual([
      { status: 'yes', label: 'Yes', count: 2 },
      { status: 'maybe', label: 'Maybe', count: 1 },
      { status: 'no', label: 'No', count: 1 },
      { status: 'no_response', label: 'No response', count: 1 },
    ]);
  });

  it('falls back to the calendar invite answer when there is no RSVP, and lets an RSVP win over it', () => {
    const { rsvp: _omitted, ...noRsvpKey } = { ...registrant('4', 'Di', 'D', null), invite_accepted: true };
    const grid = buildMeetingAttendeeGrid(
      [
        noRsvpKey,
        { ...registrant('1', 'Ada', 'A', null), invite_accepted: true },
        { ...registrant('2', 'Bob', 'B', null), invite_accepted: false },
        { ...registrant('3', 'Cy', 'C', 'maybe'), invite_accepted: true },
      ],
      false
    );

    expect(grid.people.map((person) => [person.name, person.status])).toEqual([
      ['Ada A', 'yes'],
      ['Di D', 'yes'],
      ['Cy C', 'maybe'],
      ['Bob B', 'no'],
    ]);
  });

  it('orders past people Attended then Absent and skips empty statuses in the stats', () => {
    const grid = buildMeetingAttendeeGrid([participant('1', 'Bea', false), participant('2', 'Al', true), participant('3', 'Cy', true)], true);

    expect(grid.people.map((person) => person.status)).toEqual(['attended', 'attended', 'absent']);
    expect(grid.stats).toEqual([
      { status: 'attended', label: 'Attended', count: 2 },
      { status: 'absent', label: 'Absent', count: 1 },
    ]);
    expect(buildMeetingAttendeeGrid([participant('1', 'Bea', true)], true).stats).toEqual([{ status: 'attended', label: 'Attended', count: 1 }]);
  });

  it('builds the tooltip label and the photo, and never falls back to the email for a blank name', () => {
    const withUsername = { ...registrant('3', '', '', null), username: 'jdoe' };
    const [named, blank, handle] = buildMeetingAttendeeGrid(
      [registrant('1', 'Ada', 'Lovelace', 'accepted', 'https://img/1.png'), registrant('2', ' ', '', null), withUsername],
      false
    ).people;

    expect(named).toEqual({ id: '1', name: 'Ada Lovelace', avatarUrl: 'https://img/1.png', status: 'yes', label: 'Ada Lovelace · Yes' });
    expect(blank).toMatchObject({ name: 'Guest', avatarUrl: '', label: 'Guest · No response' });
    expect(handle).toMatchObject({ name: 'jdoe', label: 'jdoe · No response' });
  });

  it('returns an empty grid for no people', () => {
    expect(buildMeetingAttendeeGrid([], false)).toEqual({ people: [], stats: [] });
  });
});

describe('getMeetingAttendeeGridOverflow', () => {
  it('shows everyone when the people fit in two rows, even exactly full', () => {
    expect(getMeetingAttendeeGridOverflow(13, 9)).toEqual({ visible: 13, more: false });
    expect(getMeetingAttendeeGridOverflow(18, 9)).toEqual({ visible: 18, more: false });
    expect(getMeetingAttendeeGridOverflow(0, 8)).toEqual({ visible: 0, more: false });
  });

  it('caps at two rows and flags more people', () => {
    expect(getMeetingAttendeeGridOverflow(19, 9)).toEqual({ visible: 18, more: true });
    expect(getMeetingAttendeeGridOverflow(40, 8)).toEqual({ visible: 16, more: true });
  });
});
