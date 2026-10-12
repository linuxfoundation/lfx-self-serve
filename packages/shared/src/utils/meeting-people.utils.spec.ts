// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { MeetingRegistrant } from '../interfaces';
import { buildMeetingPeopleRows, countMeetingPeopleTallies, formatMeetingRegistrantRole, getMeetingRegistrantDisplayName } from './meeting-people.utils';

const registrant = (overrides: Partial<MeetingRegistrant>): MeetingRegistrant =>
  ({
    uid: 'r1',
    email: 'r1@vendor-corp.example',
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
    host: false,
    job_title: null,
    org_name: null,
    avatar_url: null,
    type: 'direct',
    invite_accepted: null,
    rsvp: null,
    ...overrides,
  }) as MeetingRegistrant;

describe('buildMeetingPeopleRows', () => {
  it('lists organizers first, then by RSVP, then by name', () => {
    const rows = buildMeetingPeopleRows(
      [
        registrant({ uid: 'declined', first_name: 'Dee', invite_accepted: false }),
        registrant({ uid: 'pending', first_name: 'Pat' }),
        registrant({ uid: 'host', first_name: 'Hal', host: true, invite_accepted: false }),
        registrant({ uid: 'maybe', first_name: 'May', rsvp: { response_type: 'maybe' } as MeetingRegistrant['rsvp'] }),
        registrant({ uid: 'accepted-b', first_name: 'Bea', invite_accepted: true }),
        registrant({ uid: 'accepted-a', first_name: 'Abe', invite_accepted: true }),
      ],
      { inviteResponsesEnabled: true }
    );

    expect(rows.map((row) => row.uid)).toEqual(['host', 'accepted-a', 'accepted-b', 'maybe', 'pending', 'declined']);
    expect(rows.map((row) => row.attendance)).toEqual(['declined', 'accepted', 'accepted', 'maybe', 'pending', 'declined']);
  });

  it('carries no RSVP when the meeting predates invite responses', () => {
    const rows = buildMeetingPeopleRows([registrant({ invite_accepted: true, type: 'committee' })], { inviteResponsesEnabled: false });

    expect(rows[0]).toMatchObject({ attendance: null, invitation: 'committee' });
  });

  it("puts the viewer's own saved answer on their row, ahead of the roster's copy", () => {
    const roster = [
      registrant({ uid: 'me', username: 'Ada', email: 'ADA@vendor-corp.example', invite_accepted: false }),
      registrant({ uid: 'other', username: 'bob', email: 'bob@vendor-corp.example' }),
    ];

    const byUsername = buildMeetingPeopleRows(roster, { inviteResponsesEnabled: true, viewer: { username: 'ada' }, viewerRsvp: 'accepted' });
    expect(byUsername.find((row) => row.uid === 'me')?.attendance).toBe('accepted');
    expect(byUsername.find((row) => row.uid === 'other')?.attendance).toBe('pending');

    const byEmail = buildMeetingPeopleRows(roster, { inviteResponsesEnabled: true, viewer: { email: 'ada@vendor-corp.example' }, viewerRsvp: 'maybe' });
    expect(byEmail.find((row) => row.uid === 'me')?.attendance).toBe('maybe');

    const unknown = buildMeetingPeopleRows(roster, { inviteResponsesEnabled: true, viewer: { username: 'ada' }, viewerRsvp: null });
    expect(unknown.find((row) => row.uid === 'me')?.attendance).toBe('declined');
  });
});

describe('countMeetingPeopleTallies', () => {
  it('tallies each RSVP, with everyone unanswered as pending', () => {
    const rows = buildMeetingPeopleRows(
      [registrant({ uid: 'a', invite_accepted: true }), registrant({ uid: 'b', invite_accepted: false }), registrant({ uid: 'c' }), registrant({ uid: 'd' })],
      { inviteResponsesEnabled: true }
    );

    expect(countMeetingPeopleTallies(rows)).toEqual({ accepted: 1, maybe: 0, declined: 1, pending: 2 });
  });
});

describe('getMeetingRegistrantDisplayName', () => {
  it('falls back from the full name to the username, then the email', () => {
    expect(getMeetingRegistrantDisplayName(registrant({}))).toBe('Ada Lovelace');
    expect(getMeetingRegistrantDisplayName(registrant({ first_name: ' ', last_name: '' }))).toBe('ada');
    expect(getMeetingRegistrantDisplayName(registrant({ first_name: '', last_name: '', username: null }))).toBe('r1@vendor-corp.example');
  });
});

describe('formatMeetingRegistrantRole', () => {
  it('joins whichever of job title and organization exist', () => {
    expect(formatMeetingRegistrantRole({ job_title: 'Maintainer', org_name: 'Vendor Corp' })).toBe('Maintainer · Vendor Corp');
    expect(formatMeetingRegistrantRole({ job_title: '  ', org_name: 'Vendor Corp' })).toBe('Vendor Corp');
    expect(formatMeetingRegistrantRole({ job_title: null, org_name: null })).toBeNull();
  });
});
