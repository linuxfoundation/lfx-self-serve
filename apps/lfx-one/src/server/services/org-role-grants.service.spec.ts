// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  // Batch size and classify concurrency are stubbed tiny (production: 100 / 8) so the wave-sizing
  // test below can cross a wave boundary with a handful of candidates. Only
  // `runClassificationWaves` reads them, and the real `AccessCheckService` is mocked out.
  ACCESS_CHECK_BATCH_SIZE: 2,
  LF_STAFF_TEAM_ID: 'lf-staff',
  ORG_ACCESS_AWARE_CACHE_TTL_MS: 30_000,
  ORG_CANDIDATE_CLASSIFY_CONCURRENCY: 2,
  ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY: 4,
  // Traversal caps are stubbed FAR below production (500 / 2000) so the cap-boundary tests below
  // can reach them with a handful of mocked docs. Every other test in this file uses leaf orgs
  // (`is_parent: false`, no `parent_uid`), so the walk never runs and the values don't matter.
  ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP: 4,
  ORG_CONNECTED_COMPONENT_CANDIDATE_HARD_CAP: 6,
  ORG_ROLE_GRANTS_HARD_CAP: 500,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE: 100,
  VALKEY_CACHE: { APP_PREFIX: 'lfx', ORG_ACCESS_NAMESPACE: 'org-access' },
}));
vi.mock('@lfx-one/shared/utils', () => ({
  isFilterSafeUsername: (value: string) => /^[a-z0-9_-]+$/i.test(value),
  isFilterSafeIdentifier: (value: string) => /^[a-z0-9_-]+$/i.test(value),
}));

const { proxyRequest, checkSingleAccess, checkAccessStrict, getJson, setJson } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  checkSingleAccess: vi.fn(),
  checkAccessStrict: vi.fn(),
  getJson: vi.fn(),
  setJson: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = checkSingleAccess;
    public checkAccessStrict = checkAccessStrict;
  },
}));
vi.mock('./valkey.service', () => ({ valkeyService: { getJson, setJson }, cacheKeyNamespace: () => 'test' }));

const { OrgRoleGrantsService } = await import('./org-role-grants.service');

const req = {} as Request;
const USERNAME = 'staffer';

beforeEach(() => {
  vi.clearAllMocks();
  getJson.mockResolvedValue(null);
  setJson.mockResolvedValue(undefined);
  // Default: caller holds no roster grants — the defining staff shape, and the path that used to
  // short-circuit before the staff answer was reached.
  proxyRequest.mockResolvedValue({ resources: [] });
  checkAccessStrict.mockResolvedValue(new Map());
});

describe('OrgRoleGrantsService — LF staff determination', () => {
  it('reports isStaff for a caller with no roster grants at all', async () => {
    checkSingleAccess.mockResolvedValue(true);

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'lf-staff', access: 'member' });
    expect(response.isStaff).toBe(true);
    expect(response.writers).toEqual([]);
    expect(response.auditors).toEqual([]);
  });

  it('reports isStaff false for a non-staff caller', async () => {
    checkSingleAccess.mockResolvedValue(false);

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    expect(response.isStaff).toBe(false);
  });

  // The guard against a future refactor turning a degraded check into an optimistic one.
  it('fails closed when the access check throws', async () => {
    checkSingleAccess.mockRejectedValue(new Error('access-check unreachable'));

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    expect(response.isStaff).toBe(false);
  });

  it('still resolves isStaff when the roster lookup fails, since the two are independent upstreams', async () => {
    checkSingleAccess.mockResolvedValue(true);
    proxyRequest.mockRejectedValue(new Error('query-service down'));

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    expect(result.upstreamFailed).toBe(true);
    expect(result.isStaff).toBe(true);
  });

  it('does not run the check for a username outside the filter-safe allowlist', async () => {
    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, 'not safe!');

    expect(checkSingleAccess).not.toHaveBeenCalled();
    expect(result.isStaff).toBe(false);
  });
});

