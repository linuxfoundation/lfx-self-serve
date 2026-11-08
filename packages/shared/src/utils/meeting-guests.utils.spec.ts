// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils pulls in @angular/common/http, which needs the JIT compiler under Vitest.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { CommitteeMemberVotingStatus } from '../enums';
import { MEETING_GUEST_EMPTY_FILTERS } from '../constants/meeting-guests.constants';
import { CommitteeMember, MeetingCommittee, MeetingRegistrant, MeetingRsvp, PastMeetingParticipant, RsvpResponse } from '../interfaces';
import {
  buildParticipantGuestRows,
  buildRegistrantGuestRows,
  filterMeetingGuestRows,
  getMeetingGuestFilterChips,
  getMeetingGuestFilterFields,
  getMeetingGuestSummary,
  getOfferedMeetingGuestFilters,
} from './meeting-guests.utils';

const viewer = { username: 'viewer', email: 'viewer@acme.example' };
const committees = [{ uid: 'c-1', name: 'Steering' }];

const registrant = (overrides: Partial<MeetingRegistrant> = {}): MeetingRegistrant => ({
  uid: 'r',
  meeting_id: 'm',
  email: 'ada@acme.example',
  first_name: 'Ada',
  last_name: 'Lane',
  host: false,
  job_title: null,
  org_name: null,
  occurrence_id: null,
  org_is_member: false,
  org_is_project_member: false,
  avatar_url: null,
  username: null,
  linkedin_profile: null,
  created_at: '',
  updated_at: '',
  type: 'direct',
  invite_accepted: null,
  attended: null,
  ...overrides,
});

const rsvp = (response_type: RsvpResponse): MeetingRsvp => ({
  id: 'rsvp',
  meeting_id: 'm',
  registrant_id: 'r',
  username: '',
  email: '',
  response_type,
  scope: 'all',
  created_at: '',
});

const participant = (overrides: Partial<PastMeetingParticipant> = {}): PastMeetingParticipant => ({
  uid: 'p',
  meeting_id: 'm',
  meeting_and_occurrence_id: 'm-1',
  past_meeting_id: 'm-1',
  email: 'ada@acme.example',
  first_name: 'Ada',
  last_name: 'Lane',
  host: false,
  is_attended: true,
  is_invited: true,
  org_is_member: false,
  org_is_project_member: false,
  created_at: '',
  updated_at: '',
  ...overrides,
});

const member = (email: string, committee_uid: string, voting?: CommitteeMemberVotingStatus): CommitteeMember => ({
  uid: email,
  committee_uid,
  committee_name: 'Steering',
  email,
  first_name: '',
  last_name: '',
  created_at: '',
  updated_at: '',
  ...(voting ? { voting: { status: voting } } : {}),
});

