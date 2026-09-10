// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PUBLIC_REGISTRATION_FIELD_MAX_LENGTH } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import type { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceValidationError } from '../errors/service-validation.error';

const MEETING_ID = 'meeting-1111';
const PROJECT_UID = 'project-2222';

// Hoisted, per-test-controllable mocks. The controller (and the real meeting.helper it delegates
// to for the host-key gate) reach these through the module mocks registered below.
const {
  checkSingleAccessMock,
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
  checkSingleAccessMock: vi.fn(),
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
    getPastMeetingById: vi.fn(),
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
// meeting.helper (kept real via importOriginal) imports resolveMeetingOrganizer and
// resolveMeetingOwner from shared/utils; stub them so the real barrel (and its MeetingType enum
// dependency) isn't pulled into the mock graph. Both null => the enrichment gate always opens,
// but the default empty resolveCreatedByForMeetings map keeps enrichment a pass-through.
vi.mock('@lfx-one/shared/utils', async () => ({
  resolveMeetingOrganizer: vi.fn(() => null),
  resolveMeetingOwner: vi.fn(() => null),
  // The real function rather than a hand-copy, so a change to its wording fails these assertions
  // instead of leaving them green against a stale duplicate. Imported by relative path (the idiom
  // `meeting.controller.spec.ts` already uses for `truncateToUtf16Units`): `string.utils.ts` has no
  // imports of its own, so this pulls in none of the aliased barrel graph the mock exists to avoid.
  joinAsSentenceList: (await import('../../../../../packages/shared/src/utils/string.utils')).joinAsSentenceList,
  // Real too, for the same reason: the field-length assertions are about what the controller sends
  // upstream, and a stub would make them assert nothing.
  truncateToUtf16Units: (await import('../../../../../packages/shared/src/utils/string.utils')).truncateToUtf16Units,
}));
// meeting.helper imports HOST_KEY_* from shared/constants; stub the barrel so the full constants
// module graph (which re-imports shared/enums for ArtifactVisibility etc.) doesn't load.
vi.mock('@lfx-one/shared/constants', async () => ({
  // The real allowlist rather than a hand-copy, on the same reasoning as `joinAsSentenceList`
  // below: a duplicate here would let the leak test further down go green against a list the
  // controller no longer uses. `meeting-registrant.constants.ts` has no runtime imports of its own
  // (its only import is type-only), so this pulls in none of the aliased barrel graph the mock
  // exists to avoid.
  PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS: (await import('../../../../../packages/shared/src/constants/meeting-registrant.constants'))
    .PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS,
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
  ROOT_PROJECT_SLUG: 'ROOT',
}));
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
    return { checkSingleAccess: checkSingleAccessMock, addAccessToResource: addAccessToResourceMock };
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
// Only the two session accessors are stubbed — they are what these tests steer. `stripAuthPrefix` is
// passed through real so anything else the module graph pulls in keeps its actual behaviour rather
// than a stand-in's.
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

// Keep the real host-key gate (resolveOrganizerAndHostKey + applyOrganizerAndHostKeyResult +
// stripHostKey); stub only the registrant-lookup helpers so we don't need M2M/registrant plumbing.
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

function buildPastMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: MEETING_ID,
    project_uid: PROJECT_UID,
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    committees: [],
    start_time: new Date(Date.now() - 60 * 60_000).toISOString(),
    duration: 60,
    scheduled_start_time: new Date(Date.now() - 60 * 60_000).toISOString(),
    scheduled_end_time: new Date(Date.now() - 30 * 60_000).toISOString(),
    meeting_id: 'meeting-orig-1111',
    occurrence_id: 'occurrence-1',
    platform_meeting_id: 'zoom-1111',
    sessions: [],
    ...overrides,
  } as PastMeeting;
}

function buildProject(overrides: Record<string, unknown> = {}) {
  return { name: 'Proj', slug: 'proj', logo_url: 'logo', uid: PROJECT_UID, parent_uid: 'parent', ...overrides };
}

