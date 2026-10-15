// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-role-grants.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP: 5,
  ORG_CATALOGUE_SEARCH_MIN_CHARS: 2,
}));

const { proxyRequest, getAccessAwareOrgs, getEffectiveUsername, listClaOnlyOrgs } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getAccessAwareOrgs: vi.fn(),
  getEffectiveUsername: vi.fn(),
  listClaOnlyOrgs: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
// The real predicate is pinned in org-cla-only-orgs.service.spec.ts; the service's own imports reach
// the Angular-bearing shared barrel, so it cannot be loaded here.
vi.mock('./org-cla-only-orgs.service', () => ({
  claOnlyEntryApplies: (isStaff: boolean, grantedOrgCount: number, rosterAnswered: boolean) => rosterAnswered && !isStaff && grantedOrgCount === 0,
  OrgClaOnlyOrgsService: class {
    public listOrgs = listClaOnlyOrgs;
  },
}));

const { OrgNavigationService } = await import('./org-navigation.service');

const req = {} as Request;

/** One catalogue page: `resources` plus the cursor upstream builds before access filtering. */
function cataloguePage(uids: string[], pageToken: string | null) {
  return {
    resources: uids.map((uid) => ({ id: `b2b_org:${uid}`, data: { name: `Org ${uid}`, is_member: true } })),
    page_token: pageToken,
  };
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `mockResolvedValueOnce` survives the latter and would
  // be answered to the next test's first request.
  vi.resetAllMocks();
  getEffectiveUsername.mockReturnValue('staffer');
  // The defining staff shape: the catalogue is the only source of rows.
  getAccessAwareOrgs.mockResolvedValue({
    resolved: new Map(),
    orgDocByUid: new Map(),
    upstreamFailed: false,
    loadedAt: 'now',
    username: 'staffer',
    isStaff: true,
  });
});

describe('OrgNavigationService — catalogue paging', () => {
  it('skips a page whose every row is already assigned, rather than returning a token the client cannot follow', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([['owned', { roleSource: 'direct-writer' }]]),
      orgDocByUid: new Map([['owned', { name: 'Owned Org' }]]),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'staffer',
      isStaff: true,
    });
    // Page one dedupes to nothing; the discovered match is only on page two.
    proxyRequest.mockResolvedValueOnce(cataloguePage(['owned'], 'cursor-2')).mockResolvedValueOnce(cataloguePage(['found'], null));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(response.items.map((item) => item.uid)).toContain('found');
    expect(response.next_page_token).toBeNull();
  });

  it('stops skipping at the cap so a pathological term cannot walk the whole catalogue', async () => {
    proxyRequest.mockResolvedValue(cataloguePage([], 'cursor-next'));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(proxyRequest).toHaveBeenCalledTimes(5);
    expect(response.next_page_token).toBe('cursor-next');
  });

  it('stops at the end of the cursor without exhausting the cap', async () => {
    proxyRequest.mockResolvedValue(cataloguePage([], null));

    await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });
});

describe('OrgNavigationService — catalogue failure', () => {
  it('reports upstream failure instead of presenting an outage as no matches', async () => {
    proxyRequest.mockRejectedValue(new Error('query-service down'));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(response.upstream_failed).toBe(true);
    expect(response.items).toEqual([]);
    expect(response.next_page_token).toBeNull();
  });

  it('keeps a successful search reported as successful', async () => {
    proxyRequest.mockResolvedValue(cataloguePage(['found'], null));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(response.upstream_failed).toBe(false);
  });
});

describe('OrgNavigationService — CLA-only organizations', () => {
  const COMPANY_A = '001A000000AAAAAAAA';
  const COMPANY_B = '001B000000BBBBBBBB';

  function noGrants(overrides: Record<string, unknown> = {}) {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map(),
      orgDocByUid: new Map(),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'contributor',
      isStaff: false,
      ...overrides,
    });
  }

  beforeEach(() => {
    getEffectiveUsername.mockReturnValue('contributor');
  });

  it('lists the companies a caller with no Org Lens grant manages CLAs for', async () => {
    noGrants();
    listClaOnlyOrgs.mockResolvedValue({
      orgs: [
        { uid: COMPANY_B, name: 'Beta Corp' },
        { uid: COMPANY_A, name: 'Acme Corp' },
      ],
      failed: false,
    });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items).toEqual([
      expect.objectContaining({ uid: COMPANY_A, accountId: COMPANY_A, name: 'Acme Corp', slug: null, isAssigned: true, claOnly: true }),
      expect.objectContaining({ uid: COMPANY_B, name: 'Beta Corp', claOnly: true }),
    ]);
    expect(response).toMatchObject({ next_page_token: null, upstream_failed: false, total: 2 });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('never asks for CLA-only organizations when Org Lens resolved any', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([[COMPANY_A, { roleSource: 'direct-writer' }]]),
      orgDocByUid: new Map([[COMPANY_A, { name: 'Acme Corp' }]]),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'contributor',
      isStaff: false,
    });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
    expect(response.items).toEqual([expect.not.objectContaining({ claOnly: true })]);
  });

  it('never asks for CLA-only organizations while the roll-up is degraded, since inherited organizations may be missing', async () => {
    noGrants({ degraded: true });

    await new OrgNavigationService().getOrgItems(req, {});

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
  });

  it('never asks for CLA-only organizations for staff', async () => {
    proxyRequest.mockResolvedValue(cataloguePage([], null));

    await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
  });

  it('reports a failed lookup alongside the rows that did resolve', async () => {
    noGrants();
    listClaOnlyOrgs.mockResolvedValue({ orgs: [{ uid: COMPANY_A, name: 'Acme Corp' }], failed: true });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items.map((item) => item.uid)).toEqual([COMPANY_A]);
    expect(response.upstream_failed).toBe(true);
  });

  it.each([
    ['the roster never loaded', { upstreamFailed: true }],
    ['the staff check failed', { staffCheck: 'failed' }],
  ])('lists no CLA-only organizations when %s', async (_label, overrides) => {
    noGrants(overrides);
    listClaOnlyOrgs.mockResolvedValue({ orgs: [{ uid: COMPANY_A, name: 'Acme Corp' }], failed: false });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
    expect(response.items).toEqual([]);
  });

  it('keeps reporting a roster outage', async () => {
    noGrants({ upstreamFailed: true });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.upstream_failed).toBe(true);
  });

  it('filters by the typed name', async () => {
    noGrants();
    listClaOnlyOrgs.mockResolvedValue({
      orgs: [
        { uid: COMPANY_A, name: 'Acme Corp' },
        { uid: COMPANY_B, name: 'Beta Corp' },
      ],
      failed: false,
    });

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'bet' });

    expect(response.items.map((item) => item.uid)).toEqual([COMPANY_B]);
  });

  it('answers a continuation page with nothing, as the list is complete on page one', async () => {
    noGrants();

    const response = await new OrgNavigationService().getOrgItems(req, { pageToken: 'cursor-2' });

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
    expect(response).toMatchObject({ items: [], next_page_token: null });
  });
});
