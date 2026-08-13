// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-one/shared/enums';
import type { Meeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_ID = 'meeting-1111';
const PROJECT_UID = 'project-2222';

// Hoisted, per-test-controllable mocks. The controller (and the real meeting.helper it delegates
// to for the host-key gate) reach these through the module mocks registered below.
const {
  checkAccessMock,
  addAccessToResourceMock,
  generateM2MTokenMock,
  getEffectiveEmailMock,
  getEffectiveUsernameMock,
  validatePasswordMock,
  validateUidParameterMock,
  meetingSvc,
  projectSvc,
  addInvitedStatusToMeetingMock,
} = vi.hoisted(() => ({
  checkAccessMock: vi.fn(),
  addAccessToResourceMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveUsernameMock: vi.fn(),
  validatePasswordMock: vi.fn(),
  validateUidParameterMock: vi.fn<(uid: unknown, req: unknown, next: (err: unknown) => void) => boolean>(() => true),
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    getMeetingRegistrantsByEmail: vi.fn(),
    // Called by enrichMeetingsWithCreatedBy (#1155); empty map => enrich is a no-op.
    resolveCreatedByForMeetings: vi.fn().mockResolvedValue(new Map()),
    getMeetingHostKey: vi.fn(),
    getPastOccurrencesForMeeting: vi.fn(),
    addMeetingRegistrantSelf: vi.fn(),
  },
  projectSvc: { getProjectById: vi.fn() },
  addInvitedStatusToMeetingMock: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into vitest; stub the one runtime shared import
// the controller/gate use. validation.helper is mocked wholesale (see below) so its heavy
// shared/constants + shared/utils module graph never loads.
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));
// meeting.helper (kept real via importOriginal) imports resolveMeetingOrganizer from shared/utils;
// stub it so the real barrel (and its MeetingType enum dependency) isn't pulled into the mock graph.
vi.mock('@lfx-one/shared/utils', () => ({ resolveMeetingOrganizer: vi.fn(() => null) }));
// meeting.helper imports HOST_KEY_* from shared/constants; stub the barrel so the full constants
// module graph (which re-imports shared/enums for ArtifactVisibility etc.) doesn't load.
vi.mock('@lfx-one/shared/constants', () => ({ HOST_KEY_EARLY_MINUTES: 70, HOST_KEY_LATE_MINUTES: 40, MEETING_PASSWORD_HEADER: 'x-meeting-password' }));
vi.mock('../helpers/validation.helper', () => ({ validateUidParameter: validateUidParameterMock }));

vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return projectSvc;
  }),
}));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return { checkAccess: checkAccessMock, addAccessToResource: addAccessToResourceMock };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveUsername: getEffectiveUsernameMock,
  getUsernameFromAuth: vi.fn(),
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
vi.mock('../utils/security.util', () => ({ validatePassword: validatePasswordMock }));

// Keep the real host-key gate (applyHostKeyVisibility + stripHostKey); stub only the
// registrant-lookup helpers so we don't need M2M/registrant plumbing.
vi.mock('../helpers/meeting.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/meeting.helper')>();
  return { ...actual, addInvitedStatusToMeeting: addInvitedStatusToMeetingMock, checkPastMeetingAccess: vi.fn() };
});

import { PublicMeetingController } from './public-meeting.controller';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    project_uid: PROJECT_UID,
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    // host_key is NOT in the meeting API response — the controller fetches it separately
    // via getMeetingHostKey and sets it for authorized callers.
    committees: [],
    // Start 1 min from now, 60-min duration — inside the 70-min pre-window so host-key
    // tests exercise the actual fetch path rather than being rejected by the time gate.
    start_time: new Date(Date.now() + 60_000).toISOString(),
    duration: 60,
    ...overrides,
  } as Meeting;
}

function buildProject() {
  return { name: 'Proj', slug: 'proj', logo_url: 'logo', uid: PROJECT_UID, parent_uid: 'parent' };
}

function buildReqRes(authenticated: boolean, hasUserToken = true) {
  const req = {
    params: { id: MEETING_ID },
    query: {},
    headers: {},
    // Optional-auth routes can be authenticated with no user bearer token (refresh failure).
    bearerToken: hasUserToken ? 'user-token' : undefined,
    oidc: { isAuthenticated: () => authenticated },
    path: '/public/api/meetings/' + MEETING_ID,
    log: {},
  } as any;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
  const next = vi.fn();
  return { req, res, next };
}

// checkAccess now keys results as "id#access" (e.g. "meeting-1111#organizer").
function accessMap(entries: [string, boolean][]): Map<string, boolean> {
  return new Map(entries);
}