describe('OrgRoleGrantsService — direct-grant cap contract', () => {
  // Boundary coverage for the ORG_ROLE_GRANTS_HARD_CAP (500) contract. E2E can only observe
  // the wire response and would still pass if the service regressed to requesting per_page: 500,
  // dropped the operator warning, or forwarded the 501st grant — the assertions below lock each
  // of those failure modes at the service boundary.
  const HARD_CAP = 500;

  function makeSettingsResource(orgUid: string): {
    id: string;
    data: { members: { username: string; role: 'writer'; invite_status: 'accepted' }[] };
  } {
    return {
      id: `b2b_org_settings:${orgUid}`,
      data: { members: [{ username: USERNAME, role: 'writer', invite_status: 'accepted' }] },
    };
  }

  function makeOrgDoc(orgUid: string): { id: string; data: { uid: string; name: string; is_parent: false } } {
    return { id: `b2b_org:${orgUid}`, data: { uid: orgUid, name: `Org ${orgUid}`, is_parent: false } };
  }

  function seedProxy(settingsCount: number): { orgUids: string[] } {
    // Filter-safe uids: matches the isFilterSafeIdentifier stub /^[a-z0-9_-]+$/i.
    const orgUids = Array.from({ length: settingsCount }, (_, i) => `org-${i.toString().padStart(4, '0')}`);
    // Mirror the query-service Goa contract: it only recognizes `page_size` and silently defaults
    // to 50 for missing / unknown paging keys. Bugging the mock this way means a regression to
    // `per_page` (or any other key) fails the boundary tests here rather than shipping to prod.
    const respectPageSize = <T>(resources: T[], params: { page_size?: number } | undefined): { resources: T[] } => {
      const pageSize = typeof params?.page_size === 'number' && params.page_size > 0 ? params.page_size : 50;
      return { resources: resources.slice(0, pageSize) };
    };
    proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, _path: unknown, _method: unknown, params?: Record<string, unknown>) => {
      if (params && (params as { type?: string }).type === 'b2b_org_settings') {
        return respectPageSize(orgUids.map(makeSettingsResource), params as { page_size?: number });
      }
      if (params && (params as { type?: string }).type === 'b2b_org') {
        const tags = ((params as { tags?: string[] }).tags ?? []).map((t) => t.replace(/^b2b_org_uid:/, ''));
        return respectPageSize(tags.map(makeOrgDoc), params as { page_size?: number });
      }
      return { resources: [] };
    });
    return { orgUids };
  }

  it('requests one row above the hard cap so overflow is detectable — via the `page_size` contract key', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxy(HARD_CAP);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const [, , , , settingsParams] = proxyRequest.mock.calls[0];
    // `page_size` is the query-service Goa contract key; a legacy `per_page` is silently
    // ignored upstream and defaults to 50, so asserting both directions here (present under
    // the correct key, absent under the legacy key) blocks a regression to the wrong param.
    expect(settingsParams).toMatchObject({ type: 'b2b_org_settings', page_size: HARD_CAP + 1 });
    expect(settingsParams).not.toHaveProperty('per_page');
  });

  it('does NOT emit the overflow warning at exactly the cap', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxy(HARD_CAP);
    const { logger: mockedLogger } = await import('./logger.service');

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const overflowCalls = (mockedLogger.warning as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[3] as { event?: string })?.event === 'org_grant_cap_exceeded'
    );
    expect(overflowCalls).toHaveLength(0);
    expect(result.resolved.size).toBe(HARD_CAP);
  });

  it('emits ONE overflow warning and truncates to the cap before partitioning when the caller has more direct grants than supported', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxy(HARD_CAP + 1);
    const { logger: mockedLogger } = await import('./logger.service');

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const overflowCalls = (mockedLogger.warning as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[3] as { event?: string })?.event === 'org_grant_cap_exceeded'
    );
    expect(overflowCalls).toHaveLength(1);
    expect(overflowCalls[0][3]).toMatchObject({
      event: 'org_grant_cap_exceeded',
      raw_grant_count: HARD_CAP + 1,
      hard_cap: HARD_CAP,
    });
    // The wire response, cache, and resolved map must never exceed the supported ceiling.
    expect(result.resolved.size).toBe(HARD_CAP);
    // The b2b_org details fetches are chunked (URL-length guard) — collect all tags across the
    // chunked calls and prove the union is bounded by HARD_CAP, i.e. the truncation happened
    // BEFORE partitioning fed downstream fetches.
    const detailsCalls = proxyRequest.mock.calls.filter((c) => (c[4] as { type?: string })?.type === 'b2b_org');
    expect(detailsCalls.length).toBeGreaterThan(0);
    const allDetailsTags = detailsCalls.flatMap((c) => ((c[4] as { tags?: string[] }).tags ?? []) as string[]);
    expect(allDetailsTags.length).toBeLessThanOrEqual(HARD_CAP);
  });
});