function buildParentProject(overrides: Record<string, unknown> = {}) {
  return { name: 'Foundation', slug: 'foundation', logo_url: 'flogo', uid: 'parent', parent_uid: '', ...overrides };
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
    // Default: host key fetch returns null (unauthorized OR no doc yet — the query-service's
    // FGA gate on v1_meeting_host_credentials returns an empty resources array in both cases).
    // Authorized tests override this.
    meetingSvc.getMeetingHostKey.mockResolvedValue(null);
    // Default: organizer FGA check returns false. Organizer tests override this.
    checkSingleAccessMock.mockResolvedValue(false);
    // Default invited helper: not invited, host_key preserved on the returned object.
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: false }));
  });

  it('strips host_key for an authenticated non-organizer on a PUBLIC non-restricted meeting (the leak regression)', async () => {
    // organizer=false + no host_key returned from the query-service (FGA denies) => can_view_host_key=false.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
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
    checkSingleAccessMock.mockResolvedValue(true);
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
    expect(payload.meeting.organizer).toBe(true);
  });

  it('keeps host_key for a direct co-host who is not the meeting organizer (query-service FGA authorizes the fetch)', async () => {
    // organizer=false but the query-service returns a host_key because the FGA `host` relation
    // on v1_meeting_host_credentials covers registrants with Host=true independently of the
    // organizer chain. No local `host` access-check is needed.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockResolvedValue('123456');
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
    expect(payload.meeting.organizer).toBe(false);
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
    // Query-service blip: fail closed with can_view_host_key=false and no host_key, but do not
    // 500 the meeting response. This is the exact NATS-degraded case that LFXV2-2885 targets.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockRejectedValue(new Error('query service 503'));
    checkSingleAccessMock.mockResolvedValue(true);
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    // The controller should not propagate the error — the meeting is still returned.
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
    // organizer=true is still resolved from the FGA check even though the host-key fetch failed.
    expect(payload.meeting.organizer).toBe(true);
  });

  it('strips host_key for an unauthenticated caller and never runs an access check', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(checkSingleAccessMock).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingHostKey).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('fails closed when authenticated but no user token was captured (never checks access as the M2M identity)', async () => {
    // Optional-auth refresh failure: isAuthenticated() true, but no user bearer token.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(true, /* hasUserToken */ false);

    await controller.getMeetingById(req, res, next);

    // Neither the access check nor the host-key fetch may run under the M2M identity — the
    // application identity could hold writer relations and leak the host key.
    expect(checkSingleAccessMock).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingHostKey).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('passes the captured user token through to both parallel access-check and host-key calls', async () => {
    // Parallel-safe fan-out: the user token is passed per-call so it doesn't race with M2M
    // sibling calls in the same Promise.all that read req.bearerToken.
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingHostKey.mockResolvedValue('123456');
    checkSingleAccessMock.mockResolvedValue(true);
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(checkSingleAccessMock).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_ID, access: 'organizer' }, { bearerToken: 'user-token' });
    expect(meetingSvc.getMeetingHostKey).toHaveBeenCalledWith(req, MEETING_ID, { bearerToken: 'user-token' });
  });

  it('strips host_key for an invited non-organizer on a private restricted meeting', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE, restricted: true }));
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: true }));
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.invited).toBe(true);
    expect(payload.meeting.host_key).toBeUndefined();
  });
});

describe('PublicMeetingController.getMeetingById parent project resolution (LFXV2-3266)', () => {
  let controller: PublicMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
    meetingSvc.getMeetingHostKey.mockResolvedValue(null);
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: false }));
    checkSingleAccessMock.mockResolvedValue(false);
  });

  it('resolves and returns the foundation project', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) => (uid === PROJECT_UID ? buildProject() : buildParentProject()));
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toEqual({ uid: 'parent', name: 'Foundation', slug: 'foundation' });
  });

  it('returns parent: null when the project has no parent_uid', async () => {
    projectSvc.getProjectById.mockResolvedValue(buildProject({ parent_uid: '' }));
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
    // Only the project's own lookup should have run — no parent lookup to skip.
    expect(projectSvc.getProjectById).toHaveBeenCalledTimes(1);
  });

  it('returns parent: null and still responds 200 when the parent lookup throws', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) => {
      if (uid === PROJECT_UID) return buildProject();
      throw new Error('upstream 500');
    });
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
  });

  it('maps a root-slug parent to null', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) =>
      uid === PROJECT_UID ? buildProject() : buildParentProject({ slug: 'ROOT' })
    );
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
  });
});

