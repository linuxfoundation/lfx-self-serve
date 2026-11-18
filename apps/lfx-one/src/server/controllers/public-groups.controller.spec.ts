// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '@lfx-one/shared/enums';
import type { Committee, Project } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Per-test-controllable service mocks. The controller constructs `new ProjectService()` and
// `new CommitteeService()` as fields, so the mocked constructors must hand back these same
// objects every time (same pattern as public-profile.controller.spec.ts).
const {
  getFoundationProjectUidsMock,
  getProjectsByIdsMock,
  getPubliclyDiscoverableProjectMock,
  getProjectIdBySlugMock,
  getCommitteesMock,
  resolveCommitteeUidMock,
  getCommitteeByIdMock,
  getCommitteeMembersMock,
  getMeetingsMock,
  proxyRequestMock,
} = vi.hoisted(() => ({
  getFoundationProjectUidsMock: vi.fn(),
  getProjectsByIdsMock: vi.fn(),
  getPubliclyDiscoverableProjectMock: vi.fn(),
  getProjectIdBySlugMock: vi.fn(),
  getCommitteesMock: vi.fn(),
  resolveCommitteeUidMock: vi.fn(),
  getCommitteeByIdMock: vi.fn(),
  getCommitteeMembersMock: vi.fn(),
  getMeetingsMock: vi.fn(),
  proxyRequestMock: vi.fn(),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return {
      getFoundationProjectUids: getFoundationProjectUidsMock,
      getProjectsByIds: getProjectsByIdsMock,
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

function committee(uid: string, projectUid: string, overrides: Partial<Committee> = {}): Committee {
  return { uid, name: `Committee ${uid}`, public: true, project_uid: projectUid, ...overrides } as Committee;
}

function queryPage<T>(items: T[], pageToken?: string): { resources: { type: string; id: string; data: T }[]; page_token?: string } {
  return {
    resources: items.map((data, index) => ({ type: 'committee', id: String(index), data })),
    ...(pageToken ? { page_token: pageToken } : {}),
  };
}

describe('PublicGroupsController.getPublicGroupsByFoundation — fan-out cap and batching', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getProjectsByIdsMock.mockImplementation(
      async (_req: Request, uids: Iterable<string>) => new Map(Array.from(uids, (uid) => [uid, discoverable(uid) as unknown as Project]))
    );
    proxyRequestMock.mockResolvedValue(queryPage([]));
  });

  it('does not truncate and omits `truncated` from the response when childUids is under the cap', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.truncated).toBeUndefined();
    // Single batched disjunction query covering every discovered UID, with no per-UID getCommittees calls.
    expect(getCommitteesMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][4]).toEqual({
      type: 'committee',
      filters_or: ['project_uid:project-1', 'project_uid:project-2'],
      page_size: 1000,
    });
    expect(getProjectsByIdsMock).not.toHaveBeenCalled();
  });

  it('truncates, sets `truncated: true`, batches at 100 UIDs, and pins the foundationUid so it always survives the cap', async () => {
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

    // 150 capped UIDs partition into two filters_or batches (100 + 50), with foundationUid pinned first.
    expect(getCommitteesMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    const batchSizes = proxyRequestMock.mock.calls.map((call) => (call[4].filters_or as string[]).length);
    expect(batchSizes).toEqual([100, 50]);
    const queriedUids = proxyRequestMock.mock.calls.flatMap((call) => (call[4].filters_or as string[]).map((clause) => clause.replace('project_uid:', '')));
    expect(queriedUids[0]).toBe(foundationUid);
    expect(queriedUids).toContain(foundationUid);
    expect(new Set(queriedUids).size).toBe(150);
  });

  it('resolves committees and context projects for a 150-project umbrella foundation via batched calls under the latency budget', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    const projectUids = [foundationUid, ...Array.from({ length: 149 }, (_, i) => `child-project-${i}`)];
    getFoundationProjectUidsMock.mockResolvedValue(projectUids);

    // Simulate 50ms upstream round-trip latency per HTTP request: sequential waves of 10 across 150
    // projects + 150 context lookups previously cost 30 waves (~1,500ms+ at 50ms, 3–10s in prod);
    // parallel 100-UID disjunction batches complete in 2 waves (~100ms).
    proxyRequestMock.mockImplementation(async (_req: Request, _svc: string, _path: string, _method: string, params: { filters_or: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return queryPage(
        params.filters_or.map((clause) => {
          const uid = clause.replace('project_uid:', '');
          return committee(`committee-${uid}`, uid);
        })
      );
    });
    getProjectsByIdsMock.mockImplementation(async (_req: Request, uids: Iterable<string>) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Map(Array.from(uids, (uid) => [uid, discoverable(uid) as unknown as Project]));
    });

    const { req, res, next } = buildReqRes(foundationUid);
    const startedAt = performance.now();
    await controller.getPublicGroupsByFoundation(req, res, next);
    const elapsedMs = performance.now() - startedAt;

    expect(next).not.toHaveBeenCalled();
    // 2 batched committee queries (100 + 50) + 1 bulk getProjectsByIds call (which issues 2 batched
    // project queries of 100 + 50, verified in project.service.spec.ts) = 4 upstream query-service calls.
    expect(getCommitteesMock).not.toHaveBeenCalled();
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    expect(getProjectsByIdsMock).toHaveBeenCalledTimes(1);
    expect((getProjectsByIdsMock.mock.calls[0][1] as string[]).length).toBe(150);
    expect(elapsedMs).toBeLessThan(1500);

    const response = res.json.mock.calls[0][0];
    expect(response.total).toBe(150);
    expect(response.groups).toHaveLength(150);
    expect(response.truncated).toBeUndefined();
  });

  it('deduplicates public committees across pages and batches, excludes non-public ones, and sorts alphabetically', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    proxyRequestMock
      .mockResolvedValueOnce(
        queryPage(
          [
            committee('z-group', 'project-1', { name: 'Zeta Working Group' }),
            committee('shared-committee', 'project-1', { name: 'Alpha Oversight' }),
            committee('private-committee', 'project-1', { public: false }),
            committee('unset-public-committee', 'project-1', { public: undefined as unknown as boolean }),
          ],
          'page-2'
        )
      )
      .mockResolvedValueOnce(
        queryPage([committee('shared-committee', 'project-2', { name: 'Alpha Oversight' }), committee('b-group', 'project-2', { name: 'Beta TSC' })])
      );
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    expect(proxyRequestMock.mock.calls[1][4]).toMatchObject({ page_token: 'page-2' });
    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { name: string }) => g.name)).toEqual(['Alpha Oversight', 'Beta TSC', 'Zeta Working Group']);
    expect(response.total).toBe(3);
  });

  it('returns an empty directory without querying committees or context projects when childUids is empty', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue([]);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(proxyRequestMock).not.toHaveBeenCalled();
    expect(getProjectsByIdsMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ groups: [], total: 0 });
  });

  it('propagates a batched committee query failure to next() rather than returning an incomplete directory', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    const childUids = [foundationUid, ...Array.from({ length: 105 }, (_, i) => `project-${i}`)];
    getFoundationProjectUidsMock.mockResolvedValue(childUids);
    const boom = new MicroserviceError('query service unavailable', 503, 'SERVICE_UNAVAILABLE');
    proxyRequestMock.mockResolvedValueOnce(queryPage([committee('c-1', foundationUid)])).mockRejectedValue(boom);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('PublicGroupsController.getPublicGroupsByFoundation — discoverability (lfx-self-serve-ops#437)', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getPubliclyDiscoverableProjectMock.mockImplementation(async (_req: Request, uid: string) => discoverable(uid));
    getFoundationProjectUidsMock.mockResolvedValue([FOUNDATION_UID, 'child-visible', 'child-hidden']);
    proxyRequestMock.mockImplementation(async (_req: Request, _svc: string, _path: string, _method: string, params: { filters_or: string[] }) =>
      queryPage(
        params.filters_or.map((clause) => {
          const uid = clause.replace('project_uid:', '');
          return committee(`committee-of-${uid}`, uid);
        })
      )
    );
    getProjectsByIdsMock.mockImplementation(
      async (_req: Request, uids: Iterable<string>) => new Map(Array.from(uids, (uid) => [uid, discoverable(uid) as unknown as Project]))
    );
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
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('returns a 404 not-found error for a hidden foundation UID', async () => {
    getPubliclyDiscoverableProjectMock.mockResolvedValueOnce(null);
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it("excludes hidden and confidential-formation child projects' committees and counts only what remains", async () => {
    getFoundationProjectUidsMock.mockResolvedValue([FOUNDATION_UID, 'child-visible', 'child-hidden', 'child-confidential', 'child-omitted']);
    getProjectsByIdsMock.mockResolvedValue(
      new Map([
        [FOUNDATION_UID, discoverable(FOUNDATION_UID) as unknown as Project],
        ['child-visible', discoverable('child-visible') as unknown as Project],
        ['child-hidden', discoverable('child-hidden', { public: false }) as unknown as Project],
        ['child-confidential', discoverable('child-confidential', { stage: ProjectStage.FormationConfidential }) as unknown as Project],
      ])
    );
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid).sort()).toEqual([`committee-of-${FOUNDATION_UID}`, 'committee-of-child-visible'].sort());
    expect(response.total).toBe(2);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('child-hidden');
    expect(serialized).not.toContain('child-confidential');
    expect(serialized).not.toContain('child-omitted');
  });

  it("drops child projects' committees while keeping the foundation's own when batched context lookup fails transiently", async () => {
    getProjectsByIdsMock.mockRejectedValueOnce(new Error('upstream 503'));
    const { req, res, next } = buildReqRes(FOUNDATION_UID);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups.map((g: { uid: string }) => g.uid)).toEqual([`committee-of-${FOUNDATION_UID}`]);
    expect(response.total).toBe(1);
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

  it("keeps the foundation's own committees even when its context lookup omits the foundation UID", async () => {
    getProjectsByIdsMock.mockResolvedValueOnce(new Map([['child-visible', discoverable('child-visible') as unknown as Project]]));
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
    expect(getPubliclyDiscoverableProjectMock).toHaveBeenCalledWith(req, PARENT_UID);
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
    expect(getPubliclyDiscoverableProjectMock).toHaveBeenCalledWith(req, PARENT_UID);
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
