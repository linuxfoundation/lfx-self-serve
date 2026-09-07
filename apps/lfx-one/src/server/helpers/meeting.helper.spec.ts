// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingUserInfo, PastMeeting } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessCheckService } from '../services/access-check.service';

const { resolveCreatedByForMeetings } = vi.hoisted(() => ({
  resolveCreatedByForMeetings: vi.fn<(req: unknown, uids: string[]) => Promise<Map<string, Pick<Meeting, 'created_by' | 'owner'>>>>(),
}));

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths must be mocked (mirrors
// session-store.service.spec.ts). resolveMeetingOrganizer/resolveMeetingOwner real behavior is
// exhaustively covered in packages/shared/src/utils/meeting.utils.spec.ts; these faithful
// stand-ins (human = named non-service identity) keep the helper's enrich/omit orchestration
// under test (human creator → skip; service-account/empty/zero-valued → enrich).
const SKIP = ['zoom.webhooks', 'zoom.events'];
const isHumanIdentity = (identity: MeetingUserInfo | undefined | null): boolean => !!identity?.name && !SKIP.includes((identity.username ?? '').toLowerCase());
vi.mock('@lfx-one/shared/utils', () => ({
  resolveMeetingOwner: (meeting: { owner?: MeetingUserInfo } | null | undefined) => (isHumanIdentity(meeting?.owner) ? meeting!.owner! : null),
  resolveMeetingOrganizer: (meeting: { created_by?: MeetingUserInfo; owner?: MeetingUserInfo } | null | undefined) => {
    if (isHumanIdentity(meeting?.owner)) {
      return meeting!.owner!;
    }
    if (isHumanIdentity(meeting?.created_by)) {
      return meeting!.created_by!;
    }
    return null;
  },
}));
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));
// meeting.helper now imports HOST_KEY_* from shared/constants; stub the barrel so the
// full constants module graph (which imports shared/enums for ArtifactVisibility etc.) doesn't load.
vi.mock('@lfx-one/shared/constants', () => ({ HOST_KEY_EARLY_MINUTES: 70, HOST_KEY_LATE_MINUTES: 40 }));

// Stub the services constructed at module load so importing the helper doesn't pull in the
// microservice proxy / access-check / committee stack. enrichMeetingsWithCreatedBy exercises
// resolveCreatedByForMeetings; the host-key gate uses an injected access-check service (not the
// module), so a bare MeetingService stub with that one method covers both suites.
vi.mock('../services/meeting.service', () => ({
  MeetingService: class {
    public resolveCreatedByForMeetings = resolveCreatedByForMeetings;
  },
}));
vi.mock('../services/committee.service', () => ({ CommitteeService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: vi.fn(), getUsernameFromAuth: vi.fn() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));

import { applyOrganizerAndHostKeyResult, enrichMeetingsWithCreatedBy, isWithinHostKeyWindow, resolveOrganizerAndHostKey, stripHostKey } from './meeting.helper';

const req = {} as unknown as Request;
const human: MeetingUserInfo = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
const owner: MeetingUserInfo = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };
const zeroValuedOwner = { user_id: '', name: '', username: '', email: '', profile_picture: '' };

function pastMeeting(overrides: Partial<PastMeeting>): PastMeeting {
  return { id: 'pm-1', meeting_id: 'live-1', ...overrides } as PastMeeting;
}

