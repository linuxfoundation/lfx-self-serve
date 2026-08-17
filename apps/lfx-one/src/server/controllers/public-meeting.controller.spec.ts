// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PUBLIC_REGISTRATION_FIELD_MAX_LENGTH } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import type { Meeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceValidationError } from '../errors/service-validation.error';

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
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    getMeetingRegistrantsByEmail: vi.fn(),
    // Called by enrichMeetingsWithCreatedBy (#1155); empty map => enrich is a no-op.
    resolveCreatedByForMeetings: vi.fn().mockResolvedValue(new Map()),
    getMeetingHostKey: vi.fn(),
    getPastOccurrencesForMeeting: vi.fn(),
    addMeetingRegistrantWithM2M: vi.fn(),
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
vi.mock('@lfx-one/shared/utils', () => ({
  resolveMeetingOrganizer: vi.fn(() => null),
  // Real implementation, not a stub: the rejection messages this suite asserts on are built by it, so a
  // stub would make those assertions test the mock's wording rather than the controller's.
  joinAsSentenceList: (labels: readonly string[]) =>
    labels.length < 2 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`,
}));
// meeting.helper imports HOST_KEY_* from shared/constants; stub the barrel so the full constants
// module graph (which re-imports shared/enums for ArtifactVisibility etc.) doesn't load.
vi.mock('@lfx-one/shared/constants', () => ({
  HOST_KEY_EARLY_MINUTES: 70,
  HOST_KEY_LATE_MINUTES: 40,
  MEETING_PASSWORD_HEADER: 'x-meeting-password',
  PUBLIC_REGISTRATION_FIELD_MAX_LENGTH: 255,
  PUBLIC_REGISTRATION_FIELD_LABELS: {
    meeting_id: 'Meeting ID',
    occurrence_id: 'Occurrence ID',
    email: 'Email address',
    first_name: 'First name',
    last_name: 'Last name',
  },
}));
vi.mock('../helpers/validation.helper', () => ({ validateUidParameter: vi.fn(() => true) }));

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
// `stripAuthPrefix` is kept real rather than stubbed: the controller's prefix stripping only matters
// because it has to agree with what the read paths do, and a stand-in here would assert agreement with
// the stand-in instead.
vi.mock('../utils/auth-helper', async () => {
  const actual = await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper');

  return {
    getEffectiveEmail: getEffectiveEmailMock,
    getEffectiveUsername: getEffectiveUsernameMock,
    getUsernameFromAuth: vi.fn(),
    stripAuthPrefix: actual.stripAuthPrefix,
  };
});
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

/**
 * This endpoint is optional-auth and always writes upstream under an M2M token, so apart from the
 * username it reads off a session when one exists, the request body is the only thing describing who
 * the registrant is — and the caller controls all of it.
 */
describe('PublicMeetingController.registerForPublicMeeting', () => {
  let controller: PublicMeetingController;

  const validBody = { meeting_id: MEETING_ID, email: 'a@example.com', first_name: 'A', last_name: 'B' };

  function buildRegisterReqRes(body: Record<string, unknown>) {
    const req = { body, params: {}, query: {}, headers: {}, path: '/public/api/meetings/register', log: {} } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    return { req, res, next: vi.fn() };
  }

  const forwardedBody = () => meetingSvc.addMeetingRegistrantWithM2M.mock.calls[0][1];

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.addMeetingRegistrantWithM2M.mockResolvedValue({ uid: 'reg-1' });
    // Anonymous by default — this route is optional-auth, and `clearAllMocks` leaves return values
    // from earlier suites in place, so pin it rather than inherit one.
    getEffectiveUsernameMock.mockReturnValue(null);
  });

  it('forwards the fields a registrant may state about themselves', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, job_title: 'Dev', org_name: 'Acme' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody()).toMatchObject({ ...validBody, job_title: 'Dev', org_name: 'Acme' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // `host` grants "access to host key for the meeting" upstream, and `committee_uid` claims committee
  // membership. Neither is an anonymous caller's to assert, and the M2M token means upstream has no
  // way to tell that the claim came from the public form.
  it('does not let an anonymous caller grant itself host access or claim a committee', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, host: true, committee_uid: 'committee-1' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody().host).toBe(false);
    expect(forwardedBody()).not.toHaveProperty('committee_uid');
  });

  it('drops any other field the caller invents', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, uid: 'reg-hijack', type: 'committee' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    for (const key of ['uid', 'type']) {
      expect(forwardedBody()).not.toHaveProperty(key);
    }
  });

  it('omits username entirely for an anonymous caller', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, username: 'someone-else' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody()).not.toHaveProperty('username');
  });

  // The route mounts the handler with no express-validator, so a non-string is what actually gets to
  // choose whether it clears the `if (!registrantData.email …)` gate. Narrowing to a string is the
  // only thing that stops an object or array being forwarded upstream under the M2M token.
  it.each([[{ nested: 'x' }], [['a@example.com']], [42], [null]])('rejects a non-string email (%j) instead of forwarding it', async (email) => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, email });

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantWithM2M).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a missing body', async () => {
    const { req, res, next } = buildRegisterReqRes(undefined as any);

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantWithM2M).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // Query-service tag matching is case-sensitive and every read path lowercases, so a mixed-case
  // registration would be indexed under a tag no later invited-status lookup matches.
  it('lowercases and trims the fields it forwards', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, email: '  A@Example.COM ', first_name: ' A ', org_name: ' Acme ' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody()).toMatchObject({ email: 'a@example.com', first_name: 'A', org_name: 'Acme' });
  });

  it.each(['first_name', 'last_name', 'job_title', 'org_name'])('caps %s so nothing unbounded reaches upstream', async (field) => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, [field]: 'x'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH * 2) });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody()[field]).toHaveLength(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH);
  });

  // The three identifiers are rejected rather than capped: truncating one would turn an unusable value
  // into a different, valid-looking one — a lookup against the wrong meeting, an invite to the wrong
  // address, or a registration scoped to the wrong occurrence.
  //
  // Both the field array and the top-level message are asserted. The array alone isn't enough: the
  // modal shows the top-level message — serialized as the body's `error` key — and discards
  // `errors[]`, so a generic message there would leave the registrant with nothing to act on, which is
  // exactly what the old "Registration data validation failed" path did.
  it.each([
    ['email', 'Email address', { email: `${'x'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH)}@example.com` }],
    ['meeting_id', 'Meeting ID', { meeting_id: 'm'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH + 1) }],
    ['occurrence_id', 'Occurrence ID', { occurrence_id: '1'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH + 1) }],
  ])('rejects an over-length %s by name rather than truncating it', async (field, label, overrides) => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, ...overrides });

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantWithM2M).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    const error = next.mock.calls[0][0] as ServiceValidationError;

    // `errors[]` keeps the wire key; the message a person reads gets the label.
    expect(error.validationErrors).toEqual([expect.objectContaining({ field, message: expect.stringContaining(`${PUBLIC_REGISTRATION_FIELD_MAX_LENGTH}`) })]);
    expect(error.message).toBe(`${label} must be ${PUBLIC_REGISTRATION_FIELD_MAX_LENGTH} characters or fewer.`);
  });

  // Two at once, because the join is what a single-field case can't catch: an `and`-joined message has
  // to still read as one sentence, and both fields have to survive into `errors[]`.
  it('names every over-length identifier in one message', async () => {
    const { req, res, next } = buildRegisterReqRes({
      ...validBody,
      meeting_id: 'm'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH + 1),
      email: `${'x'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH)}@example.com`,
    });

    await controller.registerForPublicMeeting(req, res, next);

    const error = next.mock.calls[0][0] as ServiceValidationError;

    expect(error.validationErrors.map((entry) => entry.field)).toEqual(['meeting_id', 'email']);
    expect(error.message).toBe(`Meeting ID and Email address must be ${PUBLIC_REGISTRATION_FIELD_MAX_LENGTH} characters or fewer.`);
  });

  // The required-field path had the same defect the length path was fixed for: its top-level message
  // was a generic "Registration data validation failed", so the registrant saw nothing actionable.
  it.each([
    ['email', { email: '' }, 'Email address is required.'],
    ['first_name', { first_name: '  ' }, 'First name is required.'],
    ['meeting_id', { meeting_id: '' }, 'Meeting ID is required.'],
  ])('names a missing %s in the message the registrant sees', async (field, overrides, expected) => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, ...overrides });

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantWithM2M).not.toHaveBeenCalled();

    const error = next.mock.calls[0][0] as ServiceValidationError;

    expect(error.validationErrors.map((entry) => entry.field)).toEqual([field]);
    expect(error.message).toBe(expected);
  });

  // Which occurrences the registration covers is part of what a registrant states about their own
  // attendance. No in-app caller sends it yet, so only this test keeps it from falling out again.
  it('still forwards a single-occurrence scope', async () => {
    const { req, res, next } = buildRegisterReqRes({ ...validBody, occurrence_id: '1666848600' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody().occurrence_id).toBe('1666848600');
  });

  // Derived from the session, never from the body: a signed-in registrant keeps their LFID on a
  // record written with application credentials, and a forged `username` still can't get in. The
  // provider prefix is stripped because a registrant record stores the plain LFID — every read path
  // strips before matching, so a prefixed row would be invisible to the join-URL lookup.
  it('takes username from the session, strips its provider prefix, and ignores the body', async () => {
    getEffectiveUsernameMock.mockReturnValue('auth0|realuser');
    const { req, res, next } = buildRegisterReqRes({ ...validBody, username: 'someone-else' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(forwardedBody().username).toBe('realuser');
  });

  it('responds with the registrant the service returned', async () => {
    meetingSvc.addMeetingRegistrantWithM2M.mockResolvedValue({ uid: 'reg-1', org_name: 'Acme' });
    const { req, res, next } = buildRegisterReqRes(validBody);

    await controller.registerForPublicMeeting(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ uid: 'reg-1', org_name: 'Acme' });
  });

  it('still rejects a non-public meeting before writing anything', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE }));
    const { req, res, next } = buildRegisterReqRes(validBody);

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantWithM2M).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
