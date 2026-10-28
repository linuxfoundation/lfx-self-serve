// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./valkey.service', () => ({
  withOrgCache: vi.fn(async (_accountId: string, _key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));

const { OrgInvolvementService } = await import('./org-involvement.service');

describe('OrgInvolvementService.getMaintainersMonthly (lfx-self-serve#4482)', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) =>
      sql.includes('ORG_MAINTAINER_ROLES_MONTHLY')
        ? {
            rows: [
              { METRIC_MONTH: new Date(2030, 0, 15), ACTIVE_ROLES: 12 },
              { METRIC_MONTH: new Date(2030, 1, 15), ACTIVE_ROLES: null },
            ],
          }
        : { rows: [{ MAINTAINER_ROLES: 764 }] }
    );
  });

  it('counts LF roles overlapping the past 365 days as the headline and the roles held per month as the trend', async () => {
    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toEqual({ accountId: 'acc-1', maintainerRoles: 764, monthlyData: [12, 0], monthlyLabels: ['Jan 2030', 'Feb 2030'] });
  });

  it('reads the headline with the shared overlap rule over LF projects, binding the account then 365 days', async () => {
    await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    const [sql, binds] = execute.mock.calls.find(([query]) => String(query).includes('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES\n'))!;
    expect(sql).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID)');
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE() AND (ROLE_END_DATE IS NULL OR ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))');
    expect(sql).toContain('AND IS_LF_PROJECT = TRUE');
    expect(binds).toEqual(['acc-1', 365]);
  });

  it('answers zero roles and an empty trend for an account without any', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await new OrgInvolvementService().getMaintainersMonthly('acc-1')).toEqual({
      accountId: 'acc-1',
      maintainerRoles: 0,
      monthlyData: [],
      monthlyLabels: [],
    });
  });
});
