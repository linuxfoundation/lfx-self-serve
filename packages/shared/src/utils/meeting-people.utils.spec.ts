// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { MeetingRegistrant, MeetingRsvp, RsvpResponse } from '../interfaces';
import { buildMeetingPeopleRows, countMeetingPeopleTallies, formatMeetingRegistrantRole, getMeetingRegistrantDisplayName } from './meeting-people.utils';

const registrant = (overrides: Partial<MeetingRegistrant>): MeetingRegistrant => ({
  uid: 'r1',
  meeting_id: 'meeting-1',
  email: 'r1@vendor-corp.example',
  first_name: 'Ada',
  last_name: 'Lovelace',
  host: false,
  job_title: null,
  org_name: null,
  occurrence_id: null,
  org_is_member: false,
  org_is_project_member: false,
  avatar_url: null,
  username: 'ada',
  linkedin_profile: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  type: 'direct',
  invite_accepted: null,
  attended: null,
  rsvp: null,
  ...overrides,
});

const rsvp = (response_type: RsvpResponse): MeetingRsvp => ({
  id: 'rsvp-1',
  meeting_id: 'meeting-1',
  registrant_id: 'r1',
  username: 'ada',
  email: 'r1@vendor-corp.example',
  response_type,
  scope: 'single',
  created_at: '2026-01-01T00:00:00Z',
});

describe('buildMeetingPeopleRows', () => {
  it('lists organizers first, then by RSVP, then by name', () => {
    const rows = buildMeetingPeopleRows(
      [
        registrant({ uid: 'declined', first_name: 'Dee', invite_accepted: false }),
        registrant({ uid: 'pending', first_name: 'Pat' }),
        registrant({ uid: 'host', first_name: 'Hal', host: true, invite_accepted: false }),
        registrant({ uid: 'maybe', first_name: 'May', rsvp: rsvp('maybe') }),
        registrant({ uid: 'accepted-b', first_name: 'Bea', invite_accepted: true }),
        registrant({ uid: 'accepted-a', first_name: 'Abe', invite_accepted: true }),
      ],
      { inviteResponsesEnabled: true }
    );

    expect(rows.map((row) => row.uid)).toEqual(['host', 'accepted-a', 'accepted-b', 'maybe', 'pending', 'declined']);
    expect(rows.map((row) => row.attendance)).toEqual(['declined', 'accepted', 'accepted', 'maybe', 'pending', 'declined']);
  });

  it('orders names the same way everywhere, ignoring case and accents', () => {
    const rows = buildMeetingPeopleRows(
      [
        registrant({ uid: 'z', first_name: 'zoe', last_name: '' }),
        registrant({ uid: 'e', first_name: 'Émile', last_name: '' }),
        registrant({ uid: 'a', first_name: 'adam', last_name: '' }),
      ],
      { inviteResponsesEnabled: false }
    );

    expect(rows.map((row) => row.uid)).toEqual(['a', 'e', 'z']);
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
