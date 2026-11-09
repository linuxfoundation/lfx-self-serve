// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-events-filters.utils')),
}));
const { withOrgCache } = vi.hoisted(() => ({
  withOrgCache: vi.fn<
    (accountId: string, key: string, ttl: number, fetcher: () => Promise<unknown>, accept?: unknown, storable?: (value: unknown) => boolean) => Promise<unknown>
  >(async (...args) => args[3]()),
}));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
// The scope read is its own spec's concern; here it answers the pick, or `all` for an account without an Insights org.
const { resolveOrgScope } = vi.hoisted(() => ({ resolveOrgScope: vi.fn(async (_snowflake: unknown, _accountId: string, scope: string) => scope) }));
vi.mock('../helpers/org-scope.helper', async (importOriginal) => ({ ...(await importOriginal<object>()), resolveOrgScope }));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

/** Snowflake's answer to a column lf-dbt has not built yet. */
const invalidIdentifier = (column: string): Error =>
  Object.assign(new Error(`SQL compilation error: error line 7 at position 16\ninvalid identifier '${column}'`), { code: '000904' });

const { OrgInvolvementService } = await import('./org-involvement.service');

// The trend read is the one selecting ACTIVE_ROLES (ORG_MAINTAINER_ROLES_MONTHLY); the headline selects MAINTAINER_ROLES.
const isRolesTrend = (sql: string): boolean => sql.includes('ACTIVE_ROLES');
const missing = (object: string): Error => new Error(`SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.${object}' does not exist or not authorized.`);