describe('PublicMeetingController.getMeetingById host_key gating', () => {
  let controller: PublicMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
    // Default: host key fetch returns null (no access); authorized tests override this.
    meetingSvc.getMeetingHostKey.mockResolvedValue(null);
    // Default invited helper: not invited, host_key preserved on the returned object.
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: false }));
  });

  it('strips host_key for an authenticated non-organizer on a PUBLIC non-restricted meeting (the leak regression)', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    checkAccessMock.mockResolvedValue(
      accessMap([
        [`${MEETING_ID}#organizer`, false],
        [`${MEETING_ID}#host`, false],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('keeps host_key for a meeting organizer', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockResolvedValue('123456');
    checkAccessMock.mockResolvedValue(
      accessMap([
        [`${MEETING_ID}#organizer`, true],
        [`${MEETING_ID}#host`, true],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
  });

  it('keeps host_key for a project writer who is not the organizer (host=true via FGA derivation)', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockResolvedValue('123456');
    checkAccessMock.mockResolvedValue(
      accessMap([
        [`${MEETING_ID}#organizer`, false],
        [`${MEETING_ID}#host`, true],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
  });

  it('does not call getMeetingHostKey for an unauthenticated caller', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(meetingSvc.getMeetingHostKey).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
  });

  it('responds without host_key when getMeetingHostKey throws a non-fatal error', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockRejectedValue(new Error('query service 503'));
    checkAccessMock.mockResolvedValue(
      accessMap([
        [`${MEETING_ID}#organizer`, true],
        [`${MEETING_ID}#host`, true],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    // The controller should not propagate the error — the meeting is still returned.
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
  });

  it('strips host_key for an unauthenticated caller and never runs an access check', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(checkAccessMock).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('fails closed when authenticated but no user token was captured (never checks access as the M2M identity)', async () => {
    // Optional-auth refresh failure: isAuthenticated() true, but no user bearer token.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(true, /* hasUserToken */ false);

    await controller.getMeetingById(req, res, next);

    // The access check must NOT run under the application (M2M) identity.
    expect(checkAccessMock).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('strips host_key for an invited non-organizer on a private restricted meeting', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE, restricted: true }));
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: true }));
    checkAccessMock.mockResolvedValue(
      accessMap([
        [`${MEETING_ID}#organizer`, false],
        [`${MEETING_ID}#host`, false],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.invited).toBe(true);
    expect(payload.meeting.host_key).toBeUndefined();
  });
});

describe('PublicMeetingController.getMeetingOccurrences', () => {
  let controller: PublicMeetingController;

  const T1 = Date.UTC(2026, 6, 16, 9, 30);
  const T2 = Date.UTC(2026, 6, 30, 9, 30);

  const pastSummaries = [
    {
      meeting_and_occurrence_id: `${MEETING_ID}-${T1}`,
      scheduled_start_time: new Date(T1).toISOString(),
      scheduled_end_time: new Date(T1 + 30 * 60000).toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
  });

  it('returns past summaries plus a minimal projection of live occurrences without leaking sensitive fields', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue(pastSummaries);
    meetingSvc.getMeetingById.mockResolvedValue(
      buildMeeting({
        password: 'secret',
        cancelled_occurrences: ['1784323800'],
        occurrences: [
          {
            occurrence_id: String(Math.floor(T2 / 1000)),
            start_time: new Date(T2).toISOString(),
            duration: 30,
            status: 'available',
            title: 'should not leak',
            description: 'should not leak',
            registrant_count: 12,
          },
        ],
      } as Partial<Meeting>)
    );
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingOccurrences(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.past).toEqual(pastSummaries);
    expect(payload.cancelled_occurrences).toEqual(['1784323800']);
    expect(payload.future).toHaveLength(1);
    // Minimal projection only — timestamps and status, no titles/descriptions/counts
    expect(Object.keys(payload.future[0]).sort()).toEqual(['duration', 'occurrence_id', 'start_time', 'status']);
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(payload)).not.toContain('should not leak');
  });

  it('fails closed when the live series fetch fails (visibility cannot be verified)', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue(pastSummaries);
    meetingSvc.getMeetingById.mockRejectedValue(new Error('itx 404'));
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingOccurrences(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(meetingSvc.getPastOccurrencesForMeeting).not.toHaveBeenCalled();
  });

  it('denies an anonymous caller for a private meeting without a password', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE } as Partial<Meeting>));
    validatePasswordMock.mockReturnValue(false);
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingOccurrences(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(meetingSvc.getPastOccurrencesForMeeting).not.toHaveBeenCalled();
  });

  it('allows a private meeting with a valid password', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue(pastSummaries);
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE, password: 'pw' } as Partial<Meeting>));
    validatePasswordMock.mockReturnValue(true);
    const { req, res, next } = buildReqRes(false);
    req.headers['x-meeting-password'] = 'pw';

    await controller.getMeetingOccurrences(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].past).toEqual(pastSummaries);
  });

  it('allows an authenticated registrant on a restricted meeting via the M2M email check', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue(pastSummaries);
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ restricted: true } as Partial<Meeting>));
    validatePasswordMock.mockReturnValue(false);
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    meetingSvc.getMeetingRegistrantsByEmail.mockResolvedValue([{ email: 'user@example.com' }]);
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingOccurrences(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingRegistrantsByEmail).toHaveBeenCalledWith(req, MEETING_ID, 'user@example.com', 'm2m-token');
    expect(res.json.mock.calls[0][0].past).toEqual(pastSummaries);
  });

  it('allows an authenticated organizer on a private meeting and restores the M2M token', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue(pastSummaries);
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE } as Partial<Meeting>));
    validatePasswordMock.mockReturnValue(false);
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    meetingSvc.getMeetingRegistrantsByEmail.mockResolvedValue([]);
    addAccessToResourceMock.mockImplementation(async (_req: any, resource: any) => ({ ...resource, organizer: true }));
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingOccurrences(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].past).toEqual(pastSummaries);
    expect(req.bearerToken).toBe('m2m-token');
  });

  it('runs with an M2M token (public endpoint, no user session required)', async () => {
    meetingSvc.getPastOccurrencesForMeeting.mockResolvedValue([]);
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res } = buildReqRes(false);
    const next = vi.fn();

    await controller.getMeetingOccurrences(req, res, next);

    expect(generateM2MTokenMock).toHaveBeenCalledTimes(1);
    expect(req.bearerToken).toBe('m2m-token');
  });
});

