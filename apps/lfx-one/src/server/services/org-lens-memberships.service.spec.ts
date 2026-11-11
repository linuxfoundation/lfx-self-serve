// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can reference them.
const { execute, withOrgCacheMock, cacheKeys } = vi.hoisted(() => {
  const keys: string[] = [];
  return {
    execute: vi.fn(),
    cacheKeys: keys,
    // Pass-through: records the sub-resource the service asked for, then runs the fetcher.
    withOrgCacheMock: vi.fn(async (_accountId: string, subResource: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      keys.push(subResource);
      return fetcher();
    }),
  };
});

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./valkey.service', () => ({ withOrgCache: withOrgCacheMock }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./org-lens-key-contacts.service', () => ({ OrgLensKeyContactsService: class {} }));

const { OrgLensMembershipsService } = await import('./org-lens-memberships.service');

describe('OrgLensMembershipsService.getFoundationProjects', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCacheMock.mockClear();
    cacheKeys.length = 0;
  });

  it('shapes the foundation-projects detail rows behind the Org Projects count, with LF maintainer roles from their own read', async () => {
    execute.mockImplementation(async (sql: string) =>
      sql.includes('ORG_MAINTAINER_ROLES')
        ? { rows: [{ PROJECT_ID: 'p-1', MAINTAINER_ROLES: 2 }] }
        : {
            rows: [
              {
                PROJECT_ID: 'p-1',
                PROJECT_SLUG: 'kubernetes',
                PROJECT_NAME: 'Kubernetes',
                IS_LF_PROJECT: true,
                INFLUENCE_MAX_BUCKET: 'Leading',
                CONTRIBUTORS_COUNT: 9,
                COLLABORATORS_COUNT: 4,
                COMMITS_COUNT: 120,
              },
            ],
          }
    );

    const result = await new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf');

    expect(result).toEqual({
      accountId: 'acc-1',
      foundationId: 'cncf',
      projects: [
        {
          projectId: 'p-1',
          projectSlug: 'kubernetes',
          projectName: 'Kubernetes',
          isLfProject: true,
          influence: 'Leading',
          maintainers: 2,
          contributors: 9,
          collaborators: 4,
          commits: 120,
        },
      ],
    });

    const [query, binds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_LENS_FOUNDATION_PROJECTS_DETAIL'))!;
    expect(query).toContain('WHERE ACCOUNT_ID = ?');
    expect(query).toContain('AND FOUNDATION_ID = ?');
    expect(query).not.toContain('ORG_MAINTAINER_ROLES');
    expect(binds).toEqual(['acc-1', 'cncf']);
    const [rolesQuery, rolesBinds] = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_MAINTAINER_ROLES'))!;
    expect(rolesQuery).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES');
    expect(rolesQuery).toContain('IS_LF_PROJECT = TRUE');
    expect(rolesQuery).toContain('ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE())');
    expect(rolesBinds).toEqual(['acc-1', 730]);
  });

  it('keeps listing the projects, with unavailable (null) roles and uncached, when the roles table is missing', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return {
        rows: [
          { PROJECT_ID: 'p-1', IS_LF_PROJECT: true, INFLUENCE_MAX_BUCKET: 'Leading' },
          { PROJECT_ID: 'p-2', IS_LF_PROJECT: false, INFLUENCE_MAX_BUCKET: 'Silent' },
        ],
      };
    });

    const { projects } = await new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf');

    expect(projects.map((project) => [project.projectId, project.maintainers])).toEqual([
      ['p-1', null],
      ['p-2', 0],
    ]);
    const storable = (withOrgCacheMock.mock.calls[0] as unknown[] | undefined)?.[5] as ((value: unknown) => boolean) | undefined;
    expect(storable?.([])).toBe(false);
  });

  it('scopes the cache entry per foundation', async () => {
    execute.mockResolvedValue({ rows: [] });
    const service = new OrgLensMembershipsService();

    await service.getFoundationProjects('acc-1', 'cncf');
    await service.getFoundationProjects('acc-1', 'lf-edge');

    expect(cacheKeys).toEqual(['memberships-projects:v5:cncf', 'memberships-projects:v5:lf-edge']);
  });

  it('returns an empty envelope rather than failing when the org has no projects for the foundation', async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(new OrgLensMembershipsService().getFoundationProjects('acc-1', 'cncf')).resolves.toEqual({
      accountId: 'acc-1',
      foundationId: 'cncf',
      projects: [],
    });
  });
});

