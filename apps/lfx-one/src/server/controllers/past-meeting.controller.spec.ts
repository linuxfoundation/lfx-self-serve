// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAST_MEETING_UID = 'a0000000-0000-0000-0000-000000000001';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc, reconciliationSvc, addAccessToResourceMock, validateUidParameterMock } = vi.hoisted(() => ({
  meetingSvc: {
    getPastMeetingById: vi.fn(),
  },
  reconciliationSvc: {
    reconcilePastMeetingParticipants: vi.fn(),
  },
  addAccessToResourceMock: vi.fn(),
  validateUidParameterMock: vi.fn(() => true),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/interfaces', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/utils', () => ({
  resolveMeetingOrganizer: vi.fn(() => null),
  resolveMeetingOwner: vi.fn(() => null),
}));

vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: validateUidParameterMock,
  validateRequiredParameter: vi.fn(() => true),
}));
// enrichMeetingsWithCreatedBy/stripHostKey aren't exercised by the reconcile path under test.
vi.mock('../helpers/meeting.helper', () => ({
  enrichMeetingsWithCreatedBy: vi.fn(async (_req: unknown, meetings: unknown[]) => meetings),
  stripHostKey: vi.fn(),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/attendance-reconciliation.service', () => ({
  AttendanceReconciliationService: vi.fn(function () {
    return reconciliationSvc;
  }),
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return { addAccessToResource: addAccessToResourceMock };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PastMeetingController } from './past-meeting.controller';

function buildReq(authenticated: boolean): any {
  return {
    params: { uid: PAST_MEETING_UID },
    query: {},
    path: '/test',
    log: {},
    oidc: { isAuthenticated: () => authenticated },
  };
}

function buildRes(): any {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
}

function buildPastMeeting(overrides: Record<string, unknown> = {}): any {
  return { meeting_and_occurrence_id: PAST_MEETING_UID, ...overrides };
}

// Reconciliation matching logic itself is tested at its source (attendance-reconciliation.service.spec.ts)
// per the three-file pattern. This spec covers only the controller's authorization gate: a non-organizer
// must never reach the AI-backed reconciliation call (GH-1672 item 4 organizer-only trigger).
describe('PastMeetingController.reconcilePastMeetingParticipants — organizer gate', () => {
  let controller: PastMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    validateUidParameterMock.mockReturnValue(true);
    controller = new PastMeetingController();
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting());
  });

  it('rejects with 403 and never calls the reconciliation service when the caller is not authenticated', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(false), res, next);

    expect(addAccessToResourceMock).not.toHaveBeenCalled();
    expect(reconciliationSvc.reconcilePastMeetingParticipants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects with 403 and never calls the reconciliation service when the caller is authenticated but not the organizer', async () => {
    addAccessToResourceMock.mockResolvedValue({ ...buildPastMeeting(), organizer: false });
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects with 403 and fails closed when the access check itself throws', async () => {
    addAccessToResourceMock.mockRejectedValue(new Error('access-check unavailable'));
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('runs reconciliation and returns the result when the caller is the organizer', async () => {
    addAccessToResourceMock.mockResolvedValue({ ...buildPastMeeting(), organizer: true });
    const result = { results: [], candidate_pool_size: 5, auto_applied_count: 1, needs_review_count: 4 };
    reconciliationSvc.reconcilePastMeetingParticipants.mockResolvedValue(result);
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).toHaveBeenCalledWith(expect.anything(), PAST_MEETING_UID, buildPastMeeting());
    expect(res.json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });
});
