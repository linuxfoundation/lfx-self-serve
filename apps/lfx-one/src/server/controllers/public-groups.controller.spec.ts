// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Per-test-controllable service mocks. The controller constructs `new ProjectService()` and
// `new CommitteeService()` as fields, so the mocked constructors must hand back these same
// objects every time (same pattern as public-profile.controller.spec.ts).
const {
  getFoundationProjectUidsMock,
  getPubliclyDiscoverableProjectMock,
  getProjectIdBySlugMock,
  getCommitteesMock,
  resolveCommitteeUidMock,
  getCommitteeByIdMock,
  getCommitteeMembersMock,
  getMeetingsMock,
  proxyRequestMock,
  getCallerGroupStateMock,
} = vi.hoisted(() => ({
  getFoundationProjectUidsMock: vi.fn(),
  getPubliclyDiscoverableProjectMock: vi.fn(),
  getProjectIdBySlugMock: vi.fn(),
  getCommitteesMock: vi.fn(),
  resolveCommitteeUidMock: vi.fn(),
  getCommitteeByIdMock: vi.fn(),
  getCommitteeMembersMock: vi.fn(),
  getMeetingsMock: vi.fn(),
  proxyRequestMock: vi.fn(),
  getCallerGroupStateMock: vi.fn(),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return {
      getFoundationProjectUids: getFoundationProjectUidsMock,
      getPubliclyDiscoverableProject: getPubliclyDiscoverableProjectMock,
      getProjectIdBySlug: getProjectIdBySlugMock,
    };
  }),
}));

vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return {
      getCommittees: getCommitteesMock,
      resolveCommitteeUid: resolveCommitteeUidMock,
      getCommitteeById: getCommitteeByIdMock,
      getCommitteeMembers: getCommitteeMembersMock,
      getCallerGroupState: getCallerGroupStateMock,
    };
  }),
}));

vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return { getMeetings: getMeetingsMock };
  }),
}));

vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn(function () {
    return { proxyRequest: proxyRequestMock };
  }),
}));

vi.mock('../utils/m2m-token.util', () => ({
  generateM2MToken: vi.fn(async () => 'm2m-token'),
}));

// meeting.utils.ts statically imports HttpParams from @angular/common/http, which crashes JIT
// compilation under plain-Node vitest (no @angular/compiler loaded). getPublicGroupsByFoundation
// never calls buildCommitteeCadenceSummary (only getPublicGroupById does), so a stub is sufficient
// and keeps this spec from depending on an unrelated Angular-runtime constraint.
vi.mock('@lfx-one/shared/utils/meeting.utils', () => ({
  buildCommitteeCadenceSummary: vi.fn(() => ''),
}));

// validation.helper.ts imports `resolvePeriodRange` from the `@lfx-one/shared/utils` barrel, which
// transitively pulls in form.utils.ts/vote.utils.ts/social-listening-filter.utils.ts — all of which
// statically import Angular browser packages (GH-2381). getPublicGroupsByFoundation never calls
// validateUidParameter (only getPublicGroupById does), so a stub is sufficient here too.
vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: vi.fn(() => true),
}));

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { PublicGroupsController } from './public-groups.controller';

const FOUNDATION_UID = '11111111-1111-4111-8111-111111111111';
const PROJECT_UID = '22222222-2222-4222-8222-222222222222';
const PARENT_UID = '33333333-3333-4333-8333-333333333333';

/** A discoverable project fixture whose name/slug/logo are derived from its UID, so leaks are easy to spot. */
function discoverable(uid: string, overrides: Record<string, unknown> = {}) {
  return { uid, name: `name-${uid}`, slug: `slug-${uid}`, logo_url: `logo-${uid}`, public: true, stage: 'Active', parent_uid: '', ...overrides };
}

