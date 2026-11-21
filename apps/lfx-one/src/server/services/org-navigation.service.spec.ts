// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveEmployeeView } = vi.hoisted(() => ({ resolveEmployeeView: vi.fn() }));
vi.mock('./org-employee-view.service', () => ({
  OrgEmployeeViewService: class {
    public resolveReduced = resolveEmployeeView;
    public getRoleGrantEmployeeView = vi.fn().mockResolvedValue({});
  },
}));

// Mirrors org-role-grants.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP: 5,
  ORG_CATALOGUE_SEARCH_MIN_CHARS: 2,
  ORG_LENS_ROLLUP_ENABLED_FLAG: 'org-lens-rollup-enabled',
}));

const { proxyRequest, getAccessAwareOrgs, resolveFamilyRoots, isFlagEnabled, getEffectiveUsername, listClaOnlyOrgs } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getAccessAwareOrgs: vi.fn(),
  resolveFamilyRoots: vi.fn(),
  isFlagEnabled: vi.fn(),
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
    public resolveFamilyRoots = resolveFamilyRoots;
  },
}));
vi.mock('./launchdarkly-server.service', () => ({ LaunchDarklyServerService: { getInstance: () => ({ isFlagEnabled }) } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
// The real predicate is pinned in org-cla-only-orgs.service.spec.ts; the service's own imports reach
// the Angular-bearing shared barrel, so it cannot be loaded here.
vi.mock('./org-cla-only-orgs.service', () => ({
  claOnlyEntryApplies: (isStaff: boolean, grantedOrgCount: number, rosterAnswered: boolean) => rosterAnswered && !isStaff && grantedOrgCount === 0,
  claOnlyListApplies: (isStaff: boolean, rosterAnswered: boolean) => rosterAnswered && !isStaff,
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
  delete process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'];
  resolveEmployeeView.mockResolvedValue({ eligible: false, reason: 'no-verified-company-email' });
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
  isFlagEnabled.mockResolvedValue(false);
  resolveFamilyRoots.mockResolvedValue(new Map());
});

describe('OrgNavigationService — family roll-up labels on a staff search (#5942)', () => {
  const ROOT = { rootUid: 'top', rootName: 'Top Co', rootLogoUrl: null };

  beforeEach(() => {
    isFlagEnabled.mockResolvedValue(true);
  });

  it('labels a family company with its top account and leaves a standalone company unlabelled', async () => {
    proxyRequest.mockResolvedValue(cataloguePage(['child', 'solo'], null));
    resolveFamilyRoots.mockResolvedValue(new Map([['child', ROOT]]));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(isFlagEnabled).toHaveBeenCalledWith(req, 'org-lens-rollup-enabled', false);
    expect(response.items.find((item) => item.uid === 'child')).toMatchObject({ familyRootUid: 'top', familyRootName: 'Top Co' });
    expect(response.items.find((item) => item.uid === 'solo')).not.toHaveProperty('familyRootUid');
  });

  it('hands the climb the indexed record of every row shown, assigned rows included', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([['owned', { roleSource: 'direct-writer' }]]),
      orgDocByUid: new Map([['owned', { name: 'Owned Org', parent_uid: 'top' }]]),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'staffer',
      isStaff: true,
    });
    proxyRequest.mockResolvedValue(cataloguePage(['found'], null));

    await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    const docs = resolveFamilyRoots.mock.calls[0][1] as Map<string, unknown>;
    expect([...docs.keys()].sort()).toEqual(['found', 'owned']);
    expect(docs.get('owned')).toMatchObject({ parent_uid: 'top' });
  });

  it('labels nothing and skips the climb while the roll-up flag is off for the caller', async () => {
    isFlagEnabled.mockResolvedValue(false);
    proxyRequest.mockResolvedValue(cataloguePage(['child'], null));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(resolveFamilyRoots).not.toHaveBeenCalled();
    expect(response.items[0]).not.toHaveProperty('familyRootUid');
  });

  it('still answers the search, unlabelled, when the climb fails', async () => {
    proxyRequest.mockResolvedValue(cataloguePage(['child'], null));
    resolveFamilyRoots.mockRejectedValue(new Error('query-service down'));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(response.upstream_failed).toBe(false);
    expect(response.items.map((item) => item.uid)).toEqual(['child']);
    expect(response.items[0]).not.toHaveProperty('familyRootUid');
  });

  it('labels nothing for a caller who is not staff, who has no catalogue search', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([['owned', { roleSource: 'direct-writer' }]]),
      orgDocByUid: new Map([['owned', { name: 'Owned Org', parent_uid: 'top' }]]),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'member',
      isStaff: false,
      staffCheck: 'ok',
    });

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'own' });

    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(resolveFamilyRoots).not.toHaveBeenCalled();
    expect(response.items[0]).not.toHaveProperty('familyRootUid');
  });

  it('does not evaluate the flag for an unsearched list', async () => {
    await new OrgNavigationService().getOrgItems(req, {});

    expect(isFlagEnabled).not.toHaveBeenCalled();
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
    expect(response.cla_only_deferred).toBeUndefined();
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('answers cla_only with nothing for a caller with no Org Lens grant, whose CLA-only rows are already on the main list', async () => {
    noGrants();
    listClaOnlyOrgs.mockResolvedValue({ orgs: [{ uid: COMPANY_A, name: 'Acme Corp' }], failed: false });

    const response = await new OrgNavigationService().getOrgItems(req, { claOnly: true });

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
    expect(response).toEqual({ items: [], next_page_token: null, upstream_failed: false, total: 0 });
  });

  describe('for a caller who also holds organizations', () => {
    const HELD_Z = '001Z000000ZZZZZZZZ';
    const HELD_INHERITED = '001I000000IIIIIIII';
    const COMPANY_C = '001C000000CCCCCCCC';

    function holds(overrides: Record<string, unknown> = {}) {
      getAccessAwareOrgs.mockResolvedValue({
        resolved: new Map([
          [HELD_Z, { roleSource: 'direct-writer' }],
          [HELD_INHERITED, { roleSource: 'inherited-auditor', parentName: 'Zeta Corp' }],
        ]),
        orgDocByUid: new Map([
          [HELD_Z, { name: 'Zeta Corp' }],
          [HELD_INHERITED, { name: 'Zeta Labs' }],
        ]),
        upstreamFailed: false,
        loadedAt: 'now',
        username: 'contributor',
        isStaff: false,
        ...overrides,
      });
    }

    it('answers the held organizations without waiting on the CLA-only lookup, and says the CLA-only rows are deferred', async () => {
      holds();
      listClaOnlyOrgs.mockReturnValue(new Promise(() => undefined));

      const response = await new OrgNavigationService().getOrgItems(req, {});

      expect(listClaOnlyOrgs).not.toHaveBeenCalled();
      expect(response.items.map((item) => item.uid)).toEqual([HELD_Z, HELD_INHERITED]);
      expect(response).toMatchObject({ next_page_token: null, upstream_failed: false, total: 2, cla_only_deferred: true });
    });

    it('defers the CLA-only rows on a search page too, filtering only the held half', async () => {
      holds();

      const response = await new OrgNavigationService().getOrgItems(req, { name: 'lab' });

      expect(response.items.map((item) => item.uid)).toEqual([HELD_INHERITED]);
      expect(response.cla_only_deferred).toBe(true);
    });

    describe('with cla_only', () => {
      it('answers only the CLA-only companies, alphabetical and unfiltered by the name', async () => {
        holds();
        listClaOnlyOrgs.mockResolvedValue({
          orgs: [
            { uid: COMPANY_B, name: 'Beta Corp' },
            { uid: COMPANY_A, name: 'Acme Corp' },
          ],
          failed: false,
        });

        const response = await new OrgNavigationService().getOrgItems(req, { claOnly: true, name: 'beta' });

        expect(response.items.map((item) => [item.uid, item.claOnly === true])).toEqual([
          [COMPANY_A, true],
          [COMPANY_B, true],
        ]);
        expect(response).toEqual({ items: response.items, next_page_token: null, upstream_failed: false, total: 2 });
      });

      it('never looks up an organization the caller holds, directly or by inheritance', async () => {
        holds();
        listClaOnlyOrgs.mockResolvedValue({ orgs: [], failed: false });

        await new OrgNavigationService().getOrgItems(req, { claOnly: true });

        expect(listClaOnlyOrgs).toHaveBeenCalledWith(req, new Set([HELD_Z, HELD_INHERITED]));
      });

      it('reports a failed lookup alongside the rows that did resolve', async () => {
        holds();
        listClaOnlyOrgs.mockResolvedValue({ orgs: [{ uid: COMPANY_C, name: 'Gamma Corp' }], failed: true });

        const response = await new OrgNavigationService().getOrgItems(req, { claOnly: true });

        expect(response.items.map((item) => item.uid)).toEqual([COMPANY_C]);
        expect(response.upstream_failed).toBe(true);
      });

      it.each([
        ['the roster never loaded', { upstreamFailed: true }, true],
        ['the roll-up is degraded', { degraded: true }, true],
        ['the staff check failed', { staffCheck: 'failed' }, true],
        ['the caller is staff', { isStaff: true }, false],
      ])('answers an empty list without asking when %s, reporting whether the list went unchecked', async (_label, overrides, upstreamFailed) => {
        holds(overrides);

        const response = await new OrgNavigationService().getOrgItems(req, { claOnly: true });

        expect(listClaOnlyOrgs).not.toHaveBeenCalled();
        expect(response).toEqual({ items: [], next_page_token: null, upstream_failed: upstreamFailed, total: 0 });
      });
    });

    it.each([
      ['the roll-up is degraded', { degraded: true }],
      ['the staff check failed', { staffCheck: 'failed' }],
    ])('lists the held organizations alone when %s, since what is held is not proven', async (_label, overrides) => {
      holds(overrides);

      const response = await new OrgNavigationService().getOrgItems(req, {});

      expect(listClaOnlyOrgs).not.toHaveBeenCalled();
      expect(response.items.map((item) => item.uid)).toEqual([HELD_Z, HELD_INHERITED]);
      expect(response.cla_only_deferred).toBeUndefined();
    });

    it('asks nothing and defers nothing on a continuation page', async () => {
      holds();

      const response = await new OrgNavigationService().getOrgItems(req, { pageToken: 'cursor-2' });

      expect(listClaOnlyOrgs).not.toHaveBeenCalled();
      expect(response.cla_only_deferred).toBeUndefined();
    });
  });

  it('never asks for CLA-only organizations while the roll-up is degraded, since inherited organizations may be missing', async () => {
    noGrants({ degraded: true });

    await new OrgNavigationService().getOrgItems(req, {});

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
  });

  it('never asks for or defers CLA-only organizations for staff', async () => {
    proxyRequest.mockResolvedValue(cataloguePage(['found'], null));

    const response = await new OrgNavigationService().getOrgItems(req, { name: 'org' });

    expect(listClaOnlyOrgs).not.toHaveBeenCalled();
    expect(response.cla_only_deferred).toBeUndefined();
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

describe('OrgNavigationService — all employee view company (#5845)', () => {
  const COMPANY_A = '001A000000AAAAAAAA';
  const COMPANY_B = '001B000000BBBBBBBB';
  const eligible = { eligible: true, org: { orgUid: COMPANY_A, orgName: 'Acme Corp', orgSlug: null } };

  beforeEach(() => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = 'true';
    getEffectiveUsername.mockReturnValue('employee');
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map(),
      orgDocByUid: new Map(),
      upstreamFailed: false,
      loadedAt: 'now',
      username: 'employee',
      isStaff: false,
    });
    listClaOnlyOrgs.mockResolvedValue({ orgs: [], failed: false });
  });

  it('lists the employee company as a row flagged employeeView for a caller who holds nothing', async () => {
    resolveEmployeeView.mockResolvedValue(eligible);

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items).toEqual([expect.objectContaining({ uid: COMPANY_A, name: 'Acme Corp', isAssigned: true, employeeView: true })]);
    expect(response.items[0].claOnly).toBeUndefined();
    expect(response).toMatchObject({ upstream_failed: false, total: 1 });
  });

  it('lists nothing extra for a caller who does not qualify', async () => {
    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items).toEqual([]);
    expect(response.upstream_failed).toBe(false);
  });

  it('lets employee access supersede a CLA-only row for the same company, keeping other CLA-only rows', async () => {
    resolveEmployeeView.mockResolvedValue(eligible);
    listClaOnlyOrgs.mockResolvedValue({
      orgs: [
        { uid: COMPANY_A, name: 'Acme Corp' },
        { uid: COMPANY_B, name: 'Beta Corp' },
      ],
      failed: false,
    });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items.map((item) => [item.uid, item.claOnly === true, item.employeeView === true])).toEqual([
      [COMPANY_A, false, true],
      [COMPANY_B, true, false],
    ]);
  });

  it('reports an unavailable lookup as upstream_failed, not as no companies', async () => {
    resolveEmployeeView.mockRejectedValue(new Error('cdp down'));

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items).toEqual([]);
    expect(response.upstream_failed).toBe(true);
  });

  it('does not ask while the flag is off', async () => {
    delete process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'];

    await new OrgNavigationService().getOrgItems(req, {});

    expect(resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('returns the company slug on the row, so the indexed row never overwrites the resolver slug', async () => {
    resolveEmployeeView.mockResolvedValue({ eligible: true, org: { orgUid: COMPANY_A, orgName: 'Acme Corp', orgSlug: 'acme-corp' } });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items[0]).toMatchObject({ uid: COMPANY_A, slug: 'acme-corp' });
  });

  it('lists an authorizer-only reader as a full-access company, superseding their CLA-only row and never marking it employee-view', async () => {
    resolveEmployeeView.mockResolvedValue({
      eligible: false,
      reason: 'holds-full-access',
      org: { orgUid: COMPANY_A, orgName: 'Acme Corp', orgSlug: 'acme-corp' },
    });
    listClaOnlyOrgs.mockResolvedValue({
      orgs: [
        { uid: COMPANY_A, name: 'Acme Corp' },
        { uid: COMPANY_B, name: 'Beta Corp' },
      ],
      failed: false,
    });

    const response = await new OrgNavigationService().getOrgItems(req, {});

    expect(response.items.map((item) => [item.uid, item.claOnly === true, item.employeeView === true, item.fullAccess === true, item.slug])).toEqual([
      [COMPANY_A, false, false, true, 'acme-corp'],
      [COMPANY_B, true, false, false, null],
    ]);
  });
});