describe('OrgLensMembershipsService — family roll-up', () => {
  const PARENT = '001000000000000AAA';
  const SUBSIDIARY = '001000000000001AAA';
  const ROLL_UP = `family-${PARENT}`;
  const scope = (accountIds: string[] = [SUBSIDIARY, PARENT]) => ({
    rollUpKey: ROLL_UP,
    rootUid: PARENT,
    members: accountIds.map((accountId) => ({
      uid: accountId,
      accountId,
      name: accountId === PARENT ? 'Parent Co' : 'Subsidiary Co',
      logoUrl: null,
    })),
  });
  const PARENT_ORG = { accountId: PARENT, name: 'Parent Co' };
  const SUBSIDIARY_ORG = { accountId: SUBSIDIARY, name: 'Subsidiary Co' };

  const active = (account: string, foundation: string, overrides: Record<string, unknown> = {}) => ({
    ACCOUNT_ID: account,
    FOUNDATION_ID: foundation,
    FOUNDATION_NAME: foundation.toUpperCase(),
    FOUNDATION_SLUG: foundation,
    FOUNDATION_LOGO_URL: null,
    MEMBERSHIP_TIER_DISPLAY_NAME: 'Gold Membership',
    TIER_START_DATE: '2030-01-01',
    TIER_END_DATE: '2030-12-31',
    FIRST_MEMBERSHIP_STARTED_AT: '2020-01-01',
    BOARD_MEMBER_SEAT_COUNT: 1,
    COMMITTEE_MEMBER_SEAT_COUNT: 2,
    ORG_PROJECTS_COUNT: 3,
    PROJECT_COUNT: 10,
    MEMBER_COUNT: 50,
    IS_RENEWING_WITHIN_90_DAYS: false,
    ...overrides,
  });
  const expired = (account: string, foundation: string, expiration: string) => ({
    ACCOUNT_ID: account,
    FOUNDATION_ID: foundation,
    FOUNDATION_NAME: foundation.toUpperCase(),
    FOUNDATION_SLUG: foundation,
    FOUNDATION_LOGO_URL: null,
    MEMBERSHIP_TIER_DISPLAY_NAME: 'Silver Membership',
    TIER_START_DATE: '2028-01-01',
    TIER_END_DATE: expiration,
    EXPIRATION_DATE: expiration,
    ACTION_TYPE: 'renew',
  });
  const discover = (account: string, foundation: string, contributors: number, contributions: number, relevant: number) => ({
    ACCOUNT_ID: account,
    FOUNDATION_ID: foundation,
    FOUNDATION_NAME: foundation.toUpperCase(),
    FOUNDATION_SLUG: foundation,
    FOUNDATION_LOGO_URL: null,
    PROJECT_TYPE: 'Foundation',
    SUGGESTED_TIER: 'Gold Membership',
    CONTRIBUTORS_COUNT: contributors,
    CONTRIBUTION_COUNT: contributions,
    RELEVANT_PROJECTS: relevant,
  });

  let tables: {
    active: Record<string, unknown>[];
    expired: Record<string, unknown>[];
    discover: Record<string, unknown>[];
    projects: Record<string, unknown>[];
  };
  const bound = (binds: string[]) => (rows: Record<string, unknown>[]) => rows.filter((row) => binds.includes(row['ACCOUNT_ID'] as string));
  beforeEach(() => {
    execute.mockReset();
    withOrgCacheMock.mockClear();
    cacheKeys.length = 0;
    tables = { active: [], expired: [], discover: [], projects: [] };
    execute.mockImplementation(async (sql: string, binds: string[]) => {
      const keep = bound(binds);
      if (sql.includes('ORG_LENS_MEMBERSHIPS_SUMMARY')) return { rows: keep(tables.active) };
      if (sql.includes('ORG_LENS_EXPIRED_MEMBERSHIPS')) return { rows: keep(tables.expired) };
      if (sql.includes('ORG_LENS_DISCOVER_MEMBERSHIPS')) return { rows: keep(tables.discover) };
      if (sql.includes('ORG_LENS_FOUNDATION_PROJECTS_DETAIL')) {
        const perFoundation = new Map<string, Set<string>>();
        for (const row of keep(tables.projects)) {
          const projects = perFoundation.get(row['FOUNDATION_ID'] as string) ?? new Set<string>();
          projects.add(row['PROJECT_ID'] as string);
          perFoundation.set(row['FOUNDATION_ID'] as string, projects);
        }
        return { rows: [...perFoundation].map(([FOUNDATION_ID, projects]) => ({ FOUNDATION_ID, RELEVANT_PROJECTS: projects.size })) };
      }
      return { rows: [] };
    });
  });

  describe('active memberships', () => {
    it('reads every organization in one query, binding the sorted set, and caches under the roll-up key and the set', async () => {
      await new OrgLensMembershipsService().getFamilyActiveMemberships(scope([SUBSIDIARY, PARENT, SUBSIDIARY]));

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('WHERE ACCOUNT_ID IN (?, ?)');
      expect(binds).toEqual([PARENT, SUBSIDIARY]);
      expect(withOrgCacheMock.mock.calls[0][0]).toBe(ROLL_UP);
      expect(cacheKeys[0]).toMatch(/^memberships-active-family:v1:[0-9a-f]{16}$/);
    });

    it('keys the cache on the set: the same set in any order shares an entry, a different set does not', async () => {
      const service = new OrgLensMembershipsService();
      await service.getFamilyActiveMemberships(scope([PARENT, SUBSIDIARY]));
      await service.getFamilyActiveMemberships(scope([SUBSIDIARY, PARENT]));
      await service.getFamilyActiveMemberships(scope([PARENT]));

      expect(cacheKeys[0]).toBe(cacheKeys[1]);
      expect(cacheKeys[2]).not.toBe(cacheKeys[0]);
    });

    it('lists one row per organization and foundation, each naming its organization, and counts every row on the cards', async () => {
      tables.active = [
        active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }),
        active(SUBSIDIARY, 'cncf', { BOARD_MEMBER_SEAT_COUNT: 0, COMMITTEE_MEMBER_SEAT_COUNT: 4 }),
        active(SUBSIDIARY, 'lfn'),
      ];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.accountId).toBe(ROLL_UP);
      expect(response.memberships.map((m) => [m.foundationId, m.organization])).toEqual([
        ['cncf', PARENT_ORG],
        ['cncf', SUBSIDIARY_ORG],
        ['lfn', SUBSIDIARY_ORG],
      ]);
      expect(response.summary).toEqual({ activeMemberships: 3, renewingWithin90Days: 1, governanceRoles: 3 + 4 + 3 });
      expect(response.organizations).toEqual([SUBSIDIARY_ORG, PARENT_ORG]);
    });

    it('computes the cards over the rows the filters keep, the Company filter included', async () => {
      tables.active = [
        active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }),
        active(SUBSIDIARY, 'cncf'),
        active(SUBSIDIARY, 'lfn', { MEMBERSHIP_TIER_DISPLAY_NAME: 'Silver Membership' }),
      ];
      const service = new OrgLensMembershipsService();

      const subsidiary = await service.getFamilyActiveMemberships(scope(), { company: SUBSIDIARY });
      expect(subsidiary.memberships).toHaveLength(2);
      expect(subsidiary.summary.activeMemberships).toBe(2);
      expect(subsidiary.summary.renewingWithin90Days).toBe(0);

      const gold = await service.getFamilyActiveMemberships(scope(), { tier: 'Gold Membership', search: 'cn' });
      expect(gold.memberships.map((m) => m.organization?.accountId)).toEqual([PARENT, SUBSIDIARY]);
      expect(gold.summary).toEqual({ activeMemberships: 2, renewingWithin90Days: 1, governanceRoles: 6 });
      expect(gold.organizations).toHaveLength(2);
    });

    it('answers a one-organization family with exactly that organization’s rows and cards', async () => {
      tables.active = [active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }), active(PARENT, 'lfn'), active(SUBSIDIARY, 'oif')];
      const service = new OrgLensMembershipsService();

      const family = await service.getFamilyActiveMemberships(scope([PARENT]));
      const single = await service.getActiveMemberships(PARENT);

      expect(family.summary).toEqual(single.summary);
      expect(family.memberships.map(({ organization: _organization, ...row }) => row)).toEqual(single.memberships);
    });

    it('leaves the single-organization read unchanged: one account bound, no organization on the rows', async () => {
      tables.active = [active(PARENT, 'cncf')];

      const response = await new OrgLensMembershipsService().getActiveMemberships(PARENT);

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('WHERE ACCOUNT_ID = ?');
      expect(binds).toEqual([PARENT]);
      expect(cacheKeys[0]).toBe('memberships-active');
      expect(response.memberships[0].organization).toBeUndefined();
      expect(response.organizations).toBeUndefined();
    });
  });

  describe('expired memberships', () => {
    it('drops a foundation another organization in the family still holds, and keeps one row per foundation, the latest expiry', async () => {
      tables.active = [active(PARENT, 'cncf')];
      tables.expired = [
        expired(SUBSIDIARY, 'cncf', '2029-06-30'),
        expired(PARENT, 'lfn', '2028-12-31'),
        expired(SUBSIDIARY, 'lfn', '2029-03-31'),
        expired(PARENT, 'oif', '2027-01-31'),
      ];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope());

      expect(response.memberships.map((m) => [m.foundationId, m.expirationDate, m.organization])).toEqual([
        ['lfn', '2029-03-31', SUBSIDIARY_ORG],
        ['oif', '2027-01-31', PARENT_ORG],
      ]);
      expect(response.organizations).toHaveLength(2);
    });

    it('breaks a tie on expiry by organization name, whatever the row order', async () => {
      tables.expired = [expired(SUBSIDIARY, 'lfn', '2029-03-31'), expired(PARENT, 'lfn', '2029-03-31')];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope());

      expect(response.memberships.map((m) => m.organization)).toEqual([PARENT_ORG]);
    });

    it('narrows to one company before folding, while still judging foundations against the whole family', async () => {
      tables.active = [active(SUBSIDIARY, 'cncf')];
      tables.expired = [expired(PARENT, 'cncf', '2029-06-30'), expired(PARENT, 'lfn', '2028-12-31'), expired(SUBSIDIARY, 'lfn', '2029-03-31')];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope(), undefined, PARENT);

      expect(response.memberships.map((m) => [m.foundationId, m.organization])).toEqual([['lfn', PARENT_ORG]]);
    });

    it('applies the name search after folding', async () => {
      tables.expired = [expired(PARENT, 'lfn', '2028-12-31'), expired(PARENT, 'oif', '2027-01-31')];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope(), 'oi');

      expect(response.memberships.map((m) => m.foundationId)).toEqual(['oif']);
    });
  });

  describe('discover opportunities', () => {
    it('drops foundations the family holds, keeps one row per foundation, adds contributions and counts projects once', async () => {
      tables.active = [active(SUBSIDIARY, 'cncf')];
      tables.discover = [
        discover(PARENT, 'cncf', 9, 90, 3),
        discover(PARENT, 'lfn', 4, 40, 2),
        discover(SUBSIDIARY, 'lfn', 3, 30, 2),
        discover(SUBSIDIARY, 'oif', 1, 100, 1),
      ];
      tables.projects = [
        { ACCOUNT_ID: PARENT, FOUNDATION_ID: 'lfn', PROJECT_ID: 'p1' },
        { ACCOUNT_ID: PARENT, FOUNDATION_ID: 'lfn', PROJECT_ID: 'p2' },
        { ACCOUNT_ID: SUBSIDIARY, FOUNDATION_ID: 'lfn', PROJECT_ID: 'p2' },
        { ACCOUNT_ID: SUBSIDIARY, FOUNDATION_ID: 'oif', PROJECT_ID: 'p3' },
      ];

      const response = await new OrgLensMembershipsService().getFamilyDiscoverOpportunities(scope());

      expect(response.accountId).toBe(ROLL_UP);
      expect(response.opportunities.map((o) => [o.foundationId, o.contributions, o.relevantProjects, o.contributors])).toEqual([
        ['oif', 100, 1, 1],
        ['lfn', 70, 2, 7],
      ]);
    });

    it('reads relevant projects for LF projects only, over the same set of organizations', async () => {
      await new OrgLensMembershipsService().getFamilyDiscoverOpportunities(scope());

      const projectsCall = execute.mock.calls.find(([sql]) => String(sql).includes('ORG_LENS_FOUNDATION_PROJECTS_DETAIL'))!;
      expect(projectsCall[0]).toContain('COUNT(DISTINCT PROJECT_ID) AS RELEVANT_PROJECTS');
      expect(projectsCall[0]).toContain('AND IS_LF_PROJECT = TRUE');
      expect(projectsCall[1]).toEqual([PARENT, SUBSIDIARY]);
    });
  });
});