/** Asserts `hidden` was answered with the same not-found error as `unknown`, with no response body. */
function expectSameNotFound(
  hidden: { res: Response & { json: Mock }; next: NextFunction & Mock },
  unknown: { res: Response & { json: Mock }; next: NextFunction & Mock }
): void {
  expect(hidden.res.json).not.toHaveBeenCalled();
  expect(unknown.res.json).not.toHaveBeenCalled();
  const [hiddenError] = hidden.next.mock.calls[0];
  const [unknownError] = unknown.next.mock.calls[0];
  expect(hiddenError).toBeInstanceOf(ResourceNotFoundError);
  expect(unknownError).toBeInstanceOf(ResourceNotFoundError);
  expect(hiddenError.statusCode).toBe(404);
  expect(hiddenError.message).toBe(unknownError.message);
  expect(hiddenError.toResponse()).toEqual(unknownError.toResponse());
  expect(vi.mocked(hidden.res.setHeader).mock.calls).toEqual(vi.mocked(unknown.res.setHeader).mock.calls);
  expect(hidden.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
}

function buildReqRes(identifier: string): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
  const req = { params: { identifier }, path: `/public/api/foundations/${identifier}/groups`, log: {} } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() } as unknown as Response & { json: Mock };
  const next = vi.fn() as unknown as NextFunction & Mock;
  return { req, res, next };
}

function committee(uid: string, projectUid: string): Committee {
  return { uid, name: `Committee ${uid}`, public: true, project_uid: projectUid } as Committee;
}

describe('PublicGroupsController.getPublicGroupsByFoundation — fan-out cap', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getCommitteesMock.mockResolvedValue([]);
  });

  it('does not truncate and omits `truncated` from the response when childUids is under the cap', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.truncated).toBeUndefined();
    // Every discovered UID (foundation excluded — it's not in childUids) is queried, none dropped.
    expect(getCommitteesMock).toHaveBeenCalledTimes(2);
  });

  it('truncates, sets `truncated: true`, and pins the foundationUid so it always survives the cap', async () => {
    // foundationUid must be a valid UUID (so resolveProjectIdentifier takes the direct-UID branch),
    // which means it can never sort after a hex-free string like 'zzz-project-*' — a prior version
    // of this test used that pairing and Cursor Bugbot correctly flagged that the foundation would
    // have survived a naive sort anyway, so the pin was untested. Instead, the other 199 UIDs here
    // sort BEFORE the foundationUid ('0-project-*' < '1111...'), so a naive sort-then-slice(150)
    // would push foundationUid to the end and drop it — the exact regression the pin guards against.
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    const childUids = [foundationUid, ...Array.from({ length: 199 }, (_, i) => `0-project-${i}`)];
    getFoundationProjectUidsMock.mockResolvedValue(childUids);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.truncated).toBe(true);

    // Exactly 150 UIDs were queried (the cap), and the foundation's own UID is one of them.
    expect(getCommitteesMock).toHaveBeenCalledTimes(150);
    const queriedUids = getCommitteesMock.mock.calls.map((call) => (call[1].tags as string).replace('project_uid:', ''));
    expect(queriedUids).toContain(foundationUid);
    expect(new Set(queriedUids).size).toBe(150);
  });

  it('deduplicates public committees returned for multiple projects and excludes non-public ones', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    getCommitteesMock.mockImplementation(async (_req: Request, params: { tags: string }) => {
      if (params.tags === 'project_uid:project-1') {
        return [committee('shared-committee', 'project-1'), { ...committee('private-committee', 'project-1'), public: false }];
      }
      return [committee('shared-committee', 'project-2')];
    });
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups).toHaveLength(1);
    expect(response.total).toBe(1);
  });
});