describe('enrichMeetingsWithCreatedBy', () => {
  beforeEach(() => {
    resolveCreatedByForMeetings.mockReset();
  });

  it('joins past meetings to the live v1_meeting created_by by meeting_id', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['live-1', { created_by: human }]]));
    const meetings = [pastMeeting({ id: 'pm-1', meeting_id: 'live-1' })];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.meeting_id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['live-1']);
    expect(result[0].created_by).toEqual(human);
  });

  it('omits created_by when the series meeting no longer exists (deleted series)', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map());
    const meetings = [pastMeeting({ id: 'pm-1', meeting_id: 'gone' })];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.meeting_id);

    expect(result[0].created_by).toBeUndefined();
  });

  it('queries for a human created_by without an owner (OR-gate) but never clobbers the human created_by', async () => {
    // Past meetings carry created_by but never owner — the join must still run so a transferred
    // ownership shows instead of the original creator, without overwriting the human creator.
    resolveCreatedByForMeetings.mockResolvedValue(
      new Map([['m-1', { created_by: { name: 'Someone Else', username: 'selse', email: 'se@example.com' }, owner }]])
    );
    const meetings = [{ id: 'm-1', created_by: human } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['m-1']);
    expect(result[0].created_by).toBe(human);
    expect(result[0].owner).toEqual(owner);
  });

  it('leaves meetings that carry both a human created_by and a resolvable owner untouched, with no query', async () => {
    const meetings = [{ id: 'm-1', created_by: human, owner } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).not.toHaveBeenCalled();
    expect(result[0]).toBe(meetings[0]);
  });

  it('skips the join when a human owner is present without created_by — owner replaces the creator in every consumer', async () => {
    // Deliberate: display is owner-first everywhere (collectMeetingOrganizers puts the owner in
    // the created_by slot), so backfilling created_by here would spend a query on a field nothing
    // reads. Upstream also defaults owner to the creator on create, so the creator identity still
    // arrives via `owner` for meetings that were never transferred.
    const meetings = [{ id: 'm-1', owner } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).not.toHaveBeenCalled();
    expect(result[0]).toBe(meetings[0]);
  });

  it('never writes a zero-valued owner from the index', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['m-1', { created_by: human, owner: zeroValuedOwner }]]));
    const meetings = [{ id: 'm-1' } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(result[0].created_by).toEqual(human);
    expect(result[0].owner).toBeUndefined();
  });

  it('enriches a service-account created_by (zoom.webhooks) since it is not a human', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['live-2', { created_by: human }]]));
    const meetings = [pastMeeting({ id: 'pm-2', meeting_id: 'live-2', created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } })];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.meeting_id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['live-2']);
    expect(result[0].created_by).toEqual(human);
  });

  it('populates both created_by and owner from a single join', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['live-3', { created_by: human, owner }]]));
    const meetings = [pastMeeting({ id: 'pm-3', meeting_id: 'live-3' })];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.meeting_id);

    expect(result[0].created_by).toEqual(human);
    expect(result[0].owner).toEqual(owner);
  });

  it('short-circuits with no query when nothing needs enrichment', async () => {
    const result = await enrichMeetingsWithCreatedBy(req, [], (m: Meeting) => m.id);

    expect(resolveCreatedByForMeetings).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('keys upcoming meetings on their own uid', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['up-1', { created_by: human }]]));
    const meetings = [{ id: 'up-1' } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['up-1']);
    expect(result[0].created_by).toEqual(human);
  });
});

const MEETING_ID = 'meeting-1111';
const PROJECT_UID = 'project-2222';
const COMMITTEE_A = 'committee-aaaa';

// Returns an ISO string offset by `offsetMs` from now. Used to build start_time values
// that land inside or outside the host-key visibility window without relying on fixed dates.
function isoOffset(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const MIN = 60_000;

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    project_uid: PROJECT_UID,
    host_key: '123456',
    committees: [{ uid: COMMITTEE_A }],
    // Default: starts in 1 min, 60-min duration — well inside the 70-min pre-window.
    start_time: isoOffset(1 * MIN),
    duration: 60,
    ...overrides,
  } as Meeting;
}

function mockAccessCheck(hasOrganizer: boolean): {
  service: AccessCheckService;
  checkSingleAccess: ReturnType<typeof vi.fn>;
} {
  const checkSingleAccess = vi.fn().mockResolvedValue(hasOrganizer);
  return { service: { checkSingleAccess } as unknown as AccessCheckService, checkSingleAccess };
}

function mockMeetingSvc(hostKey: string | null | Error): {
  service: { getMeetingHostKey: ReturnType<typeof vi.fn> };
  getMeetingHostKey: ReturnType<typeof vi.fn>;
} {
  const getMeetingHostKey = hostKey instanceof Error ? vi.fn().mockRejectedValue(hostKey) : vi.fn().mockResolvedValue(hostKey);
  return { service: { getMeetingHostKey }, getMeetingHostKey };
}

describe('resolveOrganizerAndHostKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the host key and organizer=true for a meeting organizer inside the window', async () => {
    const meeting = buildMeeting();
    const { service: access, checkSingleAccess } = mockAccessCheck(true);
    const { service: meetingSvc, getMeetingHostKey } = mockMeetingSvc('123456');

    const result = await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(result).toEqual({ organizer: true, canViewHostKey: true, hostKey: '123456' });
    // Organizer FGA + host-key fetch are fired concurrently, both with the same identity.
    expect(checkSingleAccess).toHaveBeenCalledTimes(1);
    expect(getMeetingHostKey).toHaveBeenCalledTimes(1);
  });

  it('returns organizer=false and no host key for a non-organizer whose host-key fetch returns null', async () => {
    // Query-service enforces FGA `host` on v1_meeting_host_credentials, so an unauthorized
    // caller sees an empty resources array (null hostKey) even without a local host access check.
    const meeting = buildMeeting();
    const { service: access } = mockAccessCheck(false);
    const { service: meetingSvc } = mockMeetingSvc(null);

    const result = await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(result).toEqual({ organizer: false, canViewHostKey: false });
  });

  it('returns the host key for a direct co-host who is not the meeting organizer', async () => {
    // organizer=false but query-service returns a key because the FGA host relation covers
    // registrants with Host=true independently of the organizer/writer chain.
    const meeting = buildMeeting();
    const { service: access } = mockAccessCheck(false);
    const { service: meetingSvc } = mockMeetingSvc('654321');

    const result = await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(result).toEqual({ organizer: false, canViewHostKey: true, hostKey: '654321' });
  });

  it('runs organizer FGA and host-key fetch in parallel with no host tuple in the access check', async () => {
    // The single access-check call must be an organizer-only check — we no longer send a
    // `host` tuple locally because the query-service already enforces FGA on the credentials doc.
    const meeting = buildMeeting();
    const { service: access, checkSingleAccess } = mockAccessCheck(true);
    const { service: meetingSvc } = mockMeetingSvc('123456');

    await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_ID, access: 'organizer' }, undefined);
  });

  it('skips the host-key fetch entirely outside the time window but still resolves organizer', async () => {
    // Starts in 3 days — beyond the 70-min pre-window; the key would be stripped anyway.
    const meeting = buildMeeting({ start_time: isoOffset(3 * 24 * 60 * MIN), duration: 60 });
    const { service: access, checkSingleAccess } = mockAccessCheck(true);
    const { service: meetingSvc, getMeetingHostKey } = mockMeetingSvc('123456');

    const result = await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(checkSingleAccess).toHaveBeenCalledTimes(1);
    expect(getMeetingHostKey).not.toHaveBeenCalled();
    expect(result).toEqual({ organizer: true, canViewHostKey: false });
  });

  it('degrades to canViewHostKey=false when the host-key fetch throws', async () => {
    const meeting = buildMeeting();
    const { service: access } = mockAccessCheck(true);
    const { service: meetingSvc } = mockMeetingSvc(new Error('query service 503'));

    const result = await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting);

    expect(result).toEqual({ organizer: true, canViewHostKey: false });
  });

  it('forwards the bearerToken override to both parallel calls when provided', async () => {
    // Parallel-safe fan-out: callers pass the user token explicitly so the calls don't race on
    // req.bearerToken (which may be holding an M2M token for sibling calls in the same
    // Promise.all).
    const meeting = buildMeeting();
    const { service: access, checkSingleAccess } = mockAccessCheck(false);
    const { service: meetingSvc, getMeetingHostKey } = mockMeetingSvc(null);

    await resolveOrganizerAndHostKey(req, access, meetingSvc as any, meeting, 'user-token');

    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_ID, access: 'organizer' }, { bearerToken: 'user-token' });
    expect(getMeetingHostKey).toHaveBeenCalledWith(req, MEETING_ID, { bearerToken: 'user-token' });
  });
});

