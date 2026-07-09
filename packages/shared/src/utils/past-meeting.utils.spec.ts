// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { EnrichedPastMeetingParticipant, PastMeetingRecording, RecordingSession } from '../interfaces';
import { filterPastMeetingParticipants, getLargestSessionShareUrl, getPastMeetingResourceId, getPastMeetingStartTimeMs } from './past-meeting.utils';

/** Builds an EnrichedPastMeetingParticipant fixture, defaulting every field so tests set only what they assert on. */
function participant(partial: Partial<EnrichedPastMeetingParticipant>): EnrichedPastMeetingParticipant {
  return {
    uid: partial.uid ?? 'uid',
    meeting_id: partial.meeting_id ?? 'meeting-1',
    meeting_and_occurrence_id: partial.meeting_and_occurrence_id ?? 'meeting-1-0',
    past_meeting_id: partial.past_meeting_id ?? 'past-1',
    email: partial.email ?? '',
    first_name: partial.first_name ?? '',
    last_name: partial.last_name ?? '',
    host: partial.host ?? false,
    job_title: partial.job_title,
    org_name: partial.org_name,
    is_attended: partial.is_attended ?? false,
    is_invited: partial.is_invited ?? false,
    org_is_member: partial.org_is_member ?? false,
    org_is_project_member: partial.org_is_project_member ?? false,
    avatar_url: partial.avatar_url,
    username: partial.username,
    created_at: partial.created_at ?? '2024-01-01T00:00:00Z',
    updated_at: partial.updated_at ?? '2024-01-01T00:00:00Z',
    committee_uids: partial.committee_uids ?? null,
    committee_name: partial.committee_name ?? null,
    committee_role: partial.committee_role ?? null,
    committee_voting_status: partial.committee_voting_status ?? null,
    committee_category: partial.committee_category ?? null,
  };
}

// Attended + invited, on the "board" committee, works at Acme.
const ada = participant({
  uid: '1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  org_name: 'Acme',
  is_attended: true,
  is_invited: true,
  committee_uids: ['board'],
});
// Invited but did not attend, no committee.
const bob = participant({
  uid: '2',
  first_name: 'Bob',
  last_name: 'Brown',
  email: 'bob@example.com',
  org_name: 'Globex',
  is_attended: false,
  is_invited: true,
});
// Attended without an invite (walk-in), on the "tsc" committee.
const cara = participant({
  uid: '3',
  first_name: 'Cara',
  last_name: 'Diaz',
  email: 'cara@example.com',
  org_name: 'Acme',
  is_attended: true,
  is_invited: false,
  committee_uids: ['tsc'],
});
// Sits on two committees (board + tsc) — must match the group filter for either.
const dora = participant({
  uid: '4',
  first_name: 'Dora',
  last_name: 'Evans',
  email: 'dora@example.com',
  org_name: 'Initech',
  is_attended: true,
  is_invited: true,
  committee_uids: ['board', 'tsc'],
});

const everyone = [ada, bob, cara, dora];

const uids = (list: EnrichedPastMeetingParticipant[]): string[] => list.map((p) => p.uid);

describe('filterPastMeetingParticipants', () => {
  it('returns every participant when no filters are supplied', () => {
    expect(filterPastMeetingParticipants(everyone)).toEqual(everyone);
  });

  it('returns every participant when all filters are explicitly "all"', () => {
    expect(filterPastMeetingParticipants(everyone, { search: '', attendance: 'all', invitation: 'all', group: 'all' })).toEqual(everyone);
  });

  it('matches search against first name, last name, email, and organization', () => {
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'ada' }))).toEqual(['1']);
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'brown' }))).toEqual(['2']);
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'cara@example.com' }))).toEqual(['3']);
    // Organization "Acme" is shared by Ada and Cara.
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'acme' }))).toEqual(['1', '3']);
  });

  it('treats search as case-insensitive and trims whitespace', () => {
    expect(uids(filterPastMeetingParticipants(everyone, { search: '  LOVELACE  ' }))).toEqual(['1']);
  });

  it('returns an empty list when the search matches nothing', () => {
    expect(filterPastMeetingParticipants(everyone, { search: 'nonexistent' })).toEqual([]);
  });

  it('filters by attendance', () => {
    expect(uids(filterPastMeetingParticipants(everyone, { attendance: 'attended' }))).toEqual(['1', '3', '4']);
    expect(uids(filterPastMeetingParticipants(everyone, { attendance: 'absent' }))).toEqual(['2']);
  });

  it('filters by invitation', () => {
    expect(uids(filterPastMeetingParticipants(everyone, { invitation: 'invited' }))).toEqual(['1', '2', '4']);
    expect(uids(filterPastMeetingParticipants(everyone, { invitation: 'uninvited' }))).toEqual(['3']);
  });

  it('filters by committee group, including participants on multiple committees', () => {
    // Dora (4) sits on both board and tsc, so she matches either group.
    expect(uids(filterPastMeetingParticipants(everyone, { group: 'board' }))).toEqual(['1', '4']);
    expect(uids(filterPastMeetingParticipants(everyone, { group: 'tsc' }))).toEqual(['3', '4']);
    // No participant is associated with an unknown committee.
    expect(filterPastMeetingParticipants(everyone, { group: 'unknown' })).toEqual([]);
  });

  it('excludes participants with no committee association from any specific group', () => {
    // Bob (2) has committee_uids null — he never matches a specific group, only "all".
    expect(uids(filterPastMeetingParticipants([bob], { group: 'board' }))).toEqual([]);
    expect(uids(filterPastMeetingParticipants([bob], { group: 'all' }))).toEqual(['2']);
  });

  it('combines search, attendance, invitation, and group with AND semantics', () => {
    // Acme + attended + invited + board -> only Ada (Cara is uninvited, Dora is Initech).
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'acme', attendance: 'attended', invitation: 'invited', group: 'board' }))).toEqual(['1']);
    // Acme + attended, with no invitation/group constraint -> Ada and Cara.
    expect(uids(filterPastMeetingParticipants(everyone, { search: 'acme', attendance: 'attended' }))).toEqual(['1', '3']);
    // Attended + invited -> Ada and Dora (Cara is uninvited).
    expect(uids(filterPastMeetingParticipants(everyone, { attendance: 'attended', invitation: 'invited' }))).toEqual(['1', '4']);
  });

  it('returns an empty list when given no participants', () => {
    expect(filterPastMeetingParticipants([], { search: 'ada' })).toEqual([]);
  });
});