describe('OrgRoleGrantsService — fetchOrgDetailsByUids URL-length chunking', () => {
  // The b2b_org details fetch used to serialize all uids into one GET's `tags=` params — at the
  // ORG_ROLE_GRANTS_HARD_CAP ceiling (500) that produced ~19 KB URLs, exceeding the repo's
  // documented `QUERY_SERVICE_FILTERS_OR_BATCH_SIZE = 100` guard. The service now chunks at 100
  // and fans out with Promise.allSettled; the tests below lock the boundary + failure semantics.
  const HARD_CAP = 500;
  const CHUNK_SIZE = 100;

  function makeSettingsResource(orgUid: string): {
    id: string;
    data: { members: { username: string; role: 'writer'; invite_status: 'accepted' }[] };
  } {
    return {
      id: `b2b_org_settings:${orgUid}`,
      data: { members: [{ username: USERNAME, role: 'writer', invite_status: 'accepted' }] },
    };
  }

  function makeOrgDoc(orgUid: string): { id: string; data: { uid: string; name: string; is_parent: false } } {
    return { id: `b2b_org:${orgUid}`, data: { uid: orgUid, name: `Org ${orgUid}`, is_parent: false } };
  }

  function seedProxyForChunking(uidCount: number): { orgUids: string[] } {
    const orgUids = Array.from({ length: uidCount }, (_, i) => `org-${i.toString().padStart(4, '0')}`);
    proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, _path: unknown, _method: unknown, params?: Record<string, unknown>) => {
      const type = params ? (params as { type?: string }).type : undefined;
      if (type === 'b2b_org_settings') {
        return { resources: orgUids.map(makeSettingsResource) };
      }
      if (type === 'b2b_org') {
        // Echo back exactly the uids this chunk asked for, mirroring what the query-service does
        // when every requested uid resolves — this is what lets us assert the union of chunked
        // responses equals the input set.
        const tags = ((params as { tags?: string[] }).tags ?? []).map((t) => t.replace(/^b2b_org_uid:/, ''));
        return { resources: tags.map(makeOrgDoc) };
      }
      return { resources: [] };
    });
    return { orgUids };
  }

  it('serializes into a single request when the caller sits at or below the chunk boundary', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxyForChunking(CHUNK_SIZE);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const detailsCalls = proxyRequest.mock.calls.filter((c) => (c[4] as { type?: string })?.type === 'b2b_org');
    expect(detailsCalls).toHaveLength(1);
    expect(((detailsCalls[0][4] as { tags?: string[] }).tags ?? []).length).toBe(CHUNK_SIZE);
  });

  it('splits into two requests when the caller crosses the chunk boundary by one', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxyForChunking(CHUNK_SIZE + 1);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const detailsCalls = proxyRequest.mock.calls.filter((c) => (c[4] as { type?: string })?.type === 'b2b_org');
    expect(detailsCalls).toHaveLength(2);
    const tagCounts = detailsCalls.map((c) => ((c[4] as { tags?: string[] }).tags ?? []).length);
    expect(Math.max(...tagCounts)).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(tagCounts.reduce((a, b) => a + b, 0)).toBe(CHUNK_SIZE + 1);
  });

  it('splits into HARD_CAP / CHUNK_SIZE requests at the ceiling, each bounded by CHUNK_SIZE', async () => {
    checkSingleAccess.mockResolvedValue(false);
    seedProxyForChunking(HARD_CAP);

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const detailsCalls = proxyRequest.mock.calls.filter((c) => (c[4] as { type?: string })?.type === 'b2b_org');
    expect(detailsCalls).toHaveLength(HARD_CAP / CHUNK_SIZE);
    for (const call of detailsCalls) {
      const tags = ((call[4] as { tags?: string[] }).tags ?? []) as string[];
      expect(tags.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    expect(result.resolved.size).toBe(HARD_CAP);
  });

  it('degrades to a partial result when one chunk fails — the other chunks still land', async () => {
    checkSingleAccess.mockResolvedValue(false);
    const orgUids = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => `org-${i.toString().padStart(4, '0')}`);
    // First b2b_org chunk resolves; second chunk rejects — mirrors a single-chunk upstream blip.
    let detailsCallCount = 0;
    proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, _path: unknown, _method: unknown, params?: Record<string, unknown>) => {
      const type = params ? (params as { type?: string }).type : undefined;
      if (type === 'b2b_org_settings') {
        return { resources: orgUids.map(makeSettingsResource) };
      }
      if (type === 'b2b_org') {
        detailsCallCount += 1;
        if (detailsCallCount === 2) {
          throw new Error('one chunk failed');
        }
        const tags = ((params as { tags?: string[] }).tags ?? []).map((t) => t.replace(/^b2b_org_uid:/, ''));
        return { resources: tags.map(makeOrgDoc) };
      }
      return { resources: [] };
    });

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    // Partial degradation, not fail-closed: 100 uids landed from the first chunk, 1 uid was
    // lost with the second chunk. `upstreamFailed` is NOT set, because we still returned rows.
    expect(result.upstreamFailed).toBe(false);
    expect(result.orgDocByUid.size).toBe(CHUNK_SIZE);
  });

  it('fails closed when EVERY details chunk rejects — refuses to cache an empty grant list as success', async () => {
    checkSingleAccess.mockResolvedValue(false);
    const orgUids = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => `org-${i.toString().padStart(4, '0')}`);
    proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, _path: unknown, _method: unknown, params?: Record<string, unknown>) => {
      const type = params ? (params as { type?: string }).type : undefined;
      if (type === 'b2b_org_settings') {
        return { resources: orgUids.map(makeSettingsResource) };
      }
      if (type === 'b2b_org') {
        throw new Error('every chunk down');
      }
      return { resources: [] };
    });

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    // Total upstream failure MUST NOT cache an empty result as successful — a caller with 101
    // grants would silently see "no orgs" for the entire TTL window. The service must set
    // `upstreamFailed: true` so the caller's cache skips the poison entry and the switcher
    // renders the "search unavailable" state on the next attempt.
    expect(result.upstreamFailed).toBe(true);
    expect(setJson).not.toHaveBeenCalled();
  });
});