describe('buildRegistrantGuestRows', () => {
  const registrants = [
    registrant({ uid: 'r-1', first_name: 'Zed', email: 'org@acme.example', host: true, job_title: 'Lead', org_name: 'Acme' }),
    registrant({ uid: 'r-2', first_name: 'Bea', host: true, rsvp: rsvp('maybe') }),
    registrant({ uid: 'r-3', first_name: 'Cal', type: 'committee', committee_uid: 'c-1', rsvp: rsvp('declined') }),
    registrant({ uid: 'r-4', first_name: 'Dee', username: 'Viewer' }),
  ];

  it('maps roles, statuses, groups, meta and marks the viewer', () => {
    const rows = buildRegistrantGuestRows(registrants, { organizers: ['org@acme.example'], committees }, viewer, true);
    const byUid = new Map(rows.map((row) => [row.uid, row]));

    expect(byUid.get('r-1')).toMatchObject({ role: 'organizer', meta: 'Lead · Acme', status: 'pending', invited: true, groups: [] });
    expect(byUid.get('r-2')).toMatchObject({ role: 'host', status: 'maybe', statusBadge: { tone: 'warning', label: 'RSVP: Maybe' } });
    expect(byUid.get('r-3')).toMatchObject({ role: 'guest', status: 'no', groups: ['c-1'] });
    expect(byUid.get('r-4')).toMatchObject({ you: true, name: 'Dee Lane (You)', initials: 'DL' });
  });

  it('leaves statuses out when RSVPs are not collected', () => {
    const rows = buildRegistrantGuestRows(registrants, { organizers: [], committees: [] }, viewer, false);
    expect(rows.every((row) => row.status === null && row.statusBadge === null)).toBe(true);
  });

  it('sorts the viewer first, then role, RSVP status, named before unnamed, and name A–Z', () => {
    const rows = buildRegistrantGuestRows(
      [
        registrant({ uid: 'no', first_name: 'Al', email: 'al@acme.example', rsvp: rsvp('declined') }),
        registrant({ uid: 'unnamed', first_name: '', last_name: '', email: 'x@acme.example' }),
        registrant({ uid: 'pending-z', first_name: 'Zoe', email: 'zoe@acme.example' }),
        registrant({ uid: 'pending-b', first_name: 'Ben', email: 'ben@acme.example' }),
        registrant({ uid: 'maybe', first_name: 'Max', email: 'max@acme.example', rsvp: rsvp('maybe') }),
        registrant({ uid: 'yes', first_name: 'Yan', email: 'yan@acme.example', rsvp: rsvp('accepted') }),
        registrant({ uid: 'host', first_name: 'Hal', email: 'hal@acme.example', host: true, rsvp: rsvp('declined') }),
        registrant({ uid: 'org', first_name: 'Oli', email: 'org@acme.example', host: true }),
        registrant({ uid: 'me', first_name: 'Vic', email: 'viewer@acme.example', rsvp: rsvp('declined') }),
      ],
      { organizers: ['org@acme.example'], committees: [] },
      viewer,
      true
    );
    expect(rows.map((row) => row.uid)).toEqual(['me', 'org', 'host', 'yes', 'maybe', 'pending-b', 'pending-z', 'unnamed', 'no']);
  });
});

describe('buildParticipantGuestRows', () => {
  it('sorts attended before absent once ended', () => {
    const rows = buildParticipantGuestRows(
      [participant({ uid: 'absent', first_name: 'Al', email: 'al@acme.example', is_attended: false }), participant({ uid: 'attended', first_name: 'Zed' })],
      { organizers: [], committees: [] },
      viewer,
      []
    );
    expect(rows.map((row) => row.uid)).toEqual(['attended', 'absent']);
  });

  it('maps attendance and invites, and groups by committee email', () => {
    const members = [member('ADA@acme.example', 'c-1')];
    const rows = buildParticipantGuestRows(
      [participant({ uid: 'p-1' }), participant({ uid: 'p-2', first_name: 'Bo', email: 'bo@acme.example', is_attended: false, is_invited: false })],
      { organizers: [], committees },
      viewer,
      members
    );
    expect(rows[0]).toMatchObject({ uid: 'p-1', status: 'attended', invited: true, groups: ['c-1'] });
    expect(rows[1]).toMatchObject({ uid: 'p-2', status: 'absent', invited: false, groups: [], statusBadge: { label: 'Absent', tone: 'danger' } });
  });

  it('keeps every meeting committee a participant sits on, and ignores other committees', () => {
    const [row] = buildParticipantGuestRows([participant({})], { organizers: [], committees: [...committees, { uid: 'c-2', name: 'Board' }] }, viewer, [
      member('ada@acme.example', 'c-1'),
      member('ada@acme.example', 'c-2', CommitteeMemberVotingStatus.VOTING_REP),
      member('ada@acme.example', 'c-9'),
    ]);
    expect(row).toMatchObject({ groups: ['c-1', 'c-2'], votingStatus: 'Voting Rep', votingRep: true });
    expect(filterMeetingGuestRows([row], '', { ...MEETING_GUEST_EMPTY_FILTERS, group: 'c-2' })).toHaveLength(1);
    expect(filterMeetingGuestRows([row], '', { ...MEETING_GUEST_EMPTY_FILTERS, group: 'direct' })).toHaveLength(0);
  });
});

