// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_UID = 'a0000000-0000-0000-0000-000000000001';
const COMMITTEE_UID = 'b0000000-0000-0000-0000-000000000002';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc } = vi.hoisted(() => ({
  meetingSvc: {
    getMeetingRegistrants: vi.fn(),
    getAuthorizedRegistrantsForImport: vi.fn(),
  },
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/interfaces', async (importOriginal) => importOriginal());
// The real module transitively needs @angular/compiler outside an Angular bootstrap (see
// meeting.utils.spec.ts); validation.helper only needs resolvePeriodRange from it, so stub that.
vi.mock('@lfx-one/shared/utils', () => ({ resolvePeriodRange: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: vi.fn(), getUsernameFromAuth: vi.fn() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));
vi.mock('../helpers/committee-v1-mapping.helper', () => ({ resolveCommitteeV2UidsToV1Ids: vi.fn() }));
vi.mock('../helpers/meeting.helper', () => ({
  addInvitedStatusToMeeting: vi.fn(),
  applyHostKeyVisibility: vi.fn(),
  enrichMeetingsWithCreatedBy: vi.fn(),
  stripHostKey: vi.fn(),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/ai.service', () => ({
  AiService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/nats.service', () => ({
  NatsService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/user.service', () => ({
  UserService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { MeetingController } from './meeting.controller';

function buildReq(query: Record<string, string> = {}): any {
  return { params: { uid: MEETING_UID }, query, path: '/test', log: {} };
}

function buildRes(): any {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
}

// Authorization, membership, project-match, and size-cap rules are business logic tested at
// their source — MeetingService.getAuthorizedRegistrantsForImport (meeting.service.spec.ts) —
// per the three-file pattern (docs/reviews/backend-checklist.md). This spec covers only the
// controller's HTTP-layer responsibility: parsing params and delegating to the right service call.
describe('MeetingController.getMeetingRegistrants — delegation', () => {
  let controller: MeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MeetingController();
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
  });

  it('calls the partial-tolerant getMeetingRegistrants for the 3 pre-existing callers (no fail_on_partial)', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({}), res, next);

    expect(meetingSvc.getAuthorizedRegistrantsForImport).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingRegistrants).toHaveBeenCalledWith(expect.anything(), MEETING_UID, false, undefined, false);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a complete-roster request with no committee_uid, without calling either service method', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(meetingSvc.getAuthorizedRegistrantsForImport).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('delegates a complete-roster request to getAuthorizedRegistrantsForImport with the parsed uid and committee_uid', async () => {
    meetingSvc.getAuthorizedRegistrantsForImport.mockResolvedValue([{ uid: 'r1', email: 'a@example.com' }]);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(meetingSvc.getAuthorizedRegistrantsForImport).toHaveBeenCalledWith(expect.anything(), MEETING_UID, COMMITTEE_UID);
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([{ uid: 'r1', email: 'a@example.com' }]);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a rejection from getAuthorizedRegistrantsForImport via next, without responding', async () => {
    const authError = Object.assign(new Error('Not authorized'), { statusCode: 403 });
    meetingSvc.getAuthorizedRegistrantsForImport.mockRejectedValue(authError);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(next).toHaveBeenCalledWith(authError);
    expect(res.json).not.toHaveBeenCalled();
  });
});
