// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  LF_STAFF_TEAM_NAME: 'lf-staff',
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
