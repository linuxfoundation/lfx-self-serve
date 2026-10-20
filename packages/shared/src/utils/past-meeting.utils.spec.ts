// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ArtifactVisibility, MeetingVisibility } from '../enums';
import { EnrichedPastMeetingParticipant, PastMeeting, PastMeetingRecording, PastMeetingTranscript, RecordingFile, RecordingSession } from '../interfaces';
import {
  filterPastMeetingParticipants,
  formatRecordingDuration,
  formatRecordingDurationSpoken,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingStartTimeMs,
  getRecordingDurationSeconds,
  isPastMeetingArtifactPublic,
  isPastMeetingCalendarRow,
  toPublicPastMeetingRecording,
  toPublicPastMeetingRoster,
  toPublicPastMeetingTranscript,
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

/** Builds a PastMeetingRecording fixture around a given set of sessions (and, optionally, files). */
function recording(sessions: RecordingSession[], files: RecordingFile[] = []): PastMeetingRecording {
  return {
    uid: 'rec-1',
    past_meeting_id: 'past-1',
    platform: 'Zoom',
    platform_meeting_id: '123',
    recording_count: sessions.length,
    recording_files: files,
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

describe('getRecordingDurationSeconds', () => {
  const mediaFile = (type: string, start: string, end: string): RecordingFile => ({
    id: `${type}-${start}`,
    download_url: '',
    play_url: '',
    file_size: 1,
    file_type: type,
    recording_type: 'shared_screen_with_speaker_view',
    recording_start: start,
    recording_end: end,
    status: 'completed',
    platform_meeting_id: '1',
  });
  const twoSessions = (largestFirst: boolean): RecordingSession[] => [
    session({ start_time: '2026-07-16T09:00:00Z', total_size: largestFirst ? 900 : 100, uuid: 's1' }),
    session({ start_time: '2026-07-16T10:00:00Z', total_size: largestFirst ? 100 : 900, uuid: 's2' }),
  ];
  const files = [
    mediaFile('MP4', '2026-07-16T09:00:05Z', '2026-07-16T09:20:05Z'),
    mediaFile('MP4', '2026-07-16T10:00:10Z', '2026-07-16T10:58:34Z'),
    mediaFile('M4A', '2026-07-16T10:00:00Z', '2026-07-16T10:58:24Z'),
    mediaFile('CHAT', '2026-07-16T10:00:00Z', '2026-07-16T12:00:00Z'),
    mediaFile('CC', '2026-07-16T10:00:00Z', '2026-07-16T12:00:00Z'),
  ];

  it("measures only the largest session's media files, overlapping views counted once", () => {
    // 10:00:00 (M4A) to 10:58:34 (MP4): chat, captions and the first session's file are left out.
    expect(getRecordingDurationSeconds(recording(twoSessions(false), files))).toBe(58 * 60 + 34);
  });

  it('measures the first session when it is the largest, ignoring the later one', () => {
    expect(getRecordingDurationSeconds(recording(twoSessions(true), files))).toBe(20 * 60);
  });

  // The host stopped and restarted recording: the gap is not part of what plays.
  it('does not count the gap between stopped and restarted recording', () => {
    const restarted = [mediaFile('MP4', '2026-07-16T10:00:00Z', '2026-07-16T10:20:00Z'), mediaFile('MP4', '2026-07-16T10:40:00Z', '2026-07-16T11:00:00Z')];
    expect(getRecordingDurationSeconds(recording([session({ start_time: '2026-07-16T10:00:00Z', total_size: 1 })], restarted))).toBe(40 * 60);
  });

  it("keeps a file that opens a moment before its session's stored start", () => {
    const early = [mediaFile('MP4', '2026-07-16T09:59:59Z', '2026-07-16T10:30:00Z')];
    expect(getRecordingDurationSeconds(recording([session({ start_time: '2026-07-16T10:00:00Z', total_size: 1 })], early))).toBe(30 * 60 + 1);
  });

  // Two sessions starting less than the tolerance apart: each keeps its own files.
  it('keeps close-together sessions apart', () => {
    const close = [
      session({ start_time: '2026-07-16T10:00:00Z', total_size: 100, uuid: 'a' }),
      session({ start_time: '2026-07-16T10:00:30Z', total_size: 900, uuid: 'b' }),
    ];
    const closeFiles = [mediaFile('MP4', '2026-07-16T10:00:00Z', '2026-07-16T10:00:20Z'), mediaFile('MP4', '2026-07-16T10:00:30Z', '2026-07-16T10:30:30Z')];
    expect(getRecordingDurationSeconds(recording(close, closeFiles))).toBe(30 * 60);
  });

  // A later session's file that opens a moment before that session's stored start is still its own.
  it("credits a later session's early-opening file to that session, not the earlier one", () => {
    const sessions = [
      session({ start_time: '2026-07-16T09:00:00Z', total_size: 100, uuid: 'a' }),
      session({ start_time: '2026-07-16T10:00:00Z', total_size: 900, uuid: 'b' }),
    ];
    const early = [mediaFile('MP4', '2026-07-16T09:00:00Z', '2026-07-16T09:20:00Z'), mediaFile('MP4', '2026-07-16T09:59:58Z', '2026-07-16T10:30:00Z')];
    expect(getRecordingDurationSeconds(recording(sessions, early))).toBe(30 * 60 + 2);
  });

  it('returns null rather than guessing', () => {
    const one = [session({ start_time: '2026-07-16T10:00:00Z', total_size: 1 })];
    // No media file, only chat.
    expect(getRecordingDurationSeconds(recording(one, [mediaFile('CHAT', '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')]))).toBeNull();
    // A media file without a readable start.
    expect(getRecordingDurationSeconds(recording(one, [mediaFile('MP4', 'not a time', '2026-07-16T11:00:00Z')]))).toBeNull();
    // A zero-length file.
    expect(getRecordingDurationSeconds(recording(one, [mediaFile('MP4', '2026-07-16T10:00:00Z', '2026-07-16T10:00:00Z')]))).toBeNull();
    // Another session's start is unreadable, so which files are the largest session's is unknown.
    const unreadable = [session({ start_time: '2026-07-16T10:00:00Z', total_size: 9 }), session({ start_time: 'garbage', total_size: 1, uuid: 'x' })];
    expect(getRecordingDurationSeconds(recording(unreadable, [mediaFile('MP4', '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')]))).toBeNull();
    // Go's zero time, which the upstream converter emits for a time it could not read.
    const zero = [session({ start_time: '0001-01-01T00:00:00Z', total_size: 9 })];
    expect(getRecordingDurationSeconds(recording(zero, [mediaFile('MP4', '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')]))).toBeNull();
    expect(getRecordingDurationSeconds(recording(one, [mediaFile('MP4', '0001-01-01T00:00:00Z', '2026-07-16T11:00:00Z')]))).toBeNull();
    expect(getRecordingDurationSeconds(recording([], []))).toBeNull();
    expect(getRecordingDurationSeconds(null)).toBeNull();
  });
});

describe('formatRecordingDurationSpoken', () => {
  it('spells the length out for a screen reader', () => {
    expect(formatRecordingDurationSpoken(58 * 60 + 24)).toBe('58 minutes 24 seconds');
    expect(formatRecordingDurationSpoken(3600 + 60 + 1)).toBe('1 hour 1 minute 1 second');
    expect(formatRecordingDurationSpoken(7200)).toBe('2 hours');
    expect(formatRecordingDurationSpoken(0)).toBe('0 seconds');
    expect(formatRecordingDurationSpoken(null)).toBeNull();
  });
});

describe('formatRecordingDuration', () => {
  it('reads m:ss under an hour and h:mm:ss from an hour', () => {
    expect(formatRecordingDuration(58 * 60 + 24)).toBe('58:24');
    expect(formatRecordingDuration(65)).toBe('1:05');
    expect(formatRecordingDuration(3600 + 2 * 60 + 3)).toBe('1:02:03');
    expect(formatRecordingDuration(0)).toBe('0:00');
  });

  it('returns null for a missing or invalid length', () => {
    expect(formatRecordingDuration(null)).toBeNull();
    expect(formatRecordingDuration(undefined)).toBeNull();
    expect(formatRecordingDuration(-1)).toBeNull();
  });
});

describe('isPastMeetingArtifactPublic (E4-04)', () => {
  type AccessFields = Pick<PastMeeting, 'visibility' | 'restricted' | 'recording_access' | 'transcript_access' | 'ai_summary_access'>;
  const meeting = (fields: Partial<AccessFields>): AccessFields => ({ visibility: MeetingVisibility.PUBLIC, restricted: false, ...fields });

  it("reads each artifact's own access level", () => {
    const record = meeting({ recording_access: ArtifactVisibility.PUBLIC, ai_summary_access: ArtifactVisibility.MEETING_HOSTS });
    expect(isPastMeetingArtifactPublic(record, 'recording')).toBe(true);
    expect(isPastMeetingArtifactPublic(record, 'summary')).toBe(false);
  });

  it('is never public when the level is unset, whatever the meeting-wide artifact_visibility says', () => {
    const record = { ...meeting({}), artifact_visibility: ArtifactVisibility.PUBLIC };
    expect(isPastMeetingArtifactPublic(record, 'transcript')).toBe(false);
    expect(isPastMeetingArtifactPublic(record, 'summary')).toBe(false);
  });

  it('is public only for a public, unrestricted meeting', () => {
    expect(isPastMeetingArtifactPublic(meeting({ ai_summary_access: ArtifactVisibility.PUBLIC, restricted: true }), 'summary')).toBe(false);
    expect(isPastMeetingArtifactPublic(meeting({ ai_summary_access: ArtifactVisibility.PUBLIC, visibility: MeetingVisibility.PRIVATE }), 'summary')).toBe(
      false
    );
    expect(isPastMeetingArtifactPublic(meeting({ ai_summary_access: ArtifactVisibility.MEETING_PARTICIPANTS }), 'summary')).toBe(false);
  });
});

describe('toPublicPastMeetingRoster', () => {
  it('keeps only the public roster fields', () => {
    const roster = toPublicPastMeetingRoster([
      participant({
        uid: 'p1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        job_title: 'Engineer',
        org_name: 'Acme',
        is_attended: true,
        is_verified: true,
      }),
    ]);

    expect(roster.participants).toEqual([
      { uid: 'p1', first_name: 'Ada', last_name: 'Lovelace', avatar_url: undefined, org_name: 'Acme', is_attended: true, is_invited: false },
    ]);
    expect(JSON.stringify(roster)).not.toContain('ada@example.com');
    expect(JSON.stringify(roster)).not.toContain('Engineer');
  });

  // N-02: the public roster names verified identities only; every other attendee tier is counted.
  it('names invitees and verified attendees, and only counts the other attendee tiers', () => {
    const roster = toPublicPastMeetingRoster([
      participant({ uid: 'verified', is_attended: true, is_verified: true }),
      participant({ uid: 'invitee', is_invited: true }),
      participant({ uid: 'unknown', is_attended: true, is_unknown: true }),
      participant({ uid: 'needs-review', is_attended: true }),
      participant({ uid: 'auto-matched', is_attended: true, is_invited: true, is_auto_matched: true }),
      participant({ uid: 'ai-reconciled', is_attended: true, is_ai_reconciled: true }),
    ]);

    expect(roster.participants.map((row) => row.uid)).toEqual(['verified', 'invitee']);
    expect(roster.unidentified_attendees).toBe(4);
  });
});

describe('public recording and transcript allowlists (E4-04)', () => {
  const file = {
    id: 'f1',
    download_url: 'https://zoom.example/dl',
    play_url: 'https://zoom.example/play',
    file_size: 10,
    file_type: 'MP4',
    recording_type: 'shared_screen',
    recording_start: '',
    recording_end: '',
    status: 'completed',
    platform_meeting_id: 'z-1',
  };
  const session = { start_time: '', share_url: 'https://zoom.example/share', total_size: 10, uuid: 'u-1' };
  // Upstream documents carry host and audit identities the typed interface does not list.
  const leaky = { host_email: 'host@example.com', host_id: 'h-1', created_by: { email: 'creator@example.com' } };

  it('keeps what the page plays and measures, and nothing upstream adds', () => {
    const recording = {
      uid: 'rec-1',
      past_meeting_id: 'pm-1',
      platform: 'Zoom',
      platform_meeting_id: 'z-1',
      recording_count: 1,
      recording_files: [{ ...file, ...leaky }],
      sessions: [{ ...session, ...leaky }],
      total_size: 10,
      duration_seconds: 60,
      created_at: '',
      updated_at: '',
      ...leaky,
    } as PastMeetingRecording;

    const result = toPublicPastMeetingRecording(recording);

    expect(result.recording_files).toEqual([file]);
    expect(result.sessions).toEqual([session]);
    expect(result.duration_seconds).toBe(60);
    expect(JSON.stringify(result)).not.toMatch(/host@example.com|creator@example.com|h-1/);
  });

  it('allowlists the transcript record the same way', () => {
    const result = toPublicPastMeetingTranscript({ id: 't-1', title: 'TSC', recording_files: [{ ...file, ...leaky }], ...leaky } as PastMeetingTranscript);

    expect(result.recording_files).toEqual([file]);
    expect(JSON.stringify(result)).not.toMatch(/host@example.com|creator@example.com|h-1/);
  });
});