describe('PublicMeetingController.getPublicPastMeetingById parent project resolution (LFXV2-3266)', () => {
  let controller: PublicMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting());
    checkSingleAccessMock.mockResolvedValue(false);
  });

  it('resolves and returns the foundation project', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) => (uid === PROJECT_UID ? buildProject() : buildParentProject()));
    const { req, res, next } = buildReqRes(false);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toEqual({ uid: 'parent', name: 'Foundation', slug: 'foundation' });
  });

  it('returns parent: null when the project has no parent_uid', async () => {
    projectSvc.getProjectById.mockResolvedValue(buildProject({ parent_uid: '' }));
    const { req, res, next } = buildReqRes(false);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
    // Only the project's own lookup should have run — no parent lookup to skip.
    expect(projectSvc.getProjectById).toHaveBeenCalledTimes(1);
  });

  it('returns parent: null and still responds 200 when the parent lookup throws', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) => {
      if (uid === PROJECT_UID) return buildProject();
      throw new Error('upstream 500');
    });
    const { req, res, next } = buildReqRes(false);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
  });

  it('maps a root-slug parent to null', async () => {
    projectSvc.getProjectById.mockImplementation(async (_req: any, uid: string) =>
      uid === PROJECT_UID ? buildProject() : buildParentProject({ slug: 'ROOT' })
    );
    const { req, res, next } = buildReqRes(false);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.project.parent).toBeNull();
  });
});

describe('PublicMeetingController.getMeetingById organizer privacy (LFXV2-2802)', () => {
  let controller: PublicMeetingController;

  const createdBy = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const owner = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
    projectSvc.getProjectById.mockResolvedValue(buildProject({ parent_uid: '' }));
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ created_by: createdBy, owner } as Partial<Meeting>));
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
    meetingSvc.getMeetingHostKey.mockResolvedValue(null);
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: false }));
    checkSingleAccessMock.mockResolvedValue(false);
  });

  it('strips created_by and owner for an anonymous caller without querying the index', async () => {
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.created_by).toBeUndefined();
    expect(payload.meeting.owner).toBeUndefined();
    expect(meetingSvc.resolveCreatedByForMeetings).not.toHaveBeenCalled();
  });

  it('keeps created_by and owner for an authenticated caller', async () => {
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.created_by).toEqual(createdBy);
    expect(payload.meeting.owner).toEqual(owner);
  });

  // GH-1731: registrant counts removed from this hot path — the roster read here existed only to
  // derive two integers with no remaining consumer.
  it('issues zero registrant-roster queries and carries no registrant count fields on the response', async () => {
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.getMeetingRegistrants).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.individual_registrants_count).toBeUndefined();
    expect(payload.meeting.committee_members_count).toBeUndefined();
  });
});

