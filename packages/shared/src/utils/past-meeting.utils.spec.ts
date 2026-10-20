// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { EnrichedPastMeetingParticipant, PastMeetingRecording, RecordingSession } from '../interfaces';
import {
  filterPastMeetingParticipants,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingStartTimeMs,
  isPastMeetingCalendarRow,
  countPastMeetingAttendance,
  filterPublicPastMeetingRoster,
  getPastMeetingAttendanceFigures,
  getPastMeetingAttendanceTone,
  getPastMeetingIdentityNames,
  getPastMeetingIdentityTier,
  isPastMeetingNotetakerBot,
  isPastMeetingUnverifiedAttendee,
  toPastMeetingParticipantRow,
} from './past-meeting.utils';

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
    is_unknown: partial.is_unknown,
    is_verified: partial.is_verified,
    is_auto_matched: partial.is_auto_matched,
    is_ai_reconciled: partial.is_ai_reconciled,
    zoom_user_name: partial.zoom_user_name,
    mapped_invitee_name: partial.mapped_invitee_name,
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

describe('isPastMeetingCalendarRow', () => {
  it('returns true for past-meeting rows with scheduled_start_time', () => {
    expect(isPastMeetingCalendarRow({ scheduled_start_time: '2026-07-01T15:00:00Z' } as never)).toBe(true);
  });

  it('returns true for v1_past_meeting rows that omit scheduled_start_time', () => {
    expect(
      isPastMeetingCalendarRow({
        meeting_and_occurrence_id: '99152950841-1630560600000',
        start_time: '2026-07-01T15:00:00Z',
        meeting_id: '99152950841',
      } as never)
    ).toBe(true);
  });

  it('returns true when only meeting_id identifies a past row', () => {
    expect(isPastMeetingCalendarRow({ meeting_id: '99152950841', id: '99152950841-1630560600000' } as never)).toBe(true);
  });

  it('returns false for live meeting rows', () => {
    expect(isPastMeetingCalendarRow({ start_time: '2026-07-01T15:00:00Z', duration: 60 } as never)).toBe(false);
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

describe('past-meeting attendance figures (E4-05)', () => {
  it('counts every record, the attended and the invited', () => {
    expect(
      countPastMeetingAttendance([
        { is_attended: true, is_invited: true },
        { is_attended: true, is_invited: false },
        { is_attended: false, is_invited: true },
      ])
    ).toEqual({ participant_count: 3, attended_count: 2, individual_registrants_count: 2, unverified_attended_count: 2 });
  });

  it('counts unverified attendees, leaving out notetaker bots (N-02)', () => {
    const counts = countPastMeetingAttendance([
      participant({ is_attended: true, is_verified: true }),
      participant({ is_attended: true, is_unknown: true }),
      participant({ is_attended: true }),
      participant({ is_attended: true, zoom_user_name: "Libby's Notetaker (Otter.ai)" }),
      participant({ is_invited: true }),
    ]);

    expect(counts.attended_count).toBe(4);
    expect(counts.unverified_attended_count).toBe(2);
  });

  it.each([
    [0, 'low'],
    [24, 'low'],
    [25, 'medium'],
    [69, 'medium'],
    [70, 'high'],
    [100, 'high'],
  ] as const)('puts a %i%% rate in the %s band', (rate, tone) => {
    expect(getPastMeetingAttendanceTone(rate)).toBe(tone);
  });

  it('derives total, attended, absent, rate and tone from the counts', () => {
    expect(getPastMeetingAttendanceFigures({ participant_count: 8, attended_count: 6, unverified_attended_count: 2 })).toEqual({
      total: 8,
      attended: 6,
      absent: 2,
      rate: 75,
      tone: 'high',
      unverified: 2,
    });
  });

  it('leaves unverified null when the counts predate it, and never above attended', () => {
    expect(getPastMeetingAttendanceFigures({ participant_count: 8, attended_count: 6 })?.unverified).toBeNull();
    expect(getPastMeetingAttendanceFigures({ participant_count: 8, attended_count: 3, unverified_attended_count: 5 })?.unverified).toBe(3);
  });

  // The admin page used to hide its whole stats row here.
  it('gives zero figures with no rate for a meeting with no participants', () => {
    expect(getPastMeetingAttendanceFigures({ participant_count: 0, attended_count: 0 })).toEqual({
      total: 0,
      attended: 0,
      absent: 0,
      rate: null,
      tone: null,
      unverified: null,
    });
  });

  it('is null when the counts are unknown, so unknown never reads as zero', () => {
    expect(getPastMeetingAttendanceFigures(undefined)).toBeNull();
    expect(getPastMeetingAttendanceFigures({ participant_count: 5 })).toBeNull();
  });
});

describe('participant identity tiers (N-02)', () => {
  it.each([
    ['nobody who did not attend', { is_invited: true, is_verified: true }, null],
    ['an attendee left unknown', { is_attended: true, is_unknown: true, is_verified: true }, 'unverified'],
    ['an attendee nobody has verified', { is_attended: true }, 'unverified'],
    ['an AI match, though verified', { is_attended: true, is_verified: true, is_ai_reconciled: true, is_auto_matched: true }, 'ai-reconciled'],
    ['an automatic name match, though verified', { is_attended: true, is_verified: true, is_auto_matched: true }, 'auto-matched'],
    ['a verified match with neither flag', { is_attended: true, is_verified: true }, 'verified'],
  ] as const)('gives %s its tier', (_, flags, tier) => {
    expect(getPastMeetingIdentityTier(participant(flags))).toBe(tier);
  });

  it('names what they joined Zoom as and who they were matched to, only where it differs from the row', () => {
    expect(
      getPastMeetingIdentityNames(participant({ first_name: 'Ada', last_name: 'Lovelace', zoom_user_name: 'ada-mbp', mapped_invitee_name: 'Ada King' }))
    ).toEqual({ joinedAs: 'ada-mbp', matchedTo: 'Ada King' });
    expect(
      getPastMeetingIdentityNames(
        participant({ first_name: 'Ada', last_name: 'Lovelace', zoom_user_name: ' ada  LOVELACE ', mapped_invitee_name: 'Ada Lovelace' })
      )
    ).toEqual({ joinedAs: null, matchedTo: null });
    expect(getPastMeetingIdentityNames(participant({ first_name: 'Ada', last_name: 'Lovelace' }))).toEqual({ joinedAs: null, matchedTo: null });
  });

  it('labels a row by its tier, and an unverified attendee left unknown as Unknown', () => {
    expect(toPastMeetingParticipantRow(participant({ is_attended: true, is_verified: true, is_auto_matched: true })).identity_label).toBe('Auto-matched');
    expect(toPastMeetingParticipantRow(participant({ is_attended: true })).identity_label).toBe('Needs review');
    expect(toPastMeetingParticipantRow(participant({ is_attended: true, is_unknown: true })).identity_label).toBe('Unknown');
    expect(toPastMeetingParticipantRow(participant({ is_invited: true }))).toMatchObject({ identity_tier: null, identity_label: null });
  });

  // #2253: reconciliation never queues a bot, so no surface treats one as awaiting review.
  it('treats an unmatched notetaker bot as a bot everywhere: no tier, not unverified', () => {
    const bot = participant({ uid: 'bot', is_attended: true, zoom_user_name: "Libby's Notetaker (Otter.ai)" });

    expect(toPastMeetingParticipantRow(bot)).toMatchObject({ identity_tier: null, identity_label: 'Notetaker bot', is_notetaker_bot: true });
    expect(toPastMeetingParticipantRow(participant({ is_attended: true }))).toMatchObject({ identity_tier: 'unverified', is_notetaker_bot: false });
    // A record reconciled before the bot exclusion can carry a match; it is still a bot.
    const matchedBot = participant({ is_attended: true, is_verified: true, is_ai_reconciled: true, zoom_user_name: 'Fathom Notetaker' });
    expect(toPastMeetingParticipantRow(matchedBot)).toMatchObject({ identity_tier: null, identity_label: 'Notetaker bot', is_notetaker_bot: true });
    expect(isPastMeetingUnverifiedAttendee(bot)).toBe(false);
  });

  it('tells a notetaker bot by its Zoom name, else its first and last name', () => {
    expect(isPastMeetingNotetakerBot({ zoom_user_name: 'Fireflies.ai Notetaker' })).toBe(true);
    expect(isPastMeetingNotetakerBot({ first_name: 'Read', last_name: 'AI Notetaker' })).toBe(true);
    expect(isPastMeetingNotetakerBot({ first_name: 'Grain', last_name: 'Adeyemi' })).toBe(false);
  });
});

describe('filterPublicPastMeetingRoster (E4-05)', () => {
  const row = (uid: string, is_invited: boolean, is_attended: boolean) => ({ uid, first_name: uid, last_name: '', is_invited, is_attended });
  const rows = [row('invited-attended', true, true), row('invited-absent', true, false), row('walk-in', false, true)];
  const uids = (invitation: 'all' | 'invited' | 'not-invited', attendance: 'all' | 'attended' | 'absent') =>
    filterPublicPastMeetingRoster(rows, invitation, attendance).map((r) => r.uid);

  it('keeps every row with both filters on all', () => {
    expect(uids('all', 'all')).toEqual(['invited-attended', 'invited-absent', 'walk-in']);
  });

  it('applies each filter on its own axis', () => {
    expect(uids('invited', 'all')).toEqual(['invited-attended', 'invited-absent']);
    expect(uids('not-invited', 'all')).toEqual(['walk-in']);
    expect(uids('all', 'absent')).toEqual(['invited-absent']);
    expect(uids('invited', 'attended')).toEqual(['invited-attended']);
    expect(uids('not-invited', 'absent')).toEqual([]);
  });
});