describe('PublicGroupsController.getPublicGroupsByFoundation — discoverability (lfx-self-serve-ops#437)', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getFoundationProjectUidsMock.mockResolvedValue([FOUNDATION_UID, 'child-visible', 'child-hidden']);
    getCommitteesMock.mockImplementation(async (_req: Request, params: { tags: string }) => {
      const uid = params.tags.replace('project_uid:', '');
      return [committee(`committee-of-${uid}`, uid)];
    });
  });

  it('answers a hidden foundation slug exactly like an unknown slug, before any fan-out', async () => {
    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: '', slug: 'secret', exists: false });
    const unknown = buildReqRes('secret');
    await controller.getPublicGroupsByFoundation(unknown.req, unknown.res, unknown.next);

    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: FOUNDATION_UID, slug: 'secret', exists: true });
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const hidden = buildReqRes('secret');
    await controller.getPublicGroupsByFoundation(hidden.req, hidden.res, hidden.next);

    expectSameNotFound(hidden, unknown);
    expect(getFoundationProjectUidsMock).not.toHaveBeenCalled();
    expect(getCommitteesMock).not.toHaveBeenCalled();
  });

  it('returns a 404 not-found error for a hidden foundation UID', async () => {
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it("excludes a hidden child project's committees and counts only what remains", async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => (uid === 'child-hidden' ? null : discoverable(uid)));
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid).sort()).toEqual([`committee-of-${FOUNDATION_UID}`, 'committee-of-child-visible'].sort());
    expect(response.total).toBe(2);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('child-hidden');
  });

  it("drops a child project's committees when its context lookup fails transiently", async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => {
      if (uid === 'child-hidden') {
        throw new Error('upstream 503');
      }
      return discoverable(uid);
    });
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid).sort()).toEqual([`committee-of-${FOUNDATION_UID}`, 'committee-of-child-visible'].sort());
    expect(response.total).toBe(2);
  });

  it('passes a transient foundation lookup failure to next() before any fan-out', async () => {
    const boom = new Error('upstream 503');
    getPubliclyDiscoverableProjectMock.mockRejectedValueOnce(boom);
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(getFoundationProjectUidsMock).not.toHaveBeenCalled();
  });

  it('answers a foundation slug metadata outage exactly like an unknown slug without caching the refusal', async () => {
    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: '', slug: 'secret', exists: false });
    const unknown = buildReqRes('secret');
    await controller.getPublicGroupsByFoundation(unknown.req, unknown.res, unknown.next);

    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: FOUNDATION_UID, slug: 'secret', exists: true });
    getPubliclyDiscoverableProjectMock.mockRejectedValueOnce(new Error('upstream 503'));
    const unavailable = buildReqRes('secret');
    await controller.getPublicGroupsByFoundation(unavailable.req, unavailable.res, unavailable.next);

    expectSameNotFound(unavailable, unknown);
  });

  it("keeps the foundation's own committees even when its context lookup is unconfirmed", async () => {
    // First call is the gate on the foundation itself; later calls are resolveContextProjects.
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => (uid === 'child-visible' ? discoverable(uid) : null));
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(discoverable(FOUNDATION_UID));
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid)).toContain(`committee-of-${FOUNDATION_UID}`);
    expect(response.total).toBe(2);
  });
});