describe('OrgInvolvementService.getMaintainersMonthly (lfx-self-serve#4482, #4685, #4694)', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) =>
      isRolesTrend(sql)
        ? {
            rows: [
              { METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 12 },
              { METRIC_MONTH: new Date(2030, 1, 15), ACTIVE_ROLES: null },
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
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('maintainer-roles:v4');
  });

  // lfx-self-serve#4685: Insights leaves team members' roles unattributed, so the company's count never has them.
  it("leaves CDP team members' roles out of the headline and the trend", async () => {
    await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    const [sql, , options] = execute.mock.calls.find(([query]) => !isRolesTrend(String(query)))!;
    expect(sql).toContain('AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)');
    expect(options).toMatchObject({ expectMissingObject: 'ORG_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    const [trendSql, , trendOptions] = execute.mock.calls.find(([query]) => isRolesTrend(String(query)))!;
    expect(trendSql).toContain('SELECT METRIC_MONTH, ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS AS ACTIVE_ROLES');
    expect(trendOptions).toMatchObject({
      expectMissingObject: 'ORG_MAINTAINER_ROLES_MONTHLY',
      expectInvalidIdentifier: 'ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS',
    });
  });

  it('counts team members, and does not store the card, while the roles table has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER')) throw invalidIdentifier('IS_CDP_TEAM_MEMBER');
      return isRolesTrend(sql) ? { rows: [{ METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 12 }] } : { rows: [{ MAINTAINER_ROLES: 770 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 770, monthlyData: [12], monthlyLabels: ['Jan 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it("reads the trend's inclusive column, and does not store the card, while the view has no team-member count yet", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS')) throw invalidIdentifier('ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS');
      return isRolesTrend(sql) ? { rows: [{ METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 13 }] } : { rows: [{ MAINTAINER_ROLES: 764 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 764, monthlyData: [13], monthlyLabels: ['Jan 2030'] });
    const trendReads = execute.mock.calls.filter(([query]) => isRolesTrend(String(query)));
    expect(trendReads.at(-1)?.[0]).toContain('SELECT METRIC_MONTH, ACTIVE_ROLES\n');
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
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_MONTHLY');
    expect(sql).not.toContain('COUNT(');
    expect(binds).toEqual(['acc-1']);
  });

  it('keeps the headline and answers an empty trend when the trend view is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isRolesTrend(sql)) throw missing('ORG_MAINTAINER_ROLES_MONTHLY');
      return { rows: [{ MAINTAINER_ROLES: 764 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 764, monthlyData: [], monthlyLabels: [] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it('answers an unavailable (null) headline, not zero, when the roles table is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isRolesTrend(sql)) return { rows: [{ METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 12 }] };
      throw missing('ORG_MAINTAINER_ROLES');
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: null, monthlyData: [12], monthlyLabels: ['Jan 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });
});

// The trend read is the one selecting UNIQUE_CONTRIBUTORS (ORG_CONTRIBUTORS_MONTHLY); the headline selects ACTIVE_CONTRIBUTORS.
const isContributorsTrend = (sql: string): boolean => sql.includes('UNIQUE_CONTRIBUTORS');

describe('OrgInvolvementService.getContributorsMonthly — the People -> Contributors default count', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    // An account without an Insights organization: the default scope falls back to every related organization.
    resolveOrgScope.mockResolvedValue('all');
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
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('contributors:v5:all');
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
    expect(sql).toContain('AND NOT COALESCE(is_cdp_team_member, FALSE)');
    expect(execute.mock.calls.find(([query]) => !isContributorsTrend(String(query)))?.[2]).toEqual({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    expect(binds).toEqual(['acc-1']);
  });

  it("selects the trend's count without team members, so it agrees with the headline", async () => {
    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    const [sql, , options] = execute.mock.calls.find(([query]) => isContributorsTrend(String(query)))!;
    expect(sql).toContain('SELECT MONTH_START_DATE, UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS AS UNIQUE_CONTRIBUTORS');
    expect(options).toEqual({
      expectMissingObject: 'ORG_CONTRIBUTORS_MONTHLY',
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
      return isContributorsTrend(sql)
        ? { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), UNIQUE_CONTRIBUTORS: 312 }] }
        : { rows: [{ ACTIVE_CONTRIBUTORS: 883 }] };
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
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_CONTRIBUTORS_MONTHLY');
    expect(sql).not.toContain('COUNT(');
    expect(binds).toEqual(['acc-1']);
  });

  it('keeps the headline and answers an empty trend when the trend view is missing, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isContributorsTrend(sql)) throw missing('ORG_CONTRIBUTORS_MONTHLY');
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

// lfx-self-serve-ops#1219: the Overview has no scope picker, so the card always reads the default scope.
describe('OrgInvolvementService.getContributorsMonthly — the default organization scope', () => {
  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    resolveOrgScope.mockReset();
    resolveOrgScope.mockImplementation(async (_snowflake: unknown, _accountId: string, scope: string) => scope);
    execute.mockImplementation(async (sql: string) =>
      isContributorsTrend(sql) ? { rows: [{ MONTH_START_DATE: new Date(2030, 0, 15), UNIQUE_CONTRIBUTORS: 40 }] } : { rows: [{ ACTIVE_CONTRIBUTORS: 55 }] }
    );
  });

  const headlineSql = (): string => String(execute.mock.calls.find(([query]) => !isContributorsTrend(String(query)))![0]);
  const trendCall = (): unknown[] => execute.mock.calls.find(([query]) => isContributorsTrend(String(query)))!;

  it('asks for the Insights organization, keeps only rows with its code and reads the Insights trend column, keyed per scope', async () => {
    const response = await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', totalActiveContributors: 55, monthlyData: [40], monthlyLabels: ['Jan 2030'] });
    expect(resolveOrgScope).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'insights');
    expect(headlineSql()).toContain('AND INSIGHTS_DAILY_CODE_ACTIVITIES > 0');
    const [sql, binds, options] = trendCall();
    expect(sql).toContain('SELECT MONTH_START_DATE, INSIGHTS_UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS AS UNIQUE_CONTRIBUTORS');
    expect(binds).toEqual(['acc-1']);
    expect(options).toEqual({
      expectMissingObject: 'ORG_CONTRIBUTORS_MONTHLY',
      expectInvalidIdentifier: 'INSIGHTS_UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS',
    });
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('contributors:v5:insights');
  });

  it('reads the Insights inclusive twin while the view has no Insights team-member count yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS')) throw invalidIdentifier('INSIGHTS_UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS');
      return isContributorsTrend(sql) ? { rows: [] } : { rows: [{ ACTIVE_CONTRIBUTORS: 55 }] };
    });

    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    const trendReads = execute.mock.calls.filter(([query]) => isContributorsTrend(String(query)));
    expect(trendReads.at(-1)?.[0]).toContain('SELECT MONTH_START_DATE, INSIGHTS_UNIQUE_CONTRIBUTORS AS UNIQUE_CONTRIBUTORS\n');
  });

  it('serves and keys the all-organizations read when the account has no Insights org', async () => {
    resolveOrgScope.mockResolvedValueOnce('all');

    await new OrgInvolvementService().getContributorsMonthly('acc-1');

    expect(headlineSql()).not.toMatch(/insights/i);
    expect(String(trendCall()[0])).toContain('SELECT MONTH_START_DATE, UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS AS UNIQUE_CONTRIBUTORS');
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('contributors:v5:all');
  });
});

describe('OrgInvolvementService.getFamilyContributorsMonthly', () => {
  const ROLL_UP = 'family-001000000000000AAA';
  const ALL_CO = '001000000000001AAA';
  const INSIGHTS_CO = '001000000000002AAA';

  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    resolveOrgScope.mockReset();
    resolveOrgScope.mockImplementation(async (_snowflake: unknown, accountId: string) => (accountId === INSIGHTS_CO ? 'insights' : 'all'));
    execute.mockImplementation(async (sql: string) =>
      isContributorsTrend(sql)
        ? {
            rows: [
              { MONTH_START_DATE: new Date(2030, 0, 15), UNIQUE_CONTRIBUTORS: 20 },
              { MONTH_START_DATE: new Date(2030, 1, 15), UNIQUE_CONTRIBUTORS: 0 },
            ],
          }
        : { rows: [{ ACTIVE_CONTRIBUTORS: 31 }] }
    );
  });

  const headlineCall = (): unknown[] => execute.mock.calls.find(([query]) => !isContributorsTrend(String(query)))!;
  const trendCall = (): unknown[] => execute.mock.calls.find(([query]) => isContributorsTrend(String(query)))!;

  it('answers one headline and one trend for the family under the roll-up key, and stores the card', async () => {
    const response = await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    expect(response).toEqual({ accountId: ROLL_UP, totalActiveContributors: 31, monthlyData: [20, 0], monthlyLabels: ['Jan 2030', 'Feb 2030'] });
    expect(withOrgCache.mock.calls.at(-1)?.[0]).toBe(ROLL_UP);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toMatch(/^contributors-family:v1:[0-9a-f]{16}$/);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(true);
  });

  it('counts distinct people across every company with the single-company headline rule, each company under its own scope', async () => {
    await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    const [sql, binds, options] = headlineCall();
    expect(sql).toContain('COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS');
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY');
    expect(sql).toContain('WHERE account_id IN (?, ?)');
    expect(sql).toContain('AND activity_date >= DATEADD(day, -730, CURRENT_DATE())');
    expect(sql).toContain('AND NOT COALESCE(is_cdp_team_member, FALSE)');
    expect(sql).toContain('AND ((account_id IN (?) AND insights_daily_code_activities > 0) OR account_id IN (?))');
    expect(binds).toEqual([ALL_CO, INSIGHTS_CO, INSIGHTS_CO, ALL_CO]);
    expect(options).toEqual({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
  });

  it('rebuilds the 12-month trend across the family from the daily table, never adding the per-company view', async () => {
    await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    const [sql, binds] = trendCall();
    expect(sql).toContain('FROM TABLE(GENERATOR(ROWCOUNT => 12))');
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY');
    expect(sql).not.toContain('ORG_CONTRIBUTORS_MONTHLY');
    expect(sql).toContain('COUNT(DISTINCT IFF(a.IS_COUNTED, a.person_key, NULL)) AS UNIQUE_CONTRIBUTORS');
    expect(sql).toContain(
      '(TRUE AND NOT COALESCE(is_cdp_team_member, FALSE) AND ((account_id IN (?) AND insights_daily_code_activities > 0) OR account_id IN (?))) AS IS_COUNTED'
    );
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM activity)');
    expect(binds).toEqual([INSIGHTS_CO, ALL_CO, ALL_CO, INSIGHTS_CO]);
  });

  it('adds no scope predicate when no company has an Insights organization', async () => {
    resolveOrgScope.mockImplementation(async () => 'all');

    await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    expect(String(headlineCall()[0])).not.toMatch(/insights/i);
    expect(headlineCall()[1]).toEqual([ALL_CO, INSIGHTS_CO]);
    expect(trendCall()[1]).toEqual([ALL_CO, INSIGHTS_CO]);
  });

  it('keeps only Insights-scoped rows, without an OR term, when every company has an Insights organization', async () => {
    resolveOrgScope.mockImplementation(async () => 'insights');

    await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    expect(headlineCall()[0]).toContain('AND ((account_id IN (?, ?) AND insights_daily_code_activities > 0))');
    expect(headlineCall()[0]).not.toContain(' OR ');
  });

  it('reads each company once and keys the cache on the set, whatever order or repeats it arrives in', async () => {
    const service = new OrgInvolvementService();
    await service.getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO, ALL_CO]);
    const firstKey = withOrgCache.mock.calls.at(-1)?.[1];
    await service.getFamilyContributorsMonthly(ROLL_UP, [INSIGHTS_CO, ALL_CO]);

    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe(firstKey);
    expect(execute.mock.calls.every(([, binds]) => (binds as string[]).length === 4)).toBe(true);

    await service.getFamilyContributorsMonthly(ROLL_UP, [INSIGHTS_CO]);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).not.toBe(firstKey);
  });

  it('answers the zero card without reading the warehouse for an empty set', async () => {
    const response = await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, []);

    expect(response).toEqual({ accountId: ROLL_UP, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] });
    expect(execute).not.toHaveBeenCalled();
    expect(withOrgCache).not.toHaveBeenCalled();
  });

  it('counts team members, and does not store the card, while the warehouse has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('is_cdp_team_member')) throw invalidIdentifier('IS_CDP_TEAM_MEMBER');
      return isContributorsTrend(sql) ? { rows: [] } : { rows: [{ ACTIVE_CONTRIBUTORS: 33 }] };
    });

    const response = await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);

    expect(response.totalActiveContributors).toBe(33);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it.each([
    ['headline', (sql: string) => !isContributorsTrend(sql)],
    ['trend', isContributorsTrend],
  ])('fails the card when the %s read fails', async (_name, failing) => {
    execute.mockImplementation(async (sql: string) => {
      if (failing(sql)) throw new Error('Warehouse timeout');
      return { rows: [] };
    });

    await expect(new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO])).rejects.toThrow('Warehouse timeout');
  });
});