describe('PublicMeetingController.registerForPublicMeeting', () => {
  let controller: PublicMeetingController;

  function buildRegisterReq(authenticated: boolean, body: Record<string, any> = {}, hasUserToken = true) {
    const req = {
      body: { meeting_id: MEETING_ID, first_name: 'Alice', last_name: 'Liddell', ...body },
      headers: {},
      bearerToken: hasUserToken ? 'user-token' : undefined,
      oidc: { isAuthenticated: () => authenticated },
      path: '/public/api/meetings/register',
      log: {},
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    const next = vi.fn();
    return { req, res, next };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.addMeetingRegistrantSelf.mockResolvedValue({ uid: 'reg-1' });
  });

  it('calls addMeetingRegistrantSelf with user token and returns 201', async () => {
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf).toHaveBeenCalledWith(req, MEETING_ID, req.body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ uid: 'reg-1' });
  });

  it('fetches meeting with M2M token then restores user token for self-register', async () => {
    const { req, res, next } = buildRegisterReq(true);
    let tokenAtMeetingFetch: string | undefined;
    let tokenAtSelfRegister: string | undefined;
    meetingSvc.getMeetingById.mockImplementation((r: any) => {
      tokenAtMeetingFetch = r.bearerToken;
      return Promise.resolve(buildMeeting());
    });
    meetingSvc.addMeetingRegistrantSelf.mockImplementation((r: any) => {
      tokenAtSelfRegister = r.bearerToken;
      return Promise.resolve({ uid: 'reg-1' });
    });

    await controller.registerForPublicMeeting(req, res, next);

    expect(tokenAtMeetingFetch).toBe('m2m-token');
    expect(tokenAtSelfRegister).toBe('user-token');
  });

  it('unauthenticated request returns 401 without calling the service', async () => {
    const { req, res, next } = buildRegisterReq(false);

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
  });

  it('missing first_name returns validation error without calling the service', async () => {
    const { req, res, next } = buildRegisterReq(true, { first_name: '' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
  });

  it('non-public meeting returns authorization error', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE }));
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
  });

  it('restricted meeting returns authorization error', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ restricted: true }));
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
  });

  it('missing meeting_id returns validation error', async () => {
    const { req, res, next } = buildRegisterReq(true, { meeting_id: '' });
    validateUidParameterMock.mockImplementationOnce((_uid, _req, nextFn) => {
      nextFn(new Error('Meeting ID is required'));
      return false;
    });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
  });

  it('restores user token when getMeetingById throws', async () => {
    const { req, res, next } = buildRegisterReq(true);
    meetingSvc.getMeetingById.mockRejectedValue(new Error('upstream error'));

    await controller.registerForPublicMeeting(req, res, next);

    expect(req.bearerToken).toBe('user-token');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
