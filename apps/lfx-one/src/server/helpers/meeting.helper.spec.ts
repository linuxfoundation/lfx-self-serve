// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingUserInfo, PastMeeting } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessCheckService } from '../services/access-check.service';

const { resolveCreatedByForMeetings } = vi.hoisted(() => ({
  resolveCreatedByForMeetings: vi.fn<(req: unknown, uids: string[]) => Promise<Map<string, MeetingUserInfo>>>(),
}));

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths must be mocked (mirrors
// session-store.service.spec.ts). resolveMeetingOrganizer's real behavior is exhaustively covered
// in packages/shared/src/utils/meeting.utils.spec.ts; this faithful stand-in keeps the helper's
// enrich/omit orchestration under test (human creator → skip; service-account/empty → enrich).
const SKIP = ['zoom.webhooks', 'zoom.events'];
vi.mock('@lfx-one/shared/utils', () => ({
  resolveMeetingOrganizer: (meeting: { created_by?: MeetingUserInfo } | null | undefined) => {
    const createdBy = meeting?.created_by;
    if (createdBy?.name && !SKIP.includes((createdBy.username ?? '').toLowerCase())) {
      return createdBy;
    }
    return null;
  },
}));
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));

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

import { applyHostKeyVisibility, enrichMeetingsWithCreatedBy, stripHostKey } from './meeting.helper';

const req = {} as unknown as Request;
const human: MeetingUserInfo = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };

function pastMeeting(overrides: Partial<PastMeeting>): PastMeeting {
  return { id: 'pm-1', meeting_id: 'live-1', ...overrides } as PastMeeting;
}

describe('enrichMeetingsWithCreatedBy', () => {
  beforeEach(() => {
    resolveCreatedByForMeetings.mockReset();
  });

  it('joins past meetings to the live v1_meeting created_by by meeting_id', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['live-1', human]]));
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

  it('leaves meetings that already carry a human created_by untouched and does not query', async () => {
    const meetings = [{ id: 'm-1', created_by: human } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).not.toHaveBeenCalled();
    expect(result[0].created_by).toBe(human);
  });

  it('enriches a service-account created_by (zoom.webhooks) since it is not a human', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['live-2', human]]));
    const meetings = [pastMeeting({ id: 'pm-2', meeting_id: 'live-2', created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } })];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.meeting_id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['live-2']);
    expect(result[0].created_by).toEqual(human);
  });

  it('short-circuits with no query when nothing needs enrichment', async () => {
    const result = await enrichMeetingsWithCreatedBy(req, [], (m: Meeting) => m.id);

    expect(resolveCreatedByForMeetings).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('keys upcoming meetings on their own uid', async () => {
    resolveCreatedByForMeetings.mockResolvedValue(new Map([['up-1', human]]));
    const meetings = [{ id: 'up-1' } as Meeting];

    const result = await enrichMeetingsWithCreatedBy(req, meetings, (m) => m.id);

    expect(resolveCreatedByForMeetings).toHaveBeenCalledWith(req, ['up-1']);
    expect(result[0].created_by).toEqual(human);
  });
});

const MEETING_ID = 'meeting-1111';
const PROJECT_UID = 'project-2222';
const COMMITTEE_A = 'committee-aaaa';
const COMMITTEE_B = 'committee-bbbb';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    project_uid: PROJECT_UID,
    host_key: '123456',
    committees: [{ uid: COMMITTEE_A }],
    // Only the fields the gate reads matter; cast the rest.
    ...overrides,
  } as Meeting;
}

function mockAccessCheck(results: Map<string, boolean>): { service: AccessCheckService; checkAccess: ReturnType<typeof vi.fn> } {
  const checkAccess = vi.fn().mockResolvedValue(results);
  return { service: { checkAccess } as unknown as AccessCheckService, checkAccess };
}

describe('applyHostKeyVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps host_key for a meeting organizer', async () => {
    const meeting = buildMeeting();
    const { service } = mockAccessCheck(
      new Map([
        [MEETING_ID, true],
        [PROJECT_UID, false],
        [COMMITTEE_A, false],
      ])
    );

    await applyHostKeyVisibility(req, service, meeting);

    expect(meeting.organizer).toBe(true);
    expect(meeting.can_view_host_key).toBe(true);
    expect(meeting.host_key).toBe('123456');
  });

  it('keeps host_key for a project writer who is not the organizer', async () => {
    const meeting = buildMeeting();
    const { service } = mockAccessCheck(
      new Map([
        [MEETING_ID, false],
        [PROJECT_UID, true],
        [COMMITTEE_A, false],
      ])
    );

    await applyHostKeyVisibility(req, service, meeting);

    expect(meeting.organizer).toBe(false);
    expect(meeting.can_view_host_key).toBe(true);
    expect(meeting.host_key).toBe('123456');
  });

  it('keeps host_key for a writer on any attached committee', async () => {
    const meeting = buildMeeting({ committees: [{ uid: COMMITTEE_A }, { uid: COMMITTEE_B }] });
    const { service } = mockAccessCheck(
      new Map([
        [MEETING_ID, false],
        [PROJECT_UID, false],
        [COMMITTEE_A, false],
        [COMMITTEE_B, true],
      ])
    );

    await applyHostKeyVisibility(req, service, meeting);

    expect(meeting.can_view_host_key).toBe(true);
    expect(meeting.host_key).toBe('123456');
  });

  it('strips host_key when the user has none of the three relations (the leak regression)', async () => {
    const meeting = buildMeeting();
    const { service } = mockAccessCheck(
      new Map([
        [MEETING_ID, false],
        [PROJECT_UID, false],
        [COMMITTEE_A, false],
      ])
    );

    await applyHostKeyVisibility(req, service, meeting);

    expect(meeting.organizer).toBe(false);
    expect(meeting.can_view_host_key).toBe(false);
    expect(meeting.host_key).toBeUndefined();
  });

  it('batches organizer + project + every committee into a single access-check call', async () => {
    const meeting = buildMeeting({ committees: [{ uid: COMMITTEE_A }, { uid: COMMITTEE_B }] });
    const { service, checkAccess } = mockAccessCheck(new Map());

    await applyHostKeyVisibility(req, service, meeting);

    expect(checkAccess).toHaveBeenCalledTimes(1);
    expect(checkAccess).toHaveBeenCalledWith(req, [
      { resource: 'v1_meeting', id: MEETING_ID, access: 'organizer' },
      { resource: 'project', id: PROJECT_UID, access: 'writer' },
      { resource: 'committee', id: COMMITTEE_A, access: 'writer' },
      { resource: 'committee', id: COMMITTEE_B, access: 'writer' },
    ]);
  });

  it('handles a meeting with no committees (organizer + project only)', async () => {
    const meeting = buildMeeting({ committees: [] });
    const { service, checkAccess } = mockAccessCheck(new Map([[PROJECT_UID, true]]));

    await applyHostKeyVisibility(req, service, meeting);

    expect(checkAccess).toHaveBeenCalledWith(req, [
      { resource: 'v1_meeting', id: MEETING_ID, access: 'organizer' },
      { resource: 'project', id: PROJECT_UID, access: 'writer' },
    ]);
    expect(meeting.can_view_host_key).toBe(true);
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