// A fake ORG_PEOPLE_CONTRIBUTORS_DAILY: each read is answered from the rows below, filtered by the companies, scope
// split and team-member rule that the service's own SQL text and binds carry, so the counts depend on what it sends.
describe('OrgInvolvementService.getFamilyContributorsMonthly — against daily fixture rows', () => {
  const ROLL_UP = 'family-001000000000000AAA';
  const ALL_CO = '001000000000001AAA';
  const INSIGHTS_CO = '001000000000002AAA';
  const MONTHS = Array.from({ length: 12 }, (_, month) => new Date(2030, month, 15));
  const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month) => `${month} 2030`);

  interface DailyRow {
    person: string;
    account: string;
    month: number;
    insightsActivities: number;
    teamMember?: boolean;
  }
  const DAILY: DailyRow[] = [
    { person: 'shared', account: ALL_CO, month: 2, insightsActivities: 0 },
    { person: 'shared', account: INSIGHTS_CO, month: 2, insightsActivities: 3 },
    { person: 'all-only', account: ALL_CO, month: 2, insightsActivities: 0 },
    { person: 'all-only', account: ALL_CO, month: 5, insightsActivities: 0 },
    { person: 'insights-only', account: INSIGHTS_CO, month: 5, insightsActivities: 1 },
    { person: 'other-org-code', account: INSIGHTS_CO, month: 5, insightsActivities: 0 },
    { person: 'team', account: ALL_CO, month: 2, insightsActivities: 0, teamMember: true },
  ];

  interface Filter {
    companies: string[];
    insights: string[] | null;
    all: string[];
    excludeTeam: boolean;
  }
  const familyFilter = (sql: string, binds: string[]): Filter => {
    const lists = [...sql.matchAll(/account_id IN \(([?, ]+)\)/g)];
    let offset = 0;
    const filter: Filter = { companies: [], insights: null, all: [], excludeTeam: sql.includes('NOT COALESCE(is_cdp_team_member, FALSE)') };
    for (const list of lists) {
      const values = binds.slice(offset, offset + list[1].split(',').length);
      offset += values.length;
      if (sql.slice(0, list.index).trimEnd().endsWith('WHERE')) filter.companies = values;
      else if (sql.slice(list.index, list.index + 80).includes('insights_daily_code_activities > 0')) filter.insights = values;
      else filter.all = values;
    }
    return filter;
  };
  const singleFilter = (sql: string, account: string): Filter => {
    const insights = sql.includes('INSIGHTS_DAILY_CODE_ACTIVITIES > 0') || sql.includes('INSIGHTS_UNIQUE_CONTRIBUTORS');
    return {
      companies: [account],
      insights: insights ? [account] : null,
      all: [],
      excludeTeam: sql.includes('NOT COALESCE(is_cdp_team_member, FALSE)') || sql.includes('EXCLUDING_TEAM_MEMBERS'),
    };
  };
  const counted = (filter: Filter): DailyRow[] =>
    DAILY.filter(
      (row) =>
        filter.companies.includes(row.account) &&
        !(filter.excludeTeam && row.teamMember) &&
        (filter.insights === null || (filter.insights.includes(row.account) && row.insightsActivities > 0) || filter.all.includes(row.account))
    );
  const people = (rows: DailyRow[]): number => new Set(rows.map((row) => row.person)).size;
  const monthlyRows = (filter: Filter): { MONTH_START_DATE: Date; UNIQUE_CONTRIBUTORS: number }[] => {
    if (!DAILY.some((row) => filter.companies.includes(row.account))) return [];
    const rows = counted(filter);
    return MONTHS.map((month, index) => ({ MONTH_START_DATE: month, UNIQUE_CONTRIBUTORS: people(rows.filter((row) => row.month === index)) }));
  };

  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    resolveOrgScope.mockReset();
    resolveOrgScope.mockImplementation(async (_snowflake: unknown, accountId: string) => (accountId === INSIGHTS_CO ? 'insights' : 'all'));
    execute.mockImplementation(async (sql: string, binds: string[]) => {
      const family = sql.includes('account_id IN (');
      const filter = family ? familyFilter(sql, binds) : singleFilter(sql, binds[0]);
      if (!isContributorsTrend(sql)) return { rows: [{ ACTIVE_CONTRIBUTORS: people(counted(filter)) }] };
      return { rows: monthlyRows(filter) };
    });
  });

  it('counts a person contributing through two companies in the same month once, where adding the companies counts them twice', async () => {
    const service = new OrgInvolvementService();
    const family = await service.getFamilyContributorsMonthly(ROLL_UP, [ALL_CO, INSIGHTS_CO]);
    const allCompany = await service.getContributorsMonthly(ALL_CO);
    const insightsCompany = await service.getContributorsMonthly(INSIGHTS_CO);

    expect(family).toEqual({
      accountId: ROLL_UP,
      totalActiveContributors: 3,
      monthlyData: [0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      monthlyLabels: LABELS,
    });
    expect(allCompany.monthlyData[2] + insightsCompany.monthlyData[2]).toBe(3);
    expect((allCompany.totalActiveContributors ?? 0) + (insightsCompany.totalActiveContributors ?? 0)).toBe(4);
  });

  it.each([
    ['insights', INSIGHTS_CO],
    ['all', INSIGHTS_CO],
    ['insights', ALL_CO],
    ['all', ALL_CO],
  ])('answers a one-company family exactly as that company under the %s scope (%s)', async (scope, company) => {
    resolveOrgScope.mockImplementation(async () => scope);
    const service = new OrgInvolvementService();

    const family = await service.getFamilyContributorsMonthly(ROLL_UP, [company]);
    const single = await service.getContributorsMonthly(company);

    expect({ ...family, accountId: company }).toEqual(single);
    expect(family.monthlyLabels).toEqual(LABELS);
  });

  it('leaves a company without code in the window out, so a family of one such company has an empty trend', async () => {
    const family = await new OrgInvolvementService().getFamilyContributorsMonthly(ROLL_UP, ['001000000000003AAA']);

    expect(family).toEqual({ accountId: ROLL_UP, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] });
  });
});