describe('PublicMeetingController.getPublicPastMeetingById organizer privacy (LFXV2-2802)', () => {
  let controller: PublicMeetingController;

  const createdBy = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const owner = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    projectSvc.getProjectById.mockResolvedValue(buildProject({ parent_uid: '' }));
    meetingSvc.getPastMeetingById.mockResolvedValue(buildPastMeeting({ created_by: createdBy, owner } as Partial<PastMeeting>));
    addAccessToResourceMock.mockImplementation(async (_req: any, resource: any) => ({ ...resource, organizer: false }));
    checkSingleAccessMock.mockResolvedValue(false);
  });

  it('strips created_by and owner for an anonymous caller without querying the index', async () => {
    const { req, res, next } = buildReqRes(false);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.created_by).toBeUndefined();
    expect(payload.meeting.owner).toBeUndefined();
    expect(meetingSvc.resolveCreatedByForMeetings).not.toHaveBeenCalled();
  });

  it('includes created_by and owner in the non-full-access projection for an authenticated caller', async () => {
    const { req, res, next } = buildReqRes(true);

    await controller.getPublicPastMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    // checkPastMeetingAccess is mocked to undefined => the reduced non-full-access projection.
    expect(payload.full_access).toBeFalsy();
    expect(payload.meeting.platform_meeting_id).toBeUndefined();
    expect(payload.meeting.created_by).toEqual(createdBy);
    expect(payload.meeting.owner).toEqual(owner);
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
 * The route requires a session and registers the caller through the meeting service's `self`
 * endpoint, so identity comes off the JWT — but the request body still supplies every descriptive
 * field, and the caller controls all of it.
 */
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
    expect(meetingSvc.addMeetingRegistrantSelf).toHaveBeenCalledWith(
      req,
      MEETING_ID,
      expect.objectContaining({ meeting_id: MEETING_ID, first_name: 'Alice', last_name: 'Liddell', host: false })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ uid: 'reg-1' });
  });

  it("answers with the registrant's own row and drops the audit fields upstream attached", async () => {
    meetingSvc.addMeetingRegistrantSelf.mockResolvedValue({
      uid: 'reg-1',
      meeting_id: MEETING_ID,
      email: 'alice@acme-motors.example',
      first_name: 'Alice',
      last_name: 'Liddell',
      host: false,
      avatar_url: 'https://avatars.example/alice.png',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      // Upstream attaches these as nested user objects, not identifier strings. This route is the one
      // registrant write an anonymous-by-default surface serves, so a roster editor's name, address
      // and username must not ride the response back out.
      created_by: { username: 'roster-admin', email: 'admin@acme-motors.example', name: 'Roster Admin' },
      updated_by: { username: 'roster-admin', email: 'admin@acme-motors.example', name: 'Roster Admin' },
    });
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      uid: 'reg-1',
      meeting_id: MEETING_ID,
      email: 'alice@acme-motors.example',
      first_name: 'Alice',
      last_name: 'Liddell',
      host: false,
      avatar_url: 'https://avatars.example/alice.png',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  /*
   * The allowlist is the whole defence on this route, and it is one line to widen. This asserts the
   * consequence rather than the list: nothing upstream attaches about *other* people, and nothing the
   * registrant is not entitled to assert about themselves, comes back out of the write — so adding any
   * of these keys to `PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS` fails here instead of shipping. The
   * caller is authenticated (the handler rejects anonymous requests by name, covered separately); what
   * is being withheld is roster context about a person, not access to the endpoint.
   */
  it('never lets a roster field back out of a self-registration, whatever upstream attached', async () => {
    const leakable = {
      username: 'alice.liddell',
      committee_uid: 'committee-9',
      committee_name: 'Technical Steering',
      type: 'committee',
      invite_accepted: true,
      attended: true,
      org_is_member: true,
      org_is_project_member: true,
      created_by: { username: 'roster-admin', email: 'admin@acme-motors.example', name: 'Roster Admin' },
      updated_by: { username: 'roster-admin', email: 'admin@acme-motors.example', name: 'Roster Admin' },
      rsvp: { status: 'yes' },
    };
    meetingSvc.addMeetingRegistrantSelf.mockResolvedValue({ uid: 'reg-1', meeting_id: MEETING_ID, ...leakable });
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['meeting_id', 'uid']);
    for (const key of Object.keys(leakable)) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('omits a field the write response never carried rather than stating it as undefined', async () => {
    meetingSvc.addMeetingRegistrantSelf.mockResolvedValue({ uid: 'reg-1', job_title: null });
    const { req, res, next } = buildRegisterReq(true);

    await controller.registerForPublicMeeting(req, res, next);

    // `null` is a value upstream stated; a missing key means the write response didn't say.
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual({ uid: 'reg-1', job_title: null });
    expect('org_name' in payload).toBe(false);
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

  // `host` grants "access to host key for the meeting" upstream, and `committee_uid` claims committee
  // membership. Neither is the caller's to assert about themselves, so `toSelfRegistration` drops both
  // before the body reaches the meeting service.
  it('does not let a caller grant itself host access or claim a committee', async () => {
    const { req, res, next } = buildRegisterReq(true, { host: true, committee_uid: 'committee-1' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const forwarded = meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2];
    expect(forwarded.host).toBe(false);
    expect(forwarded).not.toHaveProperty('committee_uid');
  });

  it('drops any other field the caller invents', async () => {
    const { req, res, next } = buildRegisterReq(true, { username: 'someone-else', uid: 'reg-hijack', type: 'committee' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const forwarded = meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2];
    for (const key of ['username', 'uid', 'type']) {
      expect(forwarded).not.toHaveProperty(key);
    }
  });

  // The route mounts the handler with no express-validator, so a non-string is what actually gets to
  // choose whether it clears the required-field gate. Narrowing to a string is the only thing that
  // stops an object or array being forwarded upstream.
  it.each([[{ nested: 'x' }], [['Alice']], [42], [null]])('rejects a non-string first_name (%j) instead of forwarding it', async (firstName) => {
    const { req, res, next } = buildRegisterReq(true, { first_name: firstName });

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a missing body', async () => {
    const { req, res, next } = buildRegisterReq(true);
    req.body = undefined;

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // Query-service tag matching is case-sensitive and every read path lowercases, so a mixed-case
  // registration would be indexed under a tag no later invited-status lookup matches.
  it('lowercases and trims the fields it forwards', async () => {
    const { req, res, next } = buildRegisterReq(true, { email: '  A@Example.COM ', first_name: ' Alice ', org_name: ' Acme ' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2]).toMatchObject({ email: 'a@example.com', first_name: 'Alice', org_name: 'Acme' });
  });

  it.each(['first_name', 'last_name', 'job_title', 'org_name'])('caps %s so nothing unbounded reaches upstream', async (field) => {
    const { req, res, next } = buildRegisterReq(true, { [field]: 'x'.repeat(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH * 2) });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2][field]).toHaveLength(PUBLIC_REGISTRATION_FIELD_MAX_LENGTH);
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
    const { req, res, next } = buildRegisterReq(true, overrides);

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    const error = next.mock.calls[0][0] as ServiceValidationError;

    // `errors[]` keeps the wire key; the message a person reads gets the label.
    expect(error.validationErrors).toEqual([expect.objectContaining({ field, message: expect.stringContaining(`${PUBLIC_REGISTRATION_FIELD_MAX_LENGTH}`) })]);
    expect(error.message).toBe(`${label} must be ${PUBLIC_REGISTRATION_FIELD_MAX_LENGTH} characters or fewer.`);
  });

  // Two at once, because the join is what a single-field case can't catch: an `and`-joined message has
  // to still read as one sentence, and both fields have to survive into `errors[]`.
  it('names every over-length identifier in one message', async () => {
    const { req, res, next } = buildRegisterReq(true, {
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
  //
  // Only the name fields are covered because they are the only ones this route requires:
  // `meeting_id` is rejected earlier by `validateMeetingId`, and `email` never reaches upstream —
  // `/registrants/self` takes identity off the caller's JWT.
  it.each([
    ['first_name', { first_name: '  ' }, 'First name is required.'],
    ['last_name', { last_name: '' }, 'Last name is required.'],
  ])('names a missing %s in the message the registrant sees', async (field, overrides, expected) => {
    const { req, res, next } = buildRegisterReq(true, overrides);

    await controller.registerForPublicMeeting(req, res, next);

    expect(meetingSvc.addMeetingRegistrantSelf).not.toHaveBeenCalled();

    const error = next.mock.calls[0][0] as ServiceValidationError;

    expect(error.validationErrors.map((entry) => entry.field)).toEqual([field]);
    expect(error.message).toBe(expected);
  });

  // The plural join, on the path a registrant is most likely to hit: an empty form.
  it('names both missing names in one sentence', async () => {
    const { req, res, next } = buildRegisterReq(true, { first_name: '', last_name: '' });

    await controller.registerForPublicMeeting(req, res, next);

    const error = next.mock.calls[0][0] as ServiceValidationError;

    expect(error.validationErrors.map((entry) => entry.field)).toEqual(['first_name', 'last_name']);
    expect(error.message).toBe('First name and Last name are required.');
  });

  // Which occurrences the registration covers is part of what a registrant states about their own
  // attendance. No in-app caller sends it yet, so only this test keeps it from falling out again.
  it('still forwards a single-occurrence scope', async () => {
    const { req, res, next } = buildRegisterReq(true, { occurrence_id: '1666848600' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2].occurrence_id).toBe('1666848600');
  });

  // The address is narrowed here even though upstream reads the real one off the caller's JWT: the
  // over-length guard measures this value and the shared request type requires it, so a padded,
  // differently-cased submission must still normalise rather than reach the guard as typed.
  it('trims and lowercases the submitted email', async () => {
    const { req, res, next } = buildRegisterReq(true, { email: '  A@Example.COM  ' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2].email).toBe('a@example.com');
  });

  // Identity belongs to the `self` endpoint, which takes it off the caller's token. Forwarding a
  // username would be this handler asserting an identity on the registrant's behalf — the exact
  // thing that endpoint exists to prevent — and `addMeetingRegistrantSelf` drops it regardless.
  it('never forwards a username, whoever the session belongs to', async () => {
    getEffectiveUsernameMock.mockReturnValue('auth0|realuser');
    getEffectiveEmailMock.mockReturnValue('a@example.com');
    const { req, res, next } = buildRegisterReq(true, { email: 'a@example.com', username: 'someone-else' });

    await controller.registerForPublicMeeting(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(meetingSvc.addMeetingRegistrantSelf.mock.calls[0][2]).not.toHaveProperty('username');
  });
});
