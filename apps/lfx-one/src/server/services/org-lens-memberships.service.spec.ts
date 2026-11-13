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
  const UNREADABLE = '001000000000002AAA';
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
    complete: true,
  });
  const PARENT_ORG = { accountId: PARENT, name: 'Parent Co' };
  const SUBSIDIARY_ORG = { accountId: SUBSIDIARY, name: 'Subsidiary Co' };

  const seatKeys = (account: string, foundation: string, board: number, committee: number) => [
    ...Array.from({ length: board }, (_, i) => `seat-${account}-${foundation}-board-${i}`),
    ...Array.from({ length: committee }, (_, i) => `seat-${account}-${foundation}-committee-${i}`),
  ];
  const active = (account: string, foundation: string, overrides: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = { ...activeColumns(account, foundation), ...overrides };
    row['GOVERNANCE_SEAT_KEYS'] ??= seatKeys(account, foundation, row['BOARD_MEMBER_SEAT_COUNT'] as number, row['COMMITTEE_MEMBER_SEAT_COUNT'] as number);
    return row;
  };
  const activeColumns = (account: string, foundation: string) => ({
    ACCOUNT_ID: account,
    FAMILY_ACCOUNT_ID: PARENT,
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
  });
  const expired = (account: string, foundation: string, expiration: string) => ({
    ACCOUNT_ID: account,
    FAMILY_ACCOUNT_ID: PARENT,
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

  let tables: { active: Record<string, unknown>[]; expired: Record<string, unknown>[] };
  const read = (sql: string, binds: string[], rows: Record<string, unknown>[]) =>
    rows.filter((row) => (sql.includes('WHERE FAMILY_ACCOUNT_ID = ?') ? row['FAMILY_ACCOUNT_ID'] === binds[0] : row['ACCOUNT_ID'] === binds[0]));
  beforeEach(() => {
    execute.mockReset();
    withOrgCacheMock.mockClear();
    cacheKeys.length = 0;
    tables = { active: [], expired: [] };
    execute.mockImplementation(async (sql: string, binds: string[]) => {
      if (sql.includes('ORG_LENS_MEMBERSHIPS_SUMMARY')) return { rows: read(sql, binds, tables.active) };
      if (sql.includes('ORG_LENS_EXPIRED_MEMBERSHIPS')) return { rows: read(sql, binds, tables.expired) };
      return { rows: [] };
    });
  });

  describe('active memberships', () => {
    it('reads the family by its warehouse key in one query, cached once per family', async () => {
      await new OrgLensMembershipsService().getFamilyActiveMemberships(scope([SUBSIDIARY, PARENT, SUBSIDIARY]));

      expect(execute).toHaveBeenCalledTimes(1);
      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('WHERE FAMILY_ACCOUNT_ID = ?');
      expect(sql).toContain('GOVERNANCE_SEAT_KEYS');
      expect(binds).toEqual([PARENT]);
      expect(withOrgCacheMock.mock.calls[0][0]).toBe(ROLL_UP);
      expect(cacheKeys).toEqual(['memberships-active-family:v3']);
    });

    it('lists one row per organization and foundation, each naming its organization, and counts each foundation once on the Active card', async () => {
      tables.active = [
        active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }),
        active(SUBSIDIARY, 'cncf', { BOARD_MEMBER_SEAT_COUNT: 0 }),
        active(SUBSIDIARY, 'lfn'),
      ];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.accountId).toBe(ROLL_UP);
      expect(response.memberships.map((m) => [m.foundationId, m.organization])).toEqual([
        ['cncf', PARENT_ORG],
        ['cncf', SUBSIDIARY_ORG],
        ['lfn', SUBSIDIARY_ORG],
      ]);
      expect(response.summary).toEqual({ activeMemberships: 2, renewingWithin90Days: 1, governanceRoles: 3 + 2 + 3 });
      expect(response.organizations).toEqual([SUBSIDIARY_ORG, PARENT_ORG]);
    });

    it('counts each organization’s renewing membership, so two organizations renewing at one foundation count twice', async () => {
      tables.active = [active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }), active(SUBSIDIARY, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true })];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.summary.activeMemberships).toBe(1);
      expect(response.summary.renewingWithin90Days).toBe(2);
    });

    it('counts each organization’s seat keys on the Governance Roles card, so two companies’ seats at one foundation both count', async () => {
      tables.active = [
        active(PARENT, 'cncf', { COMMITTEE_MEMBER_SEAT_COUNT: 0 }),
        active(SUBSIDIARY, 'cncf', { COMMITTEE_MEMBER_SEAT_COUNT: 0 }),
        active(SUBSIDIARY, 'lfn', { COMMITTEE_MEMBER_SEAT_COUNT: 1 }),
      ];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.memberships.map((m) => m.boardMembers)).toEqual([1, 1, 1]);
      expect(response.summary.governanceRoles).toBe(1 + 1 + 2);
    });

    it('counts a seat key the warehouse lists on two rows once', async () => {
      tables.active = [
        active(PARENT, 'cncf', { GOVERNANCE_SEAT_KEYS: ['seat-a', 'seat-b'] }),
        active(SUBSIDIARY, 'cncf', { GOVERNANCE_SEAT_KEYS: ['seat-b', 'seat-c'] }),
      ];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.summary.governanceRoles).toBe(3);
    });

    it('never returns the seat keys', async () => {
      tables.active = [active(PARENT, 'cncf'), active(SUBSIDIARY, 'cncf')];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(JSON.stringify(response)).not.toContain('seat-');
      expect(response.memberships.every((m) => !('GOVERNANCE_SEAT_KEYS' in m))).toBe(true);
    });

    it('leaves out an organization of the family the caller cannot read, from the rows and the cards', async () => {
      tables.active = [active(PARENT, 'cncf'), active(UNREADABLE, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }), active(UNREADABLE, 'lfn')];

      const response = await new OrgLensMembershipsService().getFamilyActiveMemberships(scope());

      expect(response.memberships.map((m) => m.organization?.accountId)).toEqual([PARENT]);
      expect(response.summary).toEqual({ activeMemberships: 1, renewingWithin90Days: 0, governanceRoles: 3 });
      expect(response.organizations?.map((o) => o.accountId)).not.toContain(UNREADABLE);
    });

    it('computes the cards over the rows the filters keep, the Company filter included', async () => {
      tables.active = [
        active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }),
        active(SUBSIDIARY, 'cncf'),
        active(SUBSIDIARY, 'lfn', { MEMBERSHIP_TIER_DISPLAY_NAME: 'Silver Membership' }),
      ];
      const service = new OrgLensMembershipsService();

      const family = await service.getFamilyActiveMemberships(scope());
      expect(family.summary.governanceRoles).toBe(9);

      const subsidiary = await service.getFamilyActiveMemberships(scope(), { company: SUBSIDIARY });
      expect(subsidiary.memberships).toHaveLength(2);
      expect(subsidiary.summary).toEqual({ activeMemberships: 2, renewingWithin90Days: 0, governanceRoles: 6 });

      const gold = await service.getFamilyActiveMemberships(scope(), { tier: 'Gold Membership', search: 'cn' });
      expect(gold.memberships.map((m) => m.organization?.accountId)).toEqual([PARENT, SUBSIDIARY]);
      expect(gold.summary).toEqual({ activeMemberships: 1, renewingWithin90Days: 1, governanceRoles: 6 });
      expect(gold.organizations).toHaveLength(2);
    });

    it('answers a one-organization family with exactly that organization’s rows and cards', async () => {
      tables.active = [active(PARENT, 'cncf', { IS_RENEWING_WITHIN_90_DAYS: true }), active(PARENT, 'lfn'), active(SUBSIDIARY, 'oif')];
      const service = new OrgLensMembershipsService();

      const family = await service.getFamilyActiveMemberships(scope([PARENT]));
      const single = await service.getActiveMemberships(PARENT);

      expect(family.summary).toEqual(single.summary);
      expect(family.memberships.map((row) => ({ ...row, organization: undefined }))).toEqual(single.memberships);
    });

    it('leaves the single-organization read unchanged: one account bound, no seat keys, no organization on the rows', async () => {
      tables.active = [active(PARENT, 'cncf')];

      const response = await new OrgLensMembershipsService().getActiveMemberships(PARENT);

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('WHERE ACCOUNT_ID = ?');
      expect(sql).not.toContain('SEAT_KEYS');
      expect(binds).toEqual([PARENT]);
      expect(cacheKeys[0]).toBe('memberships-active');
      expect(response.memberships[0].organization).toBeUndefined();
      expect(response.organizations).toBeUndefined();
    });
  });

  describe('expired memberships', () => {
    it('reads every expired membership of the family by its warehouse key, one row per organization, each naming its organization', async () => {
      tables.expired = [expired(PARENT, 'lfn', '2028-12-31'), expired(SUBSIDIARY, 'lfn', '2029-03-31'), expired(PARENT, 'oif', '2027-01-31')];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope());

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('WHERE FAMILY_ACCOUNT_ID = ?');
      expect(sql).not.toContain('IS_FAMILY_ROLLUP_ROW');
      expect(sql).toContain('ORDER BY FOUNDATION_NAME ASC, ACCOUNT_ID ASC');
      expect(binds).toEqual([PARENT]);
      expect(cacheKeys).toEqual(['memberships-expired-family:v3']);
      expect(response.memberships.map((m) => [m.foundationId, m.expirationDate, m.organization, m.actionType])).toEqual([
        ['lfn', '2028-12-31', PARENT_ORG, 'renew'],
        ['lfn', '2029-03-31', SUBSIDIARY_ORG, 'renew'],
        ['oif', '2027-01-31', PARENT_ORG, 'renew'],
      ]);
      expect(response.organizations).toHaveLength(2);
    });

    it('leaves out a row naming an organization the caller cannot read', async () => {
      tables.expired = [expired(UNREADABLE, 'lfn', '2029-03-31'), expired(PARENT, 'oif', '2027-01-31')];

      const response = await new OrgLensMembershipsService().getFamilyExpiredMemberships(scope());

      expect(response.memberships.map((m) => m.foundationId)).toEqual(['oif']);
    });

    it('narrows to one company and searches by name', async () => {
      tables.expired = [expired(SUBSIDIARY, 'lfn', '2029-03-31'), expired(PARENT, 'oif', '2027-01-31'), expired(PARENT, 'osf', '2026-01-31')];
      const service = new OrgLensMembershipsService();

      const parent = await service.getFamilyExpiredMemberships(scope(), undefined, PARENT);
      expect(parent.memberships.map((m) => m.foundationId)).toEqual(['oif', 'osf']);

      const searched = await service.getFamilyExpiredMemberships(scope(), 'oi', PARENT);
      expect(searched.memberships.map((m) => m.foundationId)).toEqual(['oif']);
    });
  });
});