describe('OrgInvolvementService.getFamilyMaintainersMonthly', () => {
  const ROLL_UP = 'family-001000000000000AAA';
  const PARENT_CO = '001000000000001AAA';
  const CHILD_CO = '001000000000002AAA';

  const ROLES: { account: string; member: string; segment: string }[] = [
    { account: PARENT_CO, member: 'member-1', segment: 'segment-1' },
    { account: PARENT_CO, member: 'member-2', segment: 'segment-1' },
    { account: CHILD_CO, member: 'member-1', segment: 'segment-1' },
    { account: CHILD_CO, member: 'member-3', segment: 'segment-2' },
  ];
  const distinctRoles = (accounts: readonly unknown[]): number =>
    new Set(ROLES.filter((role) => accounts.includes(role.account)).map((role) => `${role.member}|${role.segment}`)).size;

  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    execute.mockImplementation(async (sql: string, binds: unknown[]) =>
      isRolesTrend(sql)
        ? {
            rows: [
              { METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: distinctRoles(binds) },
              { METRIC_MONTH: new Date(2030, 1, 15), ACTIVE_ROLES: null },
            ],
          }
        : { rows: [{ MAINTAINER_ROLES: distinctRoles(binds) }] }
    );
  });

  const headlineCall = (): unknown[] => execute.mock.calls.find(([query]) => !isRolesTrend(String(query)))!;
  const trendCall = (): unknown[] => execute.mock.calls.find(([query]) => isRolesTrend(String(query)))!;

  it('counts a role held on the same project through two companies of the family once', async () => {
    const response = await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(response).toEqual({ accountId: ROLL_UP, maintainerRoles: 3, monthlyData: [3, 0], monthlyLabels: ['Jan 2030', 'Feb 2030'] });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(withOrgCache.mock.calls.at(-1)?.[0]).toBe(ROLL_UP);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toMatch(/^maintainer-roles-family:v1:[0-9a-f]{16}$/);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(true);
  });

  it('reads the headline with the single-company rule over every company of the family, binding the companies then 730 days', async () => {
    await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    const [sql, binds, options] = headlineCall();
    expect(sql).toContain('SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES');
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES\n');
    expect(sql).toContain('WHERE ACCOUNT_ID IN (?, ?)');
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE() AND (ROLE_END_DATE IS NULL OR ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))');
    expect(sql).toContain('AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)');
    expect(sql).not.toContain('IS_LF_PROJECT');
    expect(binds).toEqual([PARENT_CO, CHILD_CO, 730]);
    expect(options).toMatchObject({ expectMissingObject: 'ORG_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
  });

  it('rebuilds the 12-month trend across the family from the roles table, never adding the per-company view', async () => {
    await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    const [sql, binds, options] = trendCall();
    expect(sql).toContain('FROM TABLE(GENERATOR(ROWCOUNT => 12))');
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES\n');
    expect(sql).not.toContain('ORG_MAINTAINER_ROLES_MONTHLY');
    expect(sql).toContain('WHERE ACCOUNT_ID IN (?, ?)');
    expect(sql).toContain('(TRUE AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)) AS IS_COUNTED');
    expect(sql).toContain('COUNT(DISTINCT IFF(r.IS_COUNTED, r.MEMBER_ID, NULL), r.SEGMENT_ID) AS ACTIVE_ROLES');
    expect(sql).toContain('ON r.ROLE_START_DATE <= LEAST(LAST_DAY(m.METRIC_MONTH), CURRENT_DATE())');
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM roles)');
    expect(binds).toEqual([PARENT_CO, CHILD_CO]);
    expect(options).toMatchObject({ expectMissingObject: 'ORG_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
  });

  it("answers a family of one with that company's own numbers", async () => {
    const family = await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [CHILD_CO]);

    expect(family.maintainerRoles).toBe(distinctRoles([CHILD_CO]));
    expect(family.monthlyData).toEqual([distinctRoles([CHILD_CO]), 0]);
    expect(headlineCall()[1]).toEqual([CHILD_CO, 730]);
    expect(trendCall()[1]).toEqual([CHILD_CO]);
  });

  it('reads each company once and keys the cache on the set, whatever order or repeats it arrives in', async () => {
    const service = new OrgInvolvementService();
    await service.getFamilyMaintainersMonthly(ROLL_UP, [CHILD_CO, PARENT_CO, CHILD_CO]);
    const firstKey = withOrgCache.mock.calls.at(-1)?.[1];
    expect(trendCall()[1]).toEqual([PARENT_CO, CHILD_CO]);
    await service.getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe(firstKey);

    await service.getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO]);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).not.toBe(firstKey);
  });

  it('answers zero roles without reading the warehouse for an empty set', async () => {
    const response = await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, []);

    expect(response).toEqual({ accountId: ROLL_UP, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] });
    expect(execute).not.toHaveBeenCalled();
    expect(withOrgCache).not.toHaveBeenCalled();
  });

  it('answers an empty trend when no company of the family holds a role in the window', async () => {
    execute.mockImplementation(async (sql: string) => (isRolesTrend(sql) ? { rows: [] } : { rows: [{ MAINTAINER_ROLES: 0 }] }));

    expect(await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO])).toEqual({
      accountId: ROLL_UP,
      maintainerRoles: 0,
      monthlyData: [],
      monthlyLabels: [],
    });
  });

  it('counts team members, and does not store the card, while the roles table has no team-member flag yet', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER')) throw invalidIdentifier('IS_CDP_TEAM_MEMBER');
      return isRolesTrend(sql) ? { rows: [{ METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 5 }] } : { rows: [{ MAINTAINER_ROLES: 6 }] };
    });

    const response = await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(response).toEqual({ accountId: ROLL_UP, maintainerRoles: 6, monthlyData: [5], monthlyLabels: ['Jan 2030'] });
    expect(execute.mock.calls.filter(([query]) => isRolesTrend(String(query))).at(-1)?.[0]).toContain('(TRUE ) AS IS_COUNTED');
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it('answers an unavailable headline and an empty trend, and does not store the card, while the roles table is missing', async () => {
    execute.mockRejectedValue(missing('ORG_MAINTAINER_ROLES'));

    const response = await new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(response).toEqual({ accountId: ROLL_UP, maintainerRoles: null, monthlyData: [], monthlyLabels: [] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it.each([
    ['headline', (sql: string) => !isRolesTrend(sql)],
    ['trend', isRolesTrend],
  ])('fails the card when the %s read fails', async (_name, failing) => {
    execute.mockImplementation(async (sql: string) => {
      if (failing(sql)) throw new Error('Warehouse timeout');
      return { rows: [] };
    });

    await expect(new OrgInvolvementService().getFamilyMaintainersMonthly(ROLL_UP, [PARENT_CO, CHILD_CO])).rejects.toThrow('Warehouse timeout');
  });
});

describe('OrgInvolvementService.getEventAttendanceMonthly (lfx-self-serve#4598)', () => {
  const monthlyRow = (month: Date): Record<string, unknown> => ({
    ACCOUNT_ID: 'acc-1',
    ACCOUNT_NAME: 'Account One',
    MONTH_START_DATE: month,
    ATTENDEES_ALL_ALL: 400,
    SPEAKERS_ALL: 100,
    TOTAL_ATTENDEES_ALL_ALL: 600,
    TOTAL_SPEAKERS_ALL: 200,
    ATTENDEES_ALL_VERIFIED: 80,
    SPEAKERS_VERIFIED: 15,
    TOTAL_ATTENDEES_ALL_VERIFIED: 120,
    TOTAL_SPEAKERS_VERIFIED: 25,
  });

  beforeEach(() => {
    execute.mockReset();
  });

  it('reads the Employee match, registered-or-attended columns: monthly distinct people as the sparkline, the distinct total as the headline', async () => {
    execute.mockResolvedValue({ rows: [monthlyRow(new Date(2030, 0, 15)), monthlyRow(new Date(2030, 1, 15))] });

    const response = await new OrgInvolvementService().getEventAttendanceMonthly('acc-1');

    expect(response).toEqual({
      accountId: 'acc-1',
      accountName: 'Account One',
      // The headline is the distinct total, not the sum of the two monthly points (80 + 80).
      totalAttended: 120,
      totalSpeakers: 25,
      attendeesMonthlyData: [80, 80],
      speakersMonthlyData: [15, 15],
      monthlyLabels: ['Jan 2030', 'Feb 2030'],
    });
  });

  it('selects only the default Employee match columns: no Self-reported only, All or coverage columns', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new OrgInvolvementService().getEventAttendanceMonthly('acc-1');

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).not.toMatch(/SELF_REPORTED|_ALL_ALL|SPEAKERS_ALL|COMPANY_EMAIL|_ACCOUNT\b|COVERAGE/);
  });

  it('selects the dbt columns and binds only the account', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new OrgInvolvementService().getEventAttendanceMonthly('acc-1');

    const [sql, binds] = execute.mock.calls[0] as [string, string[]];
    expect(sql).toContain('ORG_EVENT_PARTICIPATION_MONTHLY');
    expect(sql).toContain('ATTENDEES_ALL_VERIFIED');
    expect(sql).toContain('TOTAL_ATTENDEES_ALL_VERIFIED');
    expect(sql).toContain('TOTAL_SPEAKERS_VERIFIED');
    expect(sql).not.toMatch(/REGISTRATION_COUNT|TOTAL_REGISTRATIONS|TOTAL_ATTENDED/);
    expect(binds).toEqual(['acc-1']);
  });

  it('returns the zero response for an account with no rows', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new OrgInvolvementService().getEventAttendanceMonthly('acc-1')).toEqual({
      accountId: 'acc-1',
      accountName: '',
      totalAttended: 0,
      totalSpeakers: 0,
      attendeesMonthlyData: [],
      speakersMonthlyData: [],
      monthlyLabels: [],
    });
  });

  it('caches under the versioned key', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new OrgInvolvementService().getEventAttendanceMonthly('acc-1');

    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe('events:v5');
  });
});

