// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
const { withOrgCache } = vi.hoisted(() => ({
  withOrgCache: vi.fn<
    (accountId: string, key: string, ttl: number, fetcher: () => Promise<unknown>, accept?: unknown, storable?: (value: unknown) => boolean) => Promise<unknown>
  >(async (...args) => args[3]()),
}));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

/** Snowflake's answer to a column lf-dbt has not built yet. */
const invalidIdentifier = (column: string): Error =>
  Object.assign(new Error(`SQL compilation error: error line 7 at position 16\ninvalid identifier '${column}'`), { code: '000904' });

const { OrgInvolvementService } = await import('./org-involvement.service');

// The trend read is the one selecting ACTIVE_ROLES (ORG_OVERVIEW_MAINTAINER_ROLES_TREND); the headline selects MAINTAINER_ROLES.
const isRolesTrend = (sql: string): boolean => sql.includes('ACTIVE_ROLES');
const missing = (object: string): Error => new Error(`SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.${object}' does not exist or not authorized.`);

describe('OrgInvolvementService.getMaintainersMonthly (lfx-self-serve#4482, #4685, #4694)', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) =>
      isRolesTrend(sql)
        ? {
            rows: [
              { MONTH_START_DATE: new Date(2030, 0, 15), ACTIVE_ROLES: 12 },
              { MONTH_START_DATE: new Date(2030, 1, 15), ACTIVE_ROLES: null },
            ],
          }
        : { rows: [{ MAINTAINER_ROLES: 764 }] }
    );
  });

  it('counts roles overlapping the last 2 years as the headline and the roles held per month as the trend', async () => {
    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({
      accountId: 'acc-1',
      maintainerRoles: 764,
      monthlyData: [12, 0],
      monthlyLabels: ['Jan 2030', 'Feb 2030'],
    });
  });

  it('reads the headline with the shared overlap rule over all projects, binding the account then 730 days', async () => {
    await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    const [sql, binds] = execute.mock.calls.find(([query]) => !isRolesTrend(String(query)))!;
    expect(sql).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID)');
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE() AND (ROLE_END_DATE IS NULL OR ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))');
    expect(sql).not.toContain('IS_LF_PROJECT');
    expect(binds).toEqual(['acc-1', 730]);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('maintainer-roles:v3');
  });

  // lfx-self-serve#4685: Insights leaves team members' roles unattributed, so the company's count never has them.
  it("leaves CDP team members' roles out of the headline and the trend", async () => {
    await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    const [sql, , options] = execute.mock.calls.find(([query]) => !isRolesTrend(String(query)))!;
    expect(sql).toContain('AND NOT IS_CDP_TEAM_MEMBER');
    expect(options).toMatchObject({ expectMissingObject: 'ORG_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    const [trendSql, , trendOptions] = execute.mock.calls.find(([query]) => isRolesTrend(String(query)))!;
    expect(trendSql).toContain('SELECT MONTH_START_DATE, ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS AS ACTIVE_ROLES');
    expect(trendOptions).toMatchObject({
      expectMissingObject: 'ORG_OVERVIEW_MAINTAINER_ROLES_TREND',
      expectInvalidIdentifier: 'ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS',
    });
  });

  it('counts team members, and does not store the card, while the roles table has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER')) throw invalidIdentifier('IS_CDP_TEAM_MEMBER');
      return isRolesTrend(sql) ? { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), ACTIVE_ROLES: 12 }] } : { rows: [{ MAINTAINER_ROLES: 770 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 770, monthlyData: [12], monthlyLabels: ['Jan 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it("reads the trend's inclusive column, and does not store the card, while the view has no team-member count yet", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS')) throw invalidIdentifier('ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS');
      return isRolesTrend(sql) ? { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), ACTIVE_ROLES: 13 }] } : { rows: [{ MAINTAINER_ROLES: 764 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 764, monthlyData: [13], monthlyLabels: ['Jan 2030'] });
    const trendReads = execute.mock.calls.filter(([query]) => isRolesTrend(String(query)));
    expect(trendReads.at(-1)?.[0]).toContain('SELECT MONTH_START_DATE, ACTIVE_ROLES\n');
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it('stores the card when every read answers', async () => {
    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(true);
  });

  // The trend view lists only accounts holding a role in its window, so an account without any has no rows.
  it('answers zero roles and an empty trend for an account without any', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new OrgInvolvementService().getMaintainersMonthly('acc-1')).toEqual({
      accountId: 'acc-1',
      maintainerRoles: 0,
      monthlyData: [],
      monthlyLabels: [],
    });
  });

  it("selects the trend from lf-dbt's view, binding only the account", async () => {
    await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    const [sql, binds] = execute.mock.calls.find(([query]) => isRolesTrend(String(query)))!;
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_OVERVIEW_MAINTAINER_ROLES_TREND');
    expect(sql).not.toContain('COUNT(');
    expect(binds).toEqual(['acc-1']);
  });

  it('keeps the headline and answers an empty trend when the trend view is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isRolesTrend(sql)) throw missing('ORG_OVERVIEW_MAINTAINER_ROLES_TREND');
      return { rows: [{ MAINTAINER_ROLES: 764 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 764, monthlyData: [], monthlyLabels: [] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it('answers an unavailable (null) headline, not zero, when the roles table is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isRolesTrend(sql)) return { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), ACTIVE_ROLES: 12 }] };
      throw missing('ORG_MAINTAINER_ROLES');
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: null, monthlyData: [12], monthlyLabels: ['Jan 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });
});

// The trend read is the one selecting UNIQUE_CONTRIBUTORS (ORG_OVERVIEW_CONTRIBUTORS_TREND); the headline selects ACTIVE_CONTRIBUTORS.
const isContributorsTrend = (sql: string): boolean => sql.includes('UNIQUE_CONTRIBUTORS');

describe('OrgInvolvementService.getContributorsMonthly — the People -> Contributors default count', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    execute.mockImplementation(async (sql: string) =>
      isContributorsTrend(sql)
        ? {
            rows: [
              { MONTH_START_DATE: new Date(2030, 0, 15), UNIQUE_CONTRIBUTORS: 310 },
              { MONTH_START_DATE: new Date(2030, 1, 15), UNIQUE_CONTRIBUTORS: null },
            ],
          }
        : { rows: [{ ACTIVE_CONTRIBUTORS: 883 }] }
    );
  });

  it('answers the live count as the headline and the modeled monthly counts as the trend, and stores the card', async () => {
    const response = await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', totalActiveContributors: 883, monthlyData: [310, 0], monthlyLabels: ['Jan 2030', 'Feb 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('contributors:v4');
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(true);
  });

  it('counts distinct people with code in all projects over the last 2 years, team members left out, the Contributors default rule, binding only the account', async () => {
    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    const [sql, binds] = execute.mock.calls.find(([query]) => !isContributorsTrend(String(query)))!;
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY');
    expect(sql).toContain('COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS');
    expect(sql).toContain('WHERE account_id = ?');
    expect(sql).toContain('AND activity_date >= DATEADD(day, -730, CURRENT_DATE())');
    expect(sql).not.toContain('is_lf_project');
    // CDP team members are left out, as on the People -> Contributors default (lfx-self-serve#4685).
    expect(sql).toContain('AND NOT is_cdp_team_member');
    expect(execute.mock.calls.find(([query]) => !isContributorsTrend(String(query)))?.[2]).toEqual({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    expect(binds).toEqual(['acc-1']);
  });

  it("selects the trend's count without team members, so it agrees with the headline", async () => {
    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    const [sql, , options] = execute.mock.calls.find(([query]) => isContributorsTrend(String(query)))!;
    expect(sql).toContain('SELECT MONTH_START_DATE, UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS AS UNIQUE_CONTRIBUTORS');
    expect(options).toEqual({
      expectMissingObject: 'ORG_OVERVIEW_CONTRIBUTORS_TREND',
      expectInvalidIdentifier: 'UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS',
    });
  });

  it('counts team members, and does not store the card, while the warehouse has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('is_cdp_team_member')) throw invalidIdentifier('IS_CDP_TEAM_MEMBER');
      return isContributorsTrend(sql) ? { rows: [] } : { rows: [{ ACTIVE_CONTRIBUTORS: 890 }] };
    });

    const response = await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(response.totalActiveContributors).toBe(890);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it("reads the trend's inclusive column, and does not store the card, while the view has no team-member count yet", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS')) throw invalidIdentifier('UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS');
      return isContributorsTrend(sql) ? { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), UNIQUE_CONTRIBUTORS: 312 }] } : { rows: [{ ACTIVE_CONTRIBUTORS: 883 }] };
    });

    const response = await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', totalActiveContributors: 883, monthlyData: [312], monthlyLabels: ['Jan 2030'] });
    const trendReads = execute.mock.calls.filter(([query]) => isContributorsTrend(String(query)));
    expect(trendReads.at(-1)?.[0]).toContain('SELECT MONTH_START_DATE, UNIQUE_CONTRIBUTORS\n');
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it("selects the trend from lf-dbt's view, binding only the account", async () => {
    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    const [sql, binds] = execute.mock.calls.find(([query]) => isContributorsTrend(String(query)))!;
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_OVERVIEW_CONTRIBUTORS_TREND');
    expect(sql).not.toContain('COUNT(');
    expect(binds).toEqual(['acc-1']);
  });

  it('keeps the headline and answers an empty trend when the trend view is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isContributorsTrend(sql)) throw missing('ORG_OVERVIEW_CONTRIBUTORS_TREND');
      return { rows: [{ ACTIVE_CONTRIBUTORS: 883 }] };
    });

    const response = await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', totalActiveContributors: 883, monthlyData: [], monthlyLabels: [] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  // The trend view lists only accounts with code in its window, so an account without any has no rows.
  it('answers zero and an empty trend for an account without code', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new OrgInvolvementService().getContributorsMonthly('acc-1')).toEqual({
      accountId: 'acc-1',
      totalActiveContributors: 0,
      monthlyData: [],
      monthlyLabels: [],
    });
  });

  it.each([
    ['headline', (sql: string) => !isContributorsTrend(sql)],
    ['trend', isContributorsTrend],
  ])('fails the card when the %s read fails', async (_name, failing) => {
    execute.mockImplementation(async (sql: string) => {
      if (failing(sql)) throw new Error('Warehouse timeout');
      return { rows: [] };
    });

    await expect(new OrgInvolvementService().getContributorsMonthly('acc-1')).rejects.toThrow('Warehouse timeout');
  });
});
