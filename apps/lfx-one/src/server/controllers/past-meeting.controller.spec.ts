// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAST_MEETING_UID = 'a0000000-0000-0000-0000-000000000001';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc, reconciliationSvc, addAccessToResourceMock, validateUidParameterMock, getEffectiveEmailMock } = vi.hoisted(() => ({
  meetingSvc: {
    getPastMeetingById: vi.fn(),
    getPastMeetingParticipants: vi.fn(),
  },
  reconciliationSvc: {
    reconcilePastMeetingParticipants: vi.fn(),
  },
  addAccessToResourceMock: vi.fn(),
  validateUidParameterMock: vi.fn(() => true),
  getEffectiveEmailMock: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/interfaces', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/utils', () => ({
  resolveMeetingOrganizer: vi.fn(() => null),
  resolveMeetingOwner: vi.fn(() => null),
  isShowMeetingAttendeesLocked: vi.fn(
    (meetingType?: string | null, restricted?: boolean | null) => (meetingType ?? '').toLowerCase() === 'board' || restricted === true
  ),
}));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: getEffectiveEmailMock,
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

describe('PastMeetingController.getPastMeetingParticipants — attendee visibility', () => {
  let controller: PastMeetingController;
  const roster = [
    { uid: 'p-self', email: 'user@example.com' },
    { uid: 'p-other', email: 'other@example.com' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    validateUidParameterMock.mockReturnValue(true);
    controller = new PastMeetingController();
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    meetingSvc.getPastMeetingParticipants.mockResolvedValue(roster);
  });

  it('returns the full roster to the organizer even when attendee visibility is off', async () => {
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ show_meeting_attendees: false }));
    addAccessToResourceMock.mockResolvedValue({ organizer: true });
    const res = buildRes();
    const next = vi.fn();

    await controller.getPastMeetingParticipants(buildReq(true), res, next);

    expect(res.json).toHaveBeenCalledWith(roster);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns only the caller row when an invitee requests the roster with attendee visibility off', async () => {
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ show_meeting_attendees: false }));
    addAccessToResourceMock.mockResolvedValue({ organizer: false });
    const res = buildRes();

    await controller.getPastMeetingParticipants(buildReq(true), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([{ uid: 'p-self', email: 'user@example.com' }]);
  });

  it('returns the full roster to a confirmed participant when attendee visibility is on', async () => {
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ show_meeting_attendees: true }));
    addAccessToResourceMock.mockResolvedValue({ organizer: false });
    const res = buildRes();

    await controller.getPastMeetingParticipants(buildReq(true), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(roster);
  });

  it('does not hand the full roster to a non-participant when attendee visibility is on', async () => {
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ show_meeting_attendees: true }));
    addAccessToResourceMock.mockResolvedValue({ organizer: false });
    meetingSvc.getPastMeetingParticipants.mockResolvedValue([{ uid: 'p-other', email: 'other@example.com' }]);
    const res = buildRes();

    await controller.getPastMeetingParticipants(buildReq(true), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('hides the roster from invitees on a board meeting even if the stored flag is on', async () => {
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ show_meeting_attendees: true, meeting_type: 'Board' }));
    addAccessToResourceMock.mockResolvedValue({ organizer: false });
    const res = buildRes();

    await controller.getPastMeetingParticipants(buildReq(true), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([{ uid: 'p-self', email: 'user@example.com' }]);
  });

  it('fails closed to the caller row when the meeting lookup throws', async () => {
    meetingSvc.getPastMeetingById.mockRejectedValue(new Error('upstream down'));
    const res = buildRes();

    await controller.getPastMeetingParticipants(buildReq(true), res, vi.fn());

    expect(addAccessToResourceMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([{ uid: 'p-self', email: 'user@example.com' }]);
  });
});
