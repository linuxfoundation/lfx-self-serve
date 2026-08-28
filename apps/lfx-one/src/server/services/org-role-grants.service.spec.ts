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
    // The second proxyRequest (b2b_org details fetch) must be called with at most HARD_CAP uids —
    // proving the truncation happened BEFORE partitioning fed downstream fetches.
    const detailsCall = proxyRequest.mock.calls.find((c) => (c[4] as { type?: string })?.type === 'b2b_org');
    expect(detailsCall).toBeDefined();
    const detailsTags = (detailsCall![4] as { tags?: string[] }).tags ?? [];
    expect(detailsTags.length).toBeLessThanOrEqual(HARD_CAP);
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