describe('OrgInvolvementService.getFamilyEventAttendanceMonthly', () => {
  const ROLL_UP = 'family-001000000000000AAA';
  const PARENT_CO = '001000000000001AAA';
  const CHILD_CO = '001000000000002AAA';
  const JAN = new Date(2030, 0, 1);
  const FEB = new Date(2030, 1, 1);

  interface ParticipationRow {
    account: string;
    month: Date;
    crossRef: number;
    participantRef: number;
    personKey: string | null;
    attendee: boolean;
    speaker: boolean;
  }

  // One person on both rosters attends in January through both companies; one speaker without a roster link is credited
  // to both companies in February (different per-company numbers, one shared number); one attendee per company is their own.
  const PARTICIPATION: ParticipationRow[] = [
    { account: PARENT_CO, month: JAN, crossRef: 1001, participantRef: 11, personKey: 'lfid-shared', attendee: true, speaker: false },
    { account: CHILD_CO, month: JAN, crossRef: 1001, participantRef: 21, personKey: 'lfid-shared', attendee: true, speaker: false },
    { account: PARENT_CO, month: FEB, crossRef: 2002, participantRef: 12, personKey: null, attendee: false, speaker: true },
    { account: CHILD_CO, month: FEB, crossRef: 2002, participantRef: 22, personKey: null, attendee: false, speaker: true },
    { account: PARENT_CO, month: FEB, crossRef: 3003, participantRef: 13, personKey: 'lfid-parent', attendee: true, speaker: false },
    { account: CHILD_CO, month: JAN, crossRef: 4004, participantRef: 23, personKey: null, attendee: true, speaker: false },
  ];

  const usesCrossRef = (sql: string): boolean => sql.includes('CROSS_ACCOUNT_PARTICIPANT_REF');

  /** Answers the family read from the fixture: the companies bound, keyed the way the SQL keys a participant. */
  const answer = (sql: string, binds: unknown[]): { rows: Record<string, unknown>[] } => {
    const key = (row: ParticipationRow): string => (usesCrossRef(sql) ? String(row.crossRef) : (row.personKey ?? `${row.account}:${row.participantRef}`));
    const rows = PARTICIPATION.filter((row) => binds.includes(row.account));
    const distinct = (subset: ParticipationRow[], flag: 'attendee' | 'speaker'): number => new Set(subset.filter((row) => row[flag]).map(key)).size;
    const months = [...new Set(rows.map((row) => row.month.getTime()))].sort((a, b) => a - b);
    return {
      rows: months.map((time) => {
        const inMonth = rows.filter((row) => row.month.getTime() === time);
        return {
          MONTH_START_DATE: new Date(time),
          ATTENDEES: distinct(inMonth, 'attendee'),
          SPEAKERS: distinct(inMonth, 'speaker'),
          TOTAL_ATTENDEES: distinct(rows, 'attendee'),
          TOTAL_SPEAKERS: distinct(rows, 'speaker'),
        };
      }),
    };
  };

  beforeEach(() => {
    execute.mockReset();
    withOrgCache.mockClear();
    execute.mockImplementation(async (sql: string, binds: unknown[]) => answer(sql, binds));
  });

  it('counts a person credited to two companies of the family once, as an attendee and as a speaker', async () => {
    const response = await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(response).toEqual({
      accountId: ROLL_UP,
      accountName: '',
      totalAttended: 3,
      totalSpeakers: 1,
      attendeesMonthlyData: [2, 1],
      speakersMonthlyData: [0, 1],
      monthlyLabels: ['Jan 2030', 'Feb 2030'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(withOrgCache.mock.calls.at(-1)?.[0]).toBe(ROLL_UP);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).toMatch(/^events-family:v1:[0-9a-f]{16}$/);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(true);
  });

  it('reads the person-level table with the single-company rule over every company, binding the companies then 730 days', async () => {
    await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    const [sql, binds, options] = execute.mock.calls[0] as [string, unknown[], unknown];
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION\n');
    expect(sql).not.toContain('ORG_EVENT_PARTICIPATION_MONTHLY');
    expect(sql).toContain('CROSS_ACCOUNT_PARTICIPANT_REF AS PARTICIPANT');
    expect(sql).toContain('WHERE account_id IN (?, ?)');
    expect(sql).toContain('AND event_date < CURRENT_DATE()');
    expect(sql).toContain('AND event_date >= DATEADD(DAY, 0 - ?, CURRENT_DATE())');
    expect(sql).toContain('is_counted_all_verified AS IS_ATTENDEE');
    expect(sql).toContain('is_counted_speaker_verified AS IS_SPEAKER');
    expect(sql).toContain('(is_counted_registered_all OR is_counted_attended_all OR is_counted_speaker_all) AS IS_SHOWN');
    expect(sql).toContain('HAVING COUNT_IF(IS_SHOWN) > 0');
    expect(sql).not.toMatch(/SELF_REPORTED|_COMPANY_EMAIL|is_counted_all_all/);
    expect(binds).toEqual([PARENT_CO, CHILD_CO, 730]);
    expect(options).toEqual({ expectInvalidIdentifier: 'CROSS_ACCOUNT_PARTICIPANT_REF' });
  });

  it("answers a family of one with that company's own numbers", async () => {
    const family = await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [CHILD_CO]);

    expect(family).toMatchObject({ totalAttended: 2, totalSpeakers: 1, attendeesMonthlyData: [2, 0], speakersMonthlyData: [0, 1] });
    expect((execute.mock.calls[0] as [string, unknown[]])[1]).toEqual([CHILD_CO, 730]);
  });

  it('reads each company once and keys the cache on the set, whatever order or repeats it arrives in', async () => {
    const service = new OrgInvolvementService();
    await service.getFamilyEventAttendanceMonthly(ROLL_UP, [CHILD_CO, PARENT_CO, CHILD_CO]);
    const firstKey = withOrgCache.mock.calls.at(-1)?.[1];
    expect((execute.mock.calls[0] as [string, unknown[]])[1]).toEqual([PARENT_CO, CHILD_CO, 730]);
    await service.getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    expect(withOrgCache.mock.calls.at(-1)?.[1]).toBe(firstKey);

    await service.getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO]);
    expect(withOrgCache.mock.calls.at(-1)?.[1]).not.toBe(firstKey);
  });

  it('answers zero people without reading the warehouse for an empty set', async () => {
    const response = await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, []);

    expect(response).toEqual({
      accountId: ROLL_UP,
      accountName: '',
      totalAttended: 0,
      totalSpeakers: 0,
      attendeesMonthlyData: [],
      speakersMonthlyData: [],
      monthlyLabels: [],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(withOrgCache).not.toHaveBeenCalled();
  });

  it('answers zero people and no months when no company of the family took part in the window', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO])).toMatchObject({
      totalAttended: 0,
      totalSpeakers: 0,
      attendeesMonthlyData: [],
      speakersMonthlyData: [],
      monthlyLabels: [],
    });
  });

  it('counts by person_key, then each company number, and does not store the card, while the shared number is missing', async () => {
    execute.mockImplementation(async (sql: string, binds: unknown[]) => {
      if (usesCrossRef(sql)) throw invalidIdentifier('CROSS_ACCOUNT_PARTICIPANT_REF');
      return answer(sql, binds);
    });

    const response = await new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO]);

    // The person on both rosters still counts once; the speaker with no roster link counts once per company.
    expect(response).toMatchObject({ totalAttended: 3, totalSpeakers: 2, attendeesMonthlyData: [2, 1], speakersMonthlyData: [0, 2] });
    expect(execute).toHaveBeenCalledTimes(2);
    const [fallbackSql, fallbackBinds] = execute.mock.calls[1] as [string, unknown[]];
    expect(fallbackSql).toContain("COALESCE(person_key, account_id || ':' || participant_ref) AS PARTICIPANT");
    expect(fallbackBinds).toEqual([PARENT_CO, CHILD_CO, 730]);
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });

  it('fails the card on any other warehouse error, without a fallback read', async () => {
    execute.mockRejectedValue(new Error('Warehouse timeout'));

    await expect(new OrgInvolvementService().getFamilyEventAttendanceMonthly(ROLL_UP, [PARENT_CO, CHILD_CO])).rejects.toThrow('Warehouse timeout');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
