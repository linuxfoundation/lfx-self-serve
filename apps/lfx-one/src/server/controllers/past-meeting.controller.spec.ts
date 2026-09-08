// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAST_MEETING_UID = 'a0000000-0000-0000-0000-000000000001';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc, reconciliationSvc, addAccessToResourceMock, checkSingleAccessMock, getPersonasMock, validateUidParameterMock } = vi.hoisted(() => ({
  meetingSvc: {
    getPastMeetingById: vi.fn(),
  },
  reconciliationSvc: {
    reconcilePastMeetingParticipants: vi.fn(),
  },
  addAccessToResourceMock: vi.fn(),
  checkSingleAccessMock: vi.fn(),
  getPersonasMock: vi.fn(),
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
    return { addAccessToResource: addAccessToResourceMock, checkSingleAccess: checkSingleAccessMock };
  }),
}));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: getPersonasMock },
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
// per the three-file pattern. This spec covers only the controller's authorization gate: only the
// organizer, a project writer, or a project ED may reach the AI-backed reconciliation call (GH-1672
// follow-up broadened this from organizer-only).
describe('PastMeetingController.reconcilePastMeetingParticipants — attendance-management authorization gate', () => {
  let controller: PastMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    validateUidParameterMock.mockReturnValue(true);
    checkSingleAccessMock.mockResolvedValue(false);
    getPersonasMock.mockResolvedValue({ isRootWriter: false, isLFStaff: false, personaProjects: {} });
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

  it('runs reconciliation when the caller is not the organizer but is a writer on the meeting project', async () => {
    const pastMeeting = buildPastMeeting({ project_uid: 'project-1' });
    meetingSvc.getPastMeetingById.mockResolvedValue(pastMeeting);
    addAccessToResourceMock.mockResolvedValue({ ...pastMeeting, organizer: false });
    checkSingleAccessMock.mockResolvedValue(true);
    const result = { results: [], candidate_pool_size: 0, auto_applied_count: 0, needs_review_count: 0 };
    reconciliationSvc.reconcilePastMeetingParticipants.mockResolvedValue(result);
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(checkSingleAccessMock).toHaveBeenCalledWith(expect.anything(), { resource: 'project', id: 'project-1', access: 'writer' });
    expect(reconciliationSvc.reconcilePastMeetingParticipants).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });

  it('runs reconciliation when the caller is an Executive Director of the meeting project', async () => {
    const pastMeeting = buildPastMeeting({ project_uid: 'project-1' });
    meetingSvc.getPastMeetingById.mockResolvedValue(pastMeeting);
    addAccessToResourceMock.mockResolvedValue({ ...pastMeeting, organizer: false });
    checkSingleAccessMock.mockResolvedValue(false);
    getPersonasMock.mockResolvedValue({
      isRootWriter: false,
      isLFStaff: false,
      personaProjects: { 'executive-director': [{ projectUid: 'project-1', projectSlug: 'proj-slug', projectName: 'Proj' }] },
    });
    const result = { results: [], candidate_pool_size: 0, auto_applied_count: 0, needs_review_count: 0 };
    reconciliationSvc.reconcilePastMeetingParticipants.mockResolvedValue(result);
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });

  it('runs reconciliation when the caller is root-writer/LF-staff, bypassing per-project ED scoping', async () => {
    const pastMeeting = buildPastMeeting({ project_uid: 'project-1' });
    meetingSvc.getPastMeetingById.mockResolvedValue(pastMeeting);
    addAccessToResourceMock.mockResolvedValue({ ...pastMeeting, organizer: false });
    checkSingleAccessMock.mockResolvedValue(false);
    getPersonasMock.mockResolvedValue({ isRootWriter: true, isLFStaff: false, personaProjects: {} });
    const result = { results: [], candidate_pool_size: 0, auto_applied_count: 0, needs_review_count: 0 };
    reconciliationSvc.reconcilePastMeetingParticipants.mockResolvedValue(result);
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the caller is not the organizer, not a project writer, and not a project ED', async () => {
    const pastMeeting = buildPastMeeting({ project_uid: 'project-1' });
    meetingSvc.getPastMeetingById.mockResolvedValue(pastMeeting);
    addAccessToResourceMock.mockResolvedValue({ ...pastMeeting, organizer: false });
    checkSingleAccessMock.mockResolvedValue(false);
    getPersonasMock.mockResolvedValue({ isRootWriter: false, isLFStaff: false, personaProjects: {} });
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rejects with 403 and fails closed when the ED persona check itself throws', async () => {
    const pastMeeting = buildPastMeeting({ project_uid: 'project-1' });
    meetingSvc.getPastMeetingById.mockResolvedValue(pastMeeting);
    addAccessToResourceMock.mockResolvedValue({ ...pastMeeting, organizer: false });
    checkSingleAccessMock.mockResolvedValue(false);
    getPersonasMock.mockRejectedValue(new Error('persona service unavailable'));
    const res = buildRes();
    const next = vi.fn();

    await controller.reconcilePastMeetingParticipants(buildReq(true), res, next);

    expect(reconciliationSvc.reconcilePastMeetingParticipants).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });
});
