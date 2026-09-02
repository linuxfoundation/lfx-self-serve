// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  LF_STAFF_TEAM_ID: 'lf-staff',
  ORG_ACCESS_AWARE_CACHE_TTL_MS: 30_000,
  ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY: 4,
  ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP: 500,
  ORG_ROLE_GRANTS_HARD_CAP: 500,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE: 100,
  VALKEY_CACHE: { APP_PREFIX: 'lfx', ORG_ACCESS_NAMESPACE: 'org-access' },
}));
vi.mock('@lfx-one/shared/utils', () => ({
  isFilterSafeUsername: (value: string) => /^[a-z0-9_-]+$/i.test(value),
  isFilterSafeIdentifier: (value: string) => /^[a-z0-9_-]+$/i.test(value),
}));

const { proxyRequest, checkSingleAccess, getJson, setJson } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  checkSingleAccess: vi.fn(),
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