describe('PublicGroupsController.getPublicGroupsByProject — discoverability (lfx-self-serve-ops#437)', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getCommitteesMock.mockResolvedValue([committee('tsc', PROJECT_UID), { ...committee('private-wg', PROJECT_UID), public: false }]);
  });

  it('answers a hidden project slug exactly like an unknown slug', async () => {
    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: '', slug: 'secret', exists: false });
    const unknown = buildReqRes('secret');
    await controller.getPublicGroupsByProject(unknown.req, unknown.res, unknown.next);

    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: PROJECT_UID, slug: 'secret', exists: true });
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const hidden = buildReqRes('secret');
    await controller.getPublicGroupsByProject(hidden.req, hidden.res, hidden.next);

    expectSameNotFound(hidden, unknown);
    expect(getCommitteesMock).not.toHaveBeenCalled();
  });

  it('returns a 404 not-found error, with no project fields, for a hidden project UID', async () => {
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('treats a project whose parent foundation is hidden as top-level, leaking no parent name/slug/logo', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) =>
      uid === PARENT_UID ? null : discoverable(uid, { parent_uid: PARENT_UID })
    );
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getPubliclyDiscoverableProjectMock).toHaveBeenCalledWith(req, PARENT_UID, { bearerToken: 'm2m-token' });
    const response = res.json.mock.calls[0][0];
    expect(response.groups[0].context).toMatchObject({ scope: 'foundation', foundation_uid: PROJECT_UID, foundation_name: `name-${PROJECT_UID}` });
    const serialized = JSON.stringify(response);
    for (const leaked of [`name-${PARENT_UID}`, `slug-${PARENT_UID}`, `logo-${PARENT_UID}`]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('treats the project as top-level when its parent lookup fails transiently', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => {
      if (uid === PARENT_UID) {
        throw new Error('upstream 503');
      }
      return discoverable(uid, { parent_uid: PARENT_UID });
    });
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].groups[0].context).toMatchObject({ scope: 'foundation', foundation_uid: PROJECT_UID });
  });

  it('passes a transient lookup failure for the project itself to next() rather than answering not-found', async () => {
    const boom = new Error('upstream 503');
    getPubliclyDiscoverableProjectMock.mockRejectedValueOnce(boom);
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('answers a project slug metadata outage exactly like an unknown slug without caching the refusal', async () => {
    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: '', slug: 'secret', exists: false });
    const unknown = buildReqRes('secret');
    await controller.getPublicGroupsByProject(unknown.req, unknown.res, unknown.next);

    getProjectIdBySlugMock.mockResolvedValueOnce({ uid: PROJECT_UID, slug: 'secret', exists: true });
    getPubliclyDiscoverableProjectMock.mockRejectedValueOnce(new Error('upstream 503'));
    const unavailable = buildReqRes('secret');
    await controller.getPublicGroupsByProject(unavailable.req, unavailable.res, unavailable.next);

    expectSameNotFound(unavailable, unknown);
  });

  it('nests the project under a discoverable parent foundation', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) =>
      uid === PARENT_UID ? discoverable(uid) : discoverable(uid, { parent_uid: PARENT_UID })
    );
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].groups[0].context).toMatchObject({
      scope: 'project',
      foundation_uid: PARENT_UID,
      foundation_name: `name-${PARENT_UID}`,
      project_uid: PROJECT_UID,
    });
  });

  it('still excludes non-public committees (AC-5)', async () => {
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid)).toEqual(['tsc']);
    expect(response.total).toBe(1);
  });
});

describe('PublicGroupsController.getPublicGroupById — chairs and member_visibility', () => {
  const GROUP_UID = 'c0000000-0000-0000-0000-000000000010';
  const MEMBERS = [
    { uid: 'm1', first_name: 'Ada', last_name: 'Example', role: { name: 'Chair' }, organization: { name: 'Vendor Corp' } },
    { uid: 'm2', first_name: 'Bo', last_name: 'Example', role: { name: 'None' } },
  ];
  let controller: PublicGroupsController;

  function buildGroupReqRes(): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
    const req = { params: { id: GROUP_UID }, path: `/public/api/groups/${GROUP_UID}`, log: {} } as unknown as Request;
    const res = { json: vi.fn(), setHeader: vi.fn() } as unknown as Response & { json: Mock };
    const next = vi.fn() as unknown as NextFunction & Mock;
    return { req, res, next };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    resolveCommitteeUidMock.mockResolvedValue(GROUP_UID);
    getCommitteeMembersMock.mockResolvedValue(MEMBERS);
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getMeetingsMock.mockResolvedValue({ data: [] });
    proxyRequestMock.mockResolvedValue({ resources: [] });
  });

  it('lists chairs when visibility is basic_profile', async () => {
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: true, project_uid: 'p1', member_visibility: 'basic_profile' });
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ member_visibility: 'basic_profile', chairs: [{ name: 'Ada Example', organization: 'Vendor Corp', role: 'Chair' }] })
    );
  });

  it.each([
    ['hidden', 'hidden'],
    ['unset', undefined],
    ['an unknown value', 'everyone'],
  ])('withholds chairs and reports hidden when visibility is %s', async (_label, memberVisibility) => {
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: true, project_uid: 'p1', member_visibility: memberVisibility });
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ member_visibility: 'hidden', chairs: [] }));
  });
});