describe('OrgRoleGrantsService — connected-component walk, classification & degraded contract', () => {
  // The walk caps are stubbed at 4 (per root) / 6 (global) at the top of this file so the
  // cap-boundary cases below are reachable with a handful of docs.
  const PER_ROOT_CAP = 4;

  interface Doc {
    name: string;
    is_parent?: boolean;
    parent_uid?: string;
  }

  /**
   * Drives `proxyRequest` from a declarative hierarchy, distinguishing the three query shapes the
   * service actually issues: the settings roster, the `b2b_org_uid:` detail fetch, and the
   * `parent_b2b_org_uid:` child fetch. `missingDocs` omits a uid from the detail fetch without
   * failing the request (an unindexed org); `failChildrenFor` rejects one parent's child page.
   */
  function seedHierarchy(options: {
    grants: { uid: string; role: 'writer' | 'auditor' }[];
    docs: Record<string, Doc>;
    children?: Record<string, string[]>;
    missingDocs?: string[];
    failChildrenFor?: string;
  }): void {
    const { grants, docs, children = {}, missingDocs = [], failChildrenFor } = options;

    proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, _path: unknown, _method: unknown, params?: Record<string, unknown>) => {
      const type = (params as { type?: string } | undefined)?.type;
      const tags = ((params as { tags?: string[] } | undefined)?.tags ?? []) as string[];

      if (type === 'b2b_org_settings') {
        return {
          resources: grants.map(({ uid, role }) => ({
            id: `b2b_org_settings:${uid}`,
            data: { members: [{ username: USERNAME, role, invite_status: 'accepted' }] },
          })),
        };
      }
      if (type !== 'b2b_org') {
        return { resources: [] };
      }

      const parentTag = tags.find((tag) => tag.startsWith('parent_b2b_org_uid:'));
      if (parentTag) {
        const parentUid = parentTag.slice('parent_b2b_org_uid:'.length);
        if (parentUid === failChildrenFor) {
          throw new Error(`children fetch failed for ${parentUid}`);
        }
        return { resources: (children[parentUid] ?? []).map((uid) => ({ id: `b2b_org:${uid}`, data: { uid, ...docs[uid] } })) };
      }

      const requested = tags.map((tag) => tag.slice('b2b_org_uid:'.length));
      return {
        resources: requested.filter((uid) => docs[uid] && !missingDocs.includes(uid)).map((uid) => ({ id: `b2b_org:${uid}`, data: { uid, ...docs[uid] } })),
      };
    });
  }

  /** The authorizer grants `writer` on everything it is asked about — i.e. a deployed FGA model in which `writer` cascades across the hierarchy. */
  function classifyEveryCandidateAsWriter(): void {
    checkAccessStrict.mockImplementation(
      async (_req: unknown, requests: { id: string; access: string }[]) => new Map(requests.map((r) => [`${r.id}#${r.access}`, r.access === 'writer']))
    );
  }

  /** A root, its `is_parent` flag, and `childCount` leaf children — the shape the cap boundary is expressed in. */
  function seedParentWithChildren(childCount: number): void {
    const childUids = Array.from({ length: childCount }, (_, i) => `child-${i}`);
    const docs: Record<string, Doc> = { root: { name: 'Root Co', is_parent: true } };
    for (const uid of childUids) {
      docs[uid] = { name: `Child ${uid}`, parent_uid: 'root' };
    }
    seedHierarchy({ grants: [{ uid: 'root', role: 'writer' }], docs, children: { root: childUids } });
  }

  beforeEach(() => {
    checkSingleAccess.mockResolvedValue(false);
  });

  it('routes provenance through a parent that another root already discovered', async () => {
    classifyEveryCandidateAsWriter();
    seedHierarchy({
      // Roster order sets the walk order: `zeta` runs first, `alpha` second.
      grants: [
        { uid: 'zeta', role: 'writer' },
        { uid: 'alpha', role: 'writer' },
      ],
      docs: {
        zeta: { name: 'Zeta Holdings', parent_uid: 'parentco' },
        alpha: { name: 'Alpha Holdings', parent_uid: 'parentco' },
        parentco: { name: 'Parent Co', is_parent: true },
        cousin: { name: 'Cousin Co', parent_uid: 'parentco' },
      },
      children: { parentco: ['zeta', 'alpha', 'cousin'] },
    });

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    // `parentco` is already in the shared doc map by the time alpha's walk asks for it. Enqueueing
    // only newly-FETCHED parents left alpha's walk dead on arrival, so the whole component kept
    // zeta's provenance and the nearest-root tie-break (alpha sorts first) could never win.
    expect(response.cascadingWriters.find((entry) => entry.uid === 'cousin')?.parentName).toBe('Alpha Holdings');
    expect(response.degraded).toBe(false);
  });

  it('lets an inherited writer outrank a direct auditor on the same organization', async () => {
    classifyEveryCandidateAsWriter();
    seedHierarchy({
      grants: [
        { uid: 'top', role: 'writer' },
        { uid: 'sub', role: 'auditor' },
      ],
      docs: { top: { name: 'Top Co', is_parent: true }, sub: { name: 'Sub Co', parent_uid: 'top' } },
      children: { top: ['sub'] },
    });

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    // Excluding every directly-granted uid from the candidate set made this precedence
    // unreachable: `sub` was never classified, so it stayed a direct auditor and the caller kept
    // read-only access to a subsidiary their parent-org grant lets them edit.
    expect(response.cascadingWriters.map((entry) => entry.uid)).toContain('sub');
    expect(response.auditors).not.toContain('sub');
    expect(OrgRoleGrantsService.hasEditorAccess(response, 'sub')).toBe(true);
  });

  it('keeps verified direct grants when authoritative classification fails, and reports degraded', async () => {
    checkAccessStrict.mockRejectedValue(new Error('authorizer unreachable'));
    seedHierarchy({
      grants: [{ uid: 'top', role: 'writer' }],
      docs: { top: { name: 'Top Co', is_parent: true }, sub: { name: 'Sub Co', parent_uid: 'top' } },
      children: { top: ['sub'] },
    });

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    expect(response.writers).toEqual(['top']);
    expect(response.cascadingWriters).toEqual([]);
    expect(response.degraded).toBe(true);
  });

  it('keeps verified direct grants when the walk itself fails, rather than emptying the whole answer', async () => {
    classifyEveryCandidateAsWriter();
    seedHierarchy({
      grants: [
        { uid: 'top', role: 'writer' },
        { uid: 'sub', role: 'auditor' },
      ],
      docs: { top: { name: 'Top Co', is_parent: true }, sub: { name: 'Sub Co', parent_uid: 'top' } },
      children: { top: ['sub'] },
      failChildrenFor: 'top',
    });

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    // One failed child page used to reject out of the walk and return an EMPTY grant map with
    // `upstreamFailed`, revoking grants the roster had already confirmed. Roll-up expansion is
    // additive, so its failure degrades the answer instead of discarding it.
    expect(result.upstreamFailed).toBe(false);
    expect(result.resolved.get('top')?.roleSource).toBe('direct-writer');
    expect(result.resolved.get('sub')?.roleSource).toBe('direct-auditor');
    expect(result.degraded).toBe(true);
  });

  it('reports degraded when a direct grant has no indexed organization document to walk from', async () => {
    classifyEveryCandidateAsWriter();
    seedHierarchy({
      grants: [
        { uid: 'top', role: 'writer' },
        { uid: 'orphan', role: 'writer' },
      ],
      docs: { top: { name: 'Top Co' }, orphan: { name: 'Orphan Co', parent_uid: 'hidden' } },
      missingDocs: ['orphan'],
    });

    const response = await new OrgRoleGrantsService().getRoleGrants(req, USERNAME);

    // Without the doc, `orphan`'s component is never walked — the answer is a lower bound even
    // though every chunk of the details fetch "succeeded".
    expect(response.writers).toEqual(expect.arrayContaining(['top', 'orphan']));
    expect(response.degraded).toBe(true);
  });

  it('does not report truncation when the cap coincides with the last node of a complete component', async () => {
    seedParentWithChildren(PER_ROOT_CAP);

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    // Truncation was flagged whenever the cap was hit with a non-empty frontier, even when that
    // frontier held nothing but fully-explored leaves. `degraded` now drives 503s, so a complete
    // answer must not raise it.
    expect(result.degraded).toBe(false);
  });

  it('reports truncation when the cap actually leaves part of the component unexplored', async () => {
    seedParentWithChildren(PER_ROOT_CAP + 1);

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    expect(result.degraded).toBe(true);
  });

  it('splits the authorizer fan-out into bounded waves instead of one unbounded dispatch', async () => {
    classifyEveryCandidateAsWriter();
    seedParentWithChildren(PER_ROOT_CAP);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    // `checkAccessStrict` chunks internally but dispatches every chunk at once, so handing it the
    // whole component in one call opens one upstream connection per chunk — thousands of them for
    // a large hierarchy. Each call here must stay within one wave (batch size × concurrency = 4).
    const waveSizes = checkAccessStrict.mock.calls.map((call) => (call[1] as { id: string }[]).length);
    expect(waveSizes.length).toBeGreaterThan(1);
    expect(Math.max(...waveSizes)).toBeLessThanOrEqual(4);
    // Every candidate is still probed for both relations, across the waves combined.
    expect(waveSizes.reduce((a, b) => a + b, 0)).toBe(PER_ROOT_CAP * 2);
  });
});