describe('row details', () => {
  it('shows a later visible voting status when the first membership is Observer', () => {
    const [row] = buildParticipantGuestRows([participant({})], { organizers: [], committees: [...committees, { uid: 'c-2', name: 'Board' }] }, viewer, [
      member('ada@acme.example', 'c-1', CommitteeMemberVotingStatus.OBSERVER),
      member('ada@acme.example', 'c-2', CommitteeMemberVotingStatus.EMERITUS),
    ]);
    expect(row).toMatchObject({ votingStatus: 'Emeritus', votingRep: false });
  });

  it('keeps an http(s) LinkedIn URL and a voting status other than Observer or None', () => {
    const [shown, hidden] = buildRegistrantGuestRows(
      [
        registrant({ uid: 'a', first_name: 'A', linkedin_profile: 'https://linkedin.example/in/a', committee_voting_status: 'Voting Rep' }),
        registrant({ uid: 'b', first_name: 'B', linkedin_profile: 'javascript:alert(1)', committee_voting_status: 'Observer' }),
      ],
      { organizers: [], committees: [] },
      viewer,
      true
    );
    expect(shown).toMatchObject({ linkedinUrl: 'https://linkedin.example/in/a', votingStatus: 'Voting Rep', votingRep: true, email: 'ada@acme.example' });
    expect(hidden).toMatchObject({ linkedinUrl: null, votingStatus: null, votingRep: false });
  });

  it('takes a participant voting status from the committee membership', () => {
    const [row] = buildParticipantGuestRows([participant({})], { organizers: [], committees }, viewer, [
      member('ada@acme.example', 'c-1', CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP),
    ]);
    expect(row).toMatchObject({ votingStatus: 'Alternate Voting Rep', votingRep: true });
  });
});

describe('getMeetingGuestSummary', () => {
  const rows = buildParticipantGuestRows(
    [participant({ uid: 'p-1' }), participant({ uid: 'p-2', is_attended: false }), participant({ uid: 'p-3', is_invited: false })],
    { organizers: [], committees: [] },
    viewer,
    []
  );

  it('counts attended and invited participants once ended', () => {
    expect(getMeetingGuestSummary(rows, true, false)).toEqual({ title: 'Meeting Participants', subtitle: '2 attended / 2 invited' });
  });

  it('counts members of a committee meeting, else guests', () => {
    expect(getMeetingGuestSummary(rows, false, true)).toEqual({ title: 'Meeting Members', subtitle: '3 members' });
    expect(getMeetingGuestSummary(rows, false, false)).toEqual({ title: 'Meeting Guests', subtitle: '3 guests' });
  });

  it('uses the singular for one person', () => {
    expect(getMeetingGuestSummary(rows.slice(0, 1), false, false).subtitle).toBe('1 guest');
    expect(getMeetingGuestSummary(rows.slice(0, 1), false, true).subtitle).toBe('1 member');
  });
});

describe('getMeetingGuestFilterFields', () => {
  it('offers RSVP, Role and Group upcoming', () => {
    const fields = getMeetingGuestFilterFields(false, true, committees);
    expect(fields.map((field) => field.title)).toEqual(['RSVP status', 'Role', 'Group']);
    expect(fields[2].options.map((option) => option.label)).toEqual(['Steering', 'Direct invite']);
  });

  it('offers Voting Reps once ended when a committee has voting statuses', () => {
    const voting: MeetingCommittee[] = [{ uid: 'c-1', name: 'Steering', allowed_voting_statuses: ['voting_rep'] }];
    expect(getMeetingGuestFilterFields(true, true, voting).at(-1)).toMatchObject({ key: 'voting', options: [{ value: 'reps', label: 'Voting Reps' }] });
    expect(getMeetingGuestFilterFields(false, true, voting).some((field) => field.key === 'voting')).toBe(false);
  });

  it('offers Attendance, Invite and Role once ended, and drops RSVP when not collected', () => {
    expect(getMeetingGuestFilterFields(true, true, []).map((field) => field.title)).toEqual(['Attendance', 'Invite', 'Role']);
    expect(getMeetingGuestFilterFields(false, false, []).map((field) => field.title)).toEqual(['Role']);
  });
});