describe('PublicGroupsController.getPublicGroupById — discoverability (lfx-self-serve-ops#437)', () => {
  const GROUP_UID = 'c0000000-0000-0000-0000-000000000020';
  let controller: PublicGroupsController;

  function buildGroupReqRes(id: string = GROUP_UID): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
    const req = { params: { id }, path: `/public/api/groups/${id}`, log: {} } as unknown as Request;
    const res = { json: vi.fn(), setHeader: vi.fn() } as unknown as Response & { json: Mock };
    const next = vi.fn() as unknown as NextFunction & Mock;
    return { req, res, next };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    resolveCommitteeUidMock.mockResolvedValue(GROUP_UID);
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: true, project_uid: PROJECT_UID });
    getCommitteeMembersMock.mockResolvedValue([]);
    getMeetingsMock.mockResolvedValue({ data: [] });
    proxyRequestMock.mockResolvedValue({ resources: [] });
  });

  it.each([true, false, undefined])('answers a group with public=%s under a hidden project exactly like an unknown group', async (isPublic) => {
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: isPublic, project_uid: PROJECT_UID });
    getPubliclyDiscoverableProjectMock.mockResolvedValue(null);
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    const [error] = next.mock.calls[0];
    // The same error resolveCommitteeUid throws for an unknown group identifier on this route.
    const unknown = new ResourceNotFoundError('Group', GROUP_UID, {
      operation: 'get_public_group_by_id',
      service: 'public_groups_controller',
      path: `/groups/${GROUP_UID}`,
    });
    expect(error).toBeInstanceOf(ResourceNotFoundError);
    expect(error.statusCode).toBe(404);
    expect(error.toResponse()).toEqual(unknown.toResponse());
  });

  it.each([false, undefined])('retains the private-group 403 for public=%s under a discoverable project', async (isPublic) => {
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: isPublic, project_uid: PROJECT_UID });
    getPubliclyDiscoverableProjectMock.mockResolvedValue(discoverable(PROJECT_UID));
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    const [error] = next.mock.calls[0];
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('GROUP_PRIVATE');
    expect(res.json).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('treats a project whose parent foundation is hidden as top-level, leaking no parent name/slug/logo', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) =>
      uid === PARENT_UID ? null : discoverable(uid, { parent_uid: PARENT_UID })
    );
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getPubliclyDiscoverableProjectMock).toHaveBeenCalledWith(req, PARENT_UID, undefined);
    const detail = res.json.mock.calls[0][0];
    expect(detail.context).toEqual({
      scope: 'foundation',
      foundation_uid: PROJECT_UID,
      foundation_name: `name-${PROJECT_UID}`,
      foundation_slug: `slug-${PROJECT_UID}`,
      foundation_logo_url: `logo-${PROJECT_UID}`,
    });
    const serialized = JSON.stringify(detail);
    for (const leaked of [PARENT_UID, `name-${PARENT_UID}`, `slug-${PARENT_UID}`, `logo-${PARENT_UID}`]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('nests the project under a discoverable parent foundation', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) =>
      uid === PARENT_UID ? discoverable(uid) : discoverable(uid, { parent_uid: PARENT_UID })
    );
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].context).toMatchObject({
      scope: 'project',
      foundation_uid: PARENT_UID,
      foundation_name: `name-${PARENT_UID}`,
      project_uid: PROJECT_UID,
      project_name: `name-${PROJECT_UID}`,
    });
  });
  it('answers an unknown group UUID and a group under a hidden project with the same not-found error', async () => {
    getCommitteeByIdMock.mockRejectedValueOnce(new MicroserviceError('committee not found', 404, 'NOT_FOUND'));
    const unknown = buildGroupReqRes();
    await controller.getPublicGroupById(unknown.req, unknown.res, unknown.next);

    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const hidden = buildGroupReqRes();
    await controller.getPublicGroupById(hidden.req, hidden.res, hidden.next);

    const [unknownError] = unknown.next.mock.calls[0];
    const [hiddenError] = hidden.next.mock.calls[0];
    expect(unknownError).toBeInstanceOf(ResourceNotFoundError);
    expect(hiddenError).toBeInstanceOf(ResourceNotFoundError);
    expect(hiddenError.toResponse()).toEqual(unknownError.toResponse());
    expect(unknown.res.json).not.toHaveBeenCalled();
    expect(hidden.res.json).not.toHaveBeenCalled();
  });

  it('passes a non-404 committee lookup failure through unchanged', async () => {
    const boom = new MicroserviceError('unavailable', 503, 'SERVICE_UNAVAILABLE');
    getCommitteeByIdMock.mockRejectedValueOnce(boom);
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('gates on the owning project before fetching members, meetings, or mailing lists', async () => {
    getPubliclyDiscoverableProjectMock.mockResolvedValue(null);
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(getCommitteeMembersMock).not.toHaveBeenCalled();
    expect(getMeetingsMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it.each([
    [GROUP_UID, true],
    [GROUP_UID, false],
    ['secret-group', true],
    ['secret-group', false],
  ] as const)('answers an owning-project outage exactly like an unknown group for %s with public=%s', async (id, isPublic) => {
    getCommitteeByIdMock.mockResolvedValue({ uid: GROUP_UID, name: 'TSC', public: isPublic, project_uid: PROJECT_UID });
    if (id === GROUP_UID) {
      getCommitteeByIdMock.mockRejectedValueOnce(new MicroserviceError('committee not found', 404, 'NOT_FOUND'));
    } else {
      resolveCommitteeUidMock.mockRejectedValueOnce(
        new ResourceNotFoundError('Group', id, { operation: 'get_public_group_by_id', service: 'public_groups_controller', path: `/groups/${id}` })
      );
    }
    const unknown = buildGroupReqRes(id);
    await controller.getPublicGroupById(unknown.req, unknown.res, unknown.next);

    getPubliclyDiscoverableProjectMock.mockRejectedValueOnce(new Error('upstream 503'));
    const unavailable = buildGroupReqRes(id);
    await controller.getPublicGroupById(unavailable.req, unavailable.res, unavailable.next);

    expectSameNotFound(unavailable, unknown);
  });

  it('treats a project as top-level when its parent lookup fails transiently', async () => {
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => {
      if (uid === PARENT_UID) {
        throw new Error('upstream 503');
      }
      return discoverable(uid, { parent_uid: PARENT_UID });
    });
    const { req, res, next } = buildGroupReqRes();

    await controller.getPublicGroupById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].context).toMatchObject({ scope: 'foundation', foundation_uid: PROJECT_UID });
  });
});