describe('OrgRoleGrantsService — isStaff cache round trip', () => {
  it('writes isStaff into the cached entry', async () => {
    checkSingleAccess.mockResolvedValue(true);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    expect(setJson).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ isStaff: true }), expect.any(Number));
  });

  it('serves isStaff from a cache hit without re-checking', async () => {
    getJson.mockResolvedValue({ resolved: [], orgDocByUid: [], upstreamFailed: false, loadedAt: 'now', username: USERNAME, isStaff: true });

    const result = await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    expect(result.isStaff).toBe(true);
    expect(checkSingleAccess).not.toHaveBeenCalled();
  });

  // The guard is private, so exercise it where it is actually injected: the getJson call site.
  it('rejects a pre-change entry that has no isStaff, so it recomputes instead of answering undefined', async () => {
    checkSingleAccess.mockResolvedValue(true);

    await new OrgRoleGrantsService().getAccessAwareOrgs(req, USERNAME);

    const guard = getJson.mock.calls[0][1] as (value: unknown) => boolean;
    const legacyEntry = { resolved: [], orgDocByUid: [], upstreamFailed: false, loadedAt: 'now', username: USERNAME };

    expect(guard(legacyEntry)).toBe(false);
    expect(guard({ ...legacyEntry, isStaff: false })).toBe(true);
  });
});
