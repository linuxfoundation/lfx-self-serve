// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingUserInfo, PastMeeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// microservice proxy / access-check / committee stack. Only resolveCreatedByForMeetings is exercised.
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

import { enrichMeetingsWithCreatedBy } from './meeting.helper';

const req = {} as any;
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