describe('filters and chips', () => {
  const rows = buildRegistrantGuestRows(
    [
      registrant({ uid: 'r-1', first_name: 'Ada', org_name: 'Acme', rsvp: rsvp('accepted') }),
      registrant({ uid: 'r-2', first_name: 'Bo', email: 'bo@acme.example', type: 'committee', committee_uid: 'c-1' }),
      registrant({ uid: 'r-3', first_name: 'Cy', email: 'cy@acme.example', type: 'committee', committee_uid: 'c-gone' }),
    ],
    { organizers: [], committees },
    viewer,
    true
  );

  it('matches the search on name, meta and email, and every applied filter', () => {
    expect(filterMeetingGuestRows(rows, 'acme', MEETING_GUEST_EMPTY_FILTERS).map((row) => row.uid)).toEqual(['r-1', 'r-2', 'r-3']);
    expect(filterMeetingGuestRows(rows, ' BO@ ', MEETING_GUEST_EMPTY_FILTERS).map((row) => row.uid)).toEqual(['r-2']);
    expect(filterMeetingGuestRows(rows, '', { ...MEETING_GUEST_EMPTY_FILTERS, status: 'yes' }).map((row) => row.uid)).toEqual(['r-1']);
    expect(filterMeetingGuestRows(rows, '', { ...MEETING_GUEST_EMPTY_FILTERS, group: 'direct' }).map((row) => row.uid)).toEqual(['r-1', 'r-3']);
    expect(filterMeetingGuestRows(rows, '', { ...MEETING_GUEST_EMPTY_FILTERS, role: 'host' })).toEqual([]);
  });

  it('does not match the search on the fallback name of an unnamed guest', () => {
    const unnamed = buildRegistrantGuestRows(
      [registrant({ first_name: '', last_name: '', email: 'x@acme.example' })],
      { organizers: [], committees: [] },
      viewer,
      true
    );
    expect(filterMeetingGuestRows(unnamed, 'guest', MEETING_GUEST_EMPTY_FILTERS)).toEqual([]);
  });

  it('marks the viewer by email in any case', () => {
    const [row] = buildRegistrantGuestRows([registrant({ username: 'other', email: 'VIEWER@acme.example' })], { organizers: [], committees: [] }, viewer, true);
    expect(row.you).toBe(true);
  });

  it('clears filter values the fields no longer offer', () => {
    const ended = getMeetingGuestFilterFields(true, true, committees);
    expect(getOfferedMeetingGuestFilters({ status: 'yes', role: 'host', invite: null, group: 'c-1', voting: null }, ended)).toEqual({
      status: null,
      role: 'host',
      invite: null,
      group: 'c-1',
      voting: null,
    });
  });

  it('labels applied filters by their field', () => {
    const fields = getMeetingGuestFilterFields(false, true, committees);
    expect(getMeetingGuestFilterChips({ ...MEETING_GUEST_EMPTY_FILTERS, status: 'pending', group: 'c-1' }, fields)).toEqual([
      { key: 'status', prefix: 'RSVP status:', label: 'No response' },
      { key: 'group', prefix: 'Group:', label: 'Steering' },
    ]);
  });

  it('counts a committee that is not on the meeting as a direct invite', () => {
    expect(rows.map((row) => row.groups)).toEqual([[], ['c-1'], []]);
  });
});