describe('getPastMeetingStartTimeMs', () => {
  it('prefers scheduled_start_time when both fields are valid', () => {
    const ms = getPastMeetingStartTimeMs({
      scheduled_start_time: '2026-07-09T12:30:00Z',
      start_time: '2026-06-01T10:00:00Z',
    });
    expect(ms).toBe(new Date('2026-07-09T12:30:00Z').getTime());
  });

  it('falls back to start_time when scheduled_start_time is a Go zero-date', () => {
    const ms = getPastMeetingStartTimeMs({
      scheduled_start_time: '0001-01-01T00:00:00Z',
      start_time: '2026-07-09T12:30:00Z',
    });
    expect(ms).toBe(new Date('2026-07-09T12:30:00Z').getTime());
  });

  it('returns null when both fields are missing or invalid', () => {
    expect(getPastMeetingStartTimeMs({ scheduled_start_time: '0001-01-01T00:00:00Z', start_time: '0001-01-01T00:00:00Z' })).toBeNull();
    expect(getPastMeetingStartTimeMs({ scheduled_start_time: '', start_time: '' } as never)).toBeNull();
  });
});

/** Builds a RecordingSession fixture; tests set only total_size / share_url. */
function session(partial: Partial<RecordingSession>): RecordingSession {
  return {
    start_time: partial.start_time ?? '2024-01-01T00:00:00Z',
    share_url: partial.share_url ?? '',
    total_size: partial.total_size ?? 0,
    uuid: partial.uuid ?? 'session-uuid',
  };
}

/** Builds a PastMeetingRecording fixture around a given set of sessions. */
function recording(sessions: RecordingSession[]): PastMeetingRecording {
  return {
    uid: 'rec-1',
    past_meeting_id: 'past-1',
    platform: 'Zoom',
    platform_meeting_id: '123',
    recording_count: sessions.length,
    recording_files: [],
    sessions,
    total_size: sessions.reduce((sum, s) => sum + s.total_size, 0),
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

describe('getPastMeetingResourceId', () => {
  it('prefers meeting_and_occurrence_id when present', () => {
    expect(getPastMeetingResourceId({ id: 'row-id', meeting_and_occurrence_id: '99152950841-1630560600000' })).toBe('99152950841-1630560600000');
  });

  it('falls back to id when meeting_and_occurrence_id is absent', () => {
    expect(getPastMeetingResourceId({ id: 'row-id' })).toBe('row-id');
  });
});

describe('getLargestSessionShareUrl', () => {
  it('returns null for a null recording', () => {
    expect(getLargestSessionShareUrl(null)).toBeNull();
  });

  it('returns null when there are no sessions', () => {
    expect(getLargestSessionShareUrl(recording([]))).toBeNull();
  });

  it('returns null when no session has a share URL', () => {
    expect(getLargestSessionShareUrl(recording([session({ total_size: 100 }), session({ total_size: 200 })]))).toBeNull();
  });

  it('returns the share URL of the largest session by total_size', () => {
    const rec = recording([
      session({ total_size: 100, share_url: 'https://small.example' }),
      session({ total_size: 500, share_url: 'https://largest.example' }),
      session({ total_size: 300, share_url: 'https://medium.example' }),
    ]);
    expect(getLargestSessionShareUrl(rec)).toBe('https://largest.example');
  });

  it('returns null when the largest session has an empty share URL, even if a smaller one has one', () => {
    const rec = recording([session({ total_size: 100, share_url: 'https://small.example' }), session({ total_size: 500, share_url: '' })]);
    expect(getLargestSessionShareUrl(rec)).toBeNull();
  });
});
