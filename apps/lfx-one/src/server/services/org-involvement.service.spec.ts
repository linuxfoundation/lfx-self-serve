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

    expect(response).toEqual({
      accountId: 'acc-1',
      maintainerRoles: 764,
      // The pre-#4482 field, carrying the same value for browsers still on the old client.
      totalMaintainersYearly: 764,
      monthlyData: [12, 0],
      monthlyLabels: ['Jan 2030', 'Feb 2030'],
    });
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
      totalMaintainersYearly: 0,
      monthlyData: [],
      monthlyLabels: [],
    });
  });

  it('degrades a missing monthly table to an empty trend, keeps the headline, and does not store the card', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES_MONTHLY')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_MONTHLY' does not exist or not authorized.");
      }
      return { rows: [{ MAINTAINER_ROLES: 764 }] };
    });

    const response = await new OrgInvolvementService().getMaintainersMonthly('acc-1');

    expect(response).toMatchObject({ maintainerRoles: 764, monthlyData: [], monthlyLabels: [] });
    expect(withOrgCache.mock.calls.at(-1)?.[5]?.(response)).toBe(false);
  });
});