describe('PublicGroupsController directory — caller membership state (#3595)', () => {
  let controller: PublicGroupsController;

  function groupsOf(res: Response & { json: Mock }): Record<string, unknown>[] {
    return res.json.mock.calls[0][0].groups;
  }

  function byUid(res: Response & { json: Mock }): Record<string, Record<string, unknown>> {
    return Object.fromEntries(groupsOf(res).map((g) => [g['uid'] as string, g]));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getCommitteesMock.mockResolvedValue([committee('a-member', PROJECT_UID), committee('b-pending', PROJECT_UID), committee('c-other', PROJECT_UID)]);
    getCallerGroupStateMock.mockResolvedValue({ memberUids: new Set(['a-member', 'elsewhere']), pendingApplicationUids: new Set(['b-pending']) });
  });

  it('gives anonymous callers the same shape with no membership fields and no private cache header', async () => {
    getCallerGroupStateMock.mockResolvedValue(null);
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    for (const group of groupsOf(res)) {
      expect(group).not.toHaveProperty('is_member');
      expect(group).not.toHaveProperty('has_pending_application');
    }
    expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('folds one caller-state lookup, run alongside the directory fetch, into every group', async () => {
    // Hold the lookup open: the directory query must still start, so the two run together.
    let release!: (state: unknown) => void;
    getCallerGroupStateMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { req, res, next } = buildReqRes(PROJECT_UID);

    const pending = controller.getPublicGroupsByProject(req, res, next);
    await vi.waitFor(() => expect(getCommitteesMock).toHaveBeenCalledTimes(1));
    release({ memberUids: new Set(['a-member']), pendingApplicationUids: new Set(['b-pending']) });
    await pending;

    expect(next).not.toHaveBeenCalled();
    expect(getCallerGroupStateMock).toHaveBeenCalledTimes(1);
    expect(getCommitteeMembersMock).not.toHaveBeenCalled();
    expect(byUid(res)['a-member']).toMatchObject({ is_member: true, has_pending_application: false });
    expect(byUid(res)['b-pending']).toMatchObject({ is_member: false, has_pending_application: true });
    expect(byUid(res)['c-other']).toMatchObject({ is_member: false, has_pending_application: false });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it("scopes the M2M token to the directory's upstream calls and leaves the caller's token on req", async () => {
    const { req, res, next } = buildReqRes(PROJECT_UID);
    Object.assign(req, { bearerToken: 'user-token' });

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.bearerToken).toBe('user-token');
    expect(getPubliclyDiscoverableProjectMock).toHaveBeenCalledWith(req, PROJECT_UID, { bearerToken: 'm2m-token' });
    expect(getCommitteesMock).toHaveBeenCalledWith(
      req,
      { tags: `project_uid:${PROJECT_UID}` },
      { skipMailingListEnrichment: true, requestOptions: { bearerToken: 'm2m-token' } }
    );
  });

  it('carries the same flags on the foundation directory, with the M2M token scoped the same way', async () => {
    getFoundationProjectUidsMock.mockResolvedValue([FOUNDATION_UID]);
    getCommitteesMock.mockResolvedValue([committee('a-member', FOUNDATION_UID), committee('c-other', FOUNDATION_UID)]);
    const { req, res, next } = buildReqRes(FOUNDATION_UID);
    Object.assign(req, { bearerToken: 'user-token' });

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.bearerToken).toBe('user-token');
    expect(getFoundationProjectUidsMock).toHaveBeenCalledWith(req, FOUNDATION_UID, { bearerToken: 'm2m-token' });
    expect(getCallerGroupStateMock).toHaveBeenCalledTimes(1);
    expect(byUid(res)['a-member']).toMatchObject({ is_member: true, has_pending_application: false });
    expect(byUid(res)['c-other']).toMatchObject({ is_member: false, has_pending_application: false });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('omits a flag whose set is unknown instead of answering false', async () => {
    getCallerGroupStateMock.mockResolvedValue({ memberUids: null, pendingApplicationUids: new Set(['b-pending']) });
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    for (const group of groupsOf(res)) {
      expect(group).not.toHaveProperty('is_member');
    }
    expect(byUid(res)['b-pending']).toMatchObject({ has_pending_application: true });
    expect(byUid(res)['c-other']).toMatchObject({ has_pending_application: false });
  });

  it('populates slug from the vanity group name and exposes no mailing list or external sources', async () => {
    getCommitteesMock.mockResolvedValue([
      {
        ...committee('tsc', PROJECT_UID),
        sso_group_name: 'tsc-slug',
        mailing_list: 'private-list@lists.example.org',
        external_sources: [{ provider: 'ocg', entity_type: 'group', label: 'OCG', url: 'https://example.org' }],
      },
      committee('no-slug', PROJECT_UID),
    ]);
    const { req, res, next } = buildReqRes(PROJECT_UID);

    await controller.getPublicGroupsByProject(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(byUid(res)['tsc']['slug']).toBe('tsc-slug');
    expect(byUid(res)['no-slug']['slug']).toBeUndefined();
    for (const group of groupsOf(res)) {
      expect(group).not.toHaveProperty('mailing_list');
      expect(group).not.toHaveProperty('external_sources');
    }
  });
});