describe('applyOrganizerAndHostKeyResult', () => {
  it('applies organizer, can_view_host_key, and host_key when authorized', () => {
    const meeting = buildMeeting();
    delete meeting.host_key;

    applyOrganizerAndHostKeyResult(meeting, { organizer: true, canViewHostKey: true, hostKey: '999999' });

    expect(meeting.organizer).toBe(true);
    expect(meeting.can_view_host_key).toBe(true);
    expect(meeting.host_key).toBe('999999');
  });

  it('strips any existing host_key when canViewHostKey is false', () => {
    // Defense in depth: the meeting builder pre-populates host_key. If the resolution says the
    // caller can't view it, the field must be stripped regardless of what was on the meeting.
    const meeting = buildMeeting();

    applyOrganizerAndHostKeyResult(meeting, { organizer: false, canViewHostKey: false });

    expect(meeting.organizer).toBe(false);
    expect(meeting.can_view_host_key).toBe(false);
    expect(meeting.host_key).toBeUndefined();
  });
});

describe('isWithinHostKeyWindow', () => {
  // Pin a fixed reference point so boundary assertions are fully deterministic.
  const NOW = new Date('2025-06-01T12:00:00.000Z');
  const nowMs = NOW.getTime();

  function iso(offsetMs: number): string {
    return new Date(nowMs + offsetMs).toISOString();
  }

  it('returns true when now is exactly at the window start (start_time − 70 min)', () => {
    // start_time = now + 70 min → windowStart = now exactly
    expect(isWithinHostKeyWindow({ start_time: iso(70 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when now is one ms before the window start', () => {
    const oneMsBefore = new Date(nowMs - 1);
    expect(isWithinHostKeyWindow({ start_time: iso(70 * MIN), duration: 60 }, oneMsBefore)).toBe(false);
  });

  it('returns true during the meeting itself', () => {
    // start_time = 15 min ago; now is 15 min past start, well inside window
    expect(isWithinHostKeyWindow({ start_time: iso(-15 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns true up to 40 min after meeting end', () => {
    // start_time = 90 min ago, duration = 60 → end = 30 min ago, tail ends at now + 10 min
    expect(isWithinHostKeyWindow({ start_time: iso(-90 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when now is exactly at the window end (start + duration + 40 min)', () => {
    // windowEnd = start + 60 + 40 = now → exclusive upper bound, must be false
    expect(isWithinHostKeyWindow({ start_time: iso(-(60 + 40) * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when now is just past the window end', () => {
    expect(isWithinHostKeyWindow({ start_time: iso(-(60 + 41) * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when the meeting is more than 70 min away', () => {
    expect(isWithinHostKeyWindow({ start_time: iso(71 * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('prefers next_occurrence_start_time over start_time for recurring meetings', () => {
    // series start_time is 30 days in the past (window long closed)
    // next_occurrence_start_time is 30 min from now (inside window)
    expect(
      isWithinHostKeyWindow(
        {
          start_time: iso(-30 * 24 * 60 * MIN),
          next_occurrence_start_time: iso(30 * MIN),
          duration: 60,
        },
        NOW
      )
    ).toBe(true);
  });

  it('falls back to start_time when next_occurrence_start_time is absent', () => {
    // start_time is 30 min from now — inside window
    expect(isWithinHostKeyWindow({ start_time: iso(30 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when start_time is absent', () => {
    expect(isWithinHostKeyWindow({ start_time: '', duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when start_time is not a valid date', () => {
    expect(isWithinHostKeyWindow({ start_time: 'not-a-date', duration: 60 }, NOW)).toBe(false);
  });
});

describe('stripHostKey', () => {
  it('removes host_key from a meeting', () => {
    const meeting = buildMeeting();
    stripHostKey(meeting);
    expect(meeting.host_key).toBeUndefined();
  });

  it('leaves other fields intact', () => {
    const meeting = buildMeeting();
    stripHostKey(meeting);
    expect(meeting.id).toBe(MEETING_ID);
    expect(meeting.project_uid).toBe(PROJECT_UID);
  });

  it('no-ops on null/undefined', () => {
    expect(() => stripHostKey(null)).not.toThrow();
    expect(() => stripHostKey(undefined)).not.toThrow();
  });
});
