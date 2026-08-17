// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_UID = 'a0000000-0000-0000-0000-000000000001';
const COMMITTEE_UID = 'b0000000-0000-0000-0000-000000000002';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc, committeeSvc, accessCheckSvc } = vi.hoisted(() => ({
  meetingSvc: {
    getMeetingRegistrants: vi.fn(),
    getMeetingById: vi.fn(),
  },
  committeeSvc: {
    getCommitteeById: vi.fn(),
  },
  accessCheckSvc: {
    checkSingleAccess: vi.fn(),
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
    return committeeSvc;
  }),
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return accessCheckSvc;
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

describe('MeetingController.getMeetingRegistrants — completeness authorization gate', () => {
  let controller: MeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MeetingController();
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
  });

  it('skips the gate for the 3 pre-existing partial-tolerant callers (no fail_on_partial)', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({}), res, next);

    expect(committeeSvc.getCommitteeById).not.toHaveBeenCalled();
    expect(accessCheckSvc.checkSingleAccess).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingRegistrants).toHaveBeenCalledWith(expect.anything(), MEETING_UID, false, undefined, false);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a complete-roster request with no committee_uid', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('rejects when the caller lacks writer access and the committee is not invite_only', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1', join_mode: 'open' });
    meetingSvc.getMeetingById.mockResolvedValue({ id: MEETING_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('passes through for a non-writer on an invite_only committee — mirrors canSendMemberInvites()', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1', join_mode: 'invite_only' });
    meetingSvc.getMeetingById.mockResolvedValue({ id: MEETING_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    meetingSvc.getMeetingRegistrants.mockResolvedValue([{ uid: 'r1', email: 'a@example.com' }]);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(res.json).toHaveBeenCalledWith([{ uid: 'r1', email: 'a@example.com' }]);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when the committee and meeting belong to different projects', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    meetingSvc.getMeetingById.mockResolvedValue({ id: MEETING_UID, project_uid: 'project-2' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('passes through when the caller is a writer on a same-project committee', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    meetingSvc.getMeetingById.mockResolvedValue({ id: MEETING_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    meetingSvc.getMeetingRegistrants.mockResolvedValue([{ uid: 'r1', email: 'a@example.com' }]);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrants(buildReq({ fail_on_partial: 'true', committee_uid: COMMITTEE_UID }), res, next);

    expect(accessCheckSvc.checkSingleAccess).toHaveBeenCalledWith(expect.anything(), { resource: 'committee', id: COMMITTEE_UID, access: 'writer' });
    expect(meetingSvc.getMeetingRegistrants).toHaveBeenCalledWith(expect.anything(), MEETING_UID, false, undefined, true);
    expect(res.json).toHaveBeenCalledWith([{ uid: 'r1', email: 'a@example.com' }]);
    expect(next).not.toHaveBeenCalled();
  });
});
