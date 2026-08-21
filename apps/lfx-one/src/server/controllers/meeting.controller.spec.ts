// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_UID = 'a0000000-0000-0000-0000-000000000001';
const COMMITTEE_UID = 'b0000000-0000-0000-0000-000000000002';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { meetingSvc, accessCheckSvc, generateM2MToken, getEffectiveEmailMock, addInvitedStatusToMeetingMock, enrichMeetingsWithCreatedByMock } =
  vi.hoisted(() => ({
    meetingSvc: {
      getMeetingRegistrants: vi.fn(),
      getAuthorizedRegistrantsForImport: vi.fn(),
      getMeetingRegistrantsForUser: vi.fn(),
      getMeetingRegistrantCounts: vi.fn(),
      getMeetingById: vi.fn(),
      getMeetingHostKey: vi.fn(),
    },
    accessCheckSvc: { checkSingleAccess: vi.fn() },
    generateM2MToken: vi.fn(),
    getEffectiveEmailMock: vi.fn(),
    addInvitedStatusToMeetingMock: vi.fn(),
    enrichMeetingsWithCreatedByMock: vi.fn(),
  }));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/interfaces', async (importOriginal) => importOriginal());
// The real module transitively needs @angular/compiler outside an Angular bootstrap (see
// meeting.utils.spec.ts); validation.helper only needs resolvePeriodRange from it, and
// meeting.helper (kept real below, for isWithinHostKeyWindow/applyOrganizerAndHostKeyResult)
// needs resolveMeetingOrganizer/resolveMeetingOwner — stub all three.
vi.mock('@lfx-one/shared/utils', () => ({
  resolvePeriodRange: vi.fn(),
  resolveMeetingOrganizer: vi.fn(() => null),
  resolveMeetingOwner: vi.fn(() => null),
}));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveUsername: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../helpers/committee-v1-mapping.helper', () => ({ resolveCommitteeV2UidsToV1Ids: vi.fn() }));
// Keep the real host-key gate (isWithinHostKeyWindow + applyOrganizerAndHostKeyResult); stub
// only the registrant-lookup/enrichment helpers so the controller tests don't need M2M plumbing.
vi.mock('../helpers/meeting.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/meeting.helper')>();
  return { ...actual, addInvitedStatusToMeeting: addInvitedStatusToMeetingMock, enrichMeetingsWithCreatedBy: enrichMeetingsWithCreatedByMock };
});
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

import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
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

function buildMeeting(overrides: Record<string, unknown> = {}): any {
  return {
    id: MEETING_UID,
    project_uid: 'project-1',
    // 1 min from now, 60-min duration — inside the 70-min pre-window so the "authorized"/
    // "unauthorized" tests exercise the real fetch path rather than being skipped by the
    // time gate. The "outside window" test overrides start_time explicitly.
    start_time: new Date(Date.now() + 60_000).toISOString(),
    duration: 60,
    ...overrides,
  };
}

// isWithinHostKeyWindow / applyOrganizerAndHostKeyResult are kept real (see the meeting.helper
// mock above) so these tests exercise the actual host-key gate, not a stub standing in for it.
describe('MeetingController.getMeetingById host-key gating', () => {
  let controller: MeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MeetingController();
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: any) => ({ ...meeting, invited: false }));
    enrichMeetingsWithCreatedByMock.mockImplementation(async (_req: any, meetings: any[]) => meetings);
  });

  it('surfaces the host key for an authorized caller inside the host-key window', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ organizer: true }));
    meetingSvc.getMeetingHostKey.mockResolvedValue('123456');
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingById(buildReq({}), res, next);

    expect(meetingSvc.getMeetingHostKey).toHaveBeenCalledWith(expect.anything(), MEETING_UID);
    const payload = res.json.mock.calls[0][0];
    expect(payload.host_key).toBe('123456');
    expect(payload.can_view_host_key).toBe(true);
    expect(payload.organizer).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('strips the host key when the fetch resolves null (unauthorized, or no credentials doc indexed yet)', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ organizer: false, host_key: 'stale-key' }));
    meetingSvc.getMeetingHostKey.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingById(buildReq({}), res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.host_key).toBeUndefined();
    expect(payload.can_view_host_key).toBe(false);
    expect(payload.organizer).toBe(false);
  });

  it('skips the host-key fetch entirely outside the host-key window', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(
      buildMeeting({ organizer: false, start_time: new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString(), duration: 60 })
    );
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingById(buildReq({}), res, next);

    expect(meetingSvc.getMeetingHostKey).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.host_key).toBeUndefined();
    expect(payload.can_view_host_key).toBe(false);
  });
});

describe('MeetingController.getMeetingRegistrantCounts', () => {
  let controller: MeetingController;

  const M2M_TOKEN = 'm2m-token';
  const DENIED_COUNTS = { individual_registrants_count: 0, committee_members_count: 0, exhaustive: false };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MeetingController();
    (generateM2MToken as ReturnType<typeof vi.fn>).mockResolvedValue(M2M_TOKEN);
    (getEffectiveEmail as ReturnType<typeof vi.fn>).mockReturnValue('user@example.com');
    (getEffectiveUsername as ReturnType<typeof vi.fn>).mockReturnValue('username1');
  });

  it('returns zeroed, non-exhaustive counts and never calls the count service when the caller is neither registrant nor organizer', async () => {
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    meetingSvc.getMeetingRegistrantsForUser.mockResolvedValue([]);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrantCounts(buildReq({}), res, next);

    expect(res.json).toHaveBeenCalledWith(DENIED_COUNTS);
    expect(meetingSvc.getMeetingRegistrantCounts).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates to the count service, carrying the M2M token, once the caller is confirmed a registrant', async () => {
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    meetingSvc.getMeetingRegistrantsForUser.mockResolvedValue([{ uid: 'r1', email: 'user@example.com' }]);
    const counts = { individual_registrants_count: 7, committee_members_count: 3, exhaustive: true };
    meetingSvc.getMeetingRegistrantCounts.mockResolvedValue(counts);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrantCounts(buildReq({}), res, next);

    expect(meetingSvc.getMeetingRegistrantCounts).toHaveBeenCalledWith(expect.anything(), MEETING_UID, M2M_TOKEN);
    expect(res.json).toHaveBeenCalledWith(counts);
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates to the count service when the caller is the organizer, even without a matching registrant record', async () => {
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    meetingSvc.getMeetingRegistrantsForUser.mockResolvedValue([]);
    meetingSvc.getMeetingRegistrantCounts.mockResolvedValue({ individual_registrants_count: 1, committee_members_count: 0, exhaustive: true });
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrantCounts(buildReq({}), res, next);

    expect(meetingSvc.getMeetingRegistrantCounts).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith(DENIED_COUNTS);
  });

  it('propagates a rejection from the count service via next, without responding', async () => {
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    meetingSvc.getMeetingRegistrantsForUser.mockResolvedValue([]);
    const error = new Error('query service down');
    meetingSvc.getMeetingRegistrantCounts.mockRejectedValue(error);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingRegistrantCounts(buildReq({}), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
