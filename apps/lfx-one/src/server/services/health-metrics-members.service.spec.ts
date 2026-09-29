// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, warning } = vi.hoisted(() => ({ execute: vi.fn(), warning: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = vi.fn(() => false);
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { HEALTH_METRICS_L2_RANGES, HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP } from '@lfx-one/shared/constants';

import { HealthMetricsMembersService, isSupportedMembersRange } from './health-metrics-members.service';

import type { Request } from 'express';

const req = {} as Request;

function tierRow(overrides: Record<string, unknown> = {}) {
  return {
    YEAR: 2025,
    MEMBERSHIP_TIER: 'Gold',
    TIER_SORT_RANK: 2,
    MEMBER_COUNT: 12,
    NEW_MEMBER_COUNT: 3,
    TIER_REVENUE_USD: 600000,
    IS_PARTIAL_YEAR: false,
    ...overrides,
  };
}

const REVENUE_ROW = {
  FOUNDATION_TOTAL_REVENUE_USD_YTD: 4000000,
  FOUNDATION_TOTAL_REVENUE_USD_LAST_COMPLETED_YEAR: 3500000,
  FOUNDATION_TOTAL_REVENUE_USD_PREV_COMPLETED_YEAR: null,
  FOUNDATION_TOTAL_REVENUE_USD_3RD_LAST_COMPLETED_YEAR: 2000000,
};

/** The SQL and binds of the read against one view; the two reads run in parallel, so call order is not fixed. */
function readOf(view: string): [string, unknown[]] {
  const call = execute.mock.calls.find(([statement]) => String(statement).includes(view));
  if (!call) throw new Error(`No read against ${view}`);
  return call as [string, unknown[]];
}

/** Routes each read by its view, since the two run in parallel. */
function respond(tierRows: unknown[], revenueRows: unknown[]) {
  execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('MEMBERSHIP_TIER_YEAR') ? tierRows : revenueRows }));
}

describe('isSupportedMembersRange', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedMembersRange)).toBe(true);
    expect(isSupportedMembersRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedMembersRange('toString')).toBe(false);
  });
});

describe('HealthMetricsMembersService.getTiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respond([tierRow()], [REVENUE_ROW]);
  });

  it('reads every year of the tier view in matrix order, bound only to the foundation', async () => {
    await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    const [sql, binds] = readOf('MEMBERSHIP_TIER_YEAR');
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_TIER_YEAR');
    expect(sql).toContain('AND year IS NOT NULL');
    expect(sql).toContain('AND membership_tier IS NOT NULL');
    expect(sql).toContain('ORDER BY year DESC, tier_sort_rank ASC NULLS LAST, membership_tier ASC');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP + 1}`);
    expect(sql).not.toMatch(/WHERE[\s\S]*year\s*=/);
  });

  it('reads the foundation total off the Memberships revenue row for every period', async () => {
    await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    const [sql, binds] = readOf('HEALTH_OVERVIEW_REVENUE');
    expect(binds).toEqual(['acme']);
    expect(sql).toContain("LOWER(revenue_domain) = 'memberships'");
    for (const suffix of ['ytd', 'last_completed_year', 'prev_completed_year', '3rd_last_completed_year']) {
      expect(sql).toContain(`foundation_total_revenue_usd_${suffix}`);
    }
  });

  it('maps tier rows and leaves out a period with no foundation total', async () => {
    const response = await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    expect(response.rows).toEqual([{ year: 2025, tier: 'Gold', sortRank: 2, memberCount: 12, newMemberCount: 3, revenueUsd: 600000, isPartialYear: false }]);
    expect(response.foundationRevenue).toEqual([
      { range: 'COMPLETED_YEAR_3', totalUsd: 2000000 },
      { range: 'COMPLETED_YEAR', totalUsd: 3500000 },
      { range: 'YTD', totalUsd: 4000000 },
    ]);
  });

  it('keeps null counts null, sorts an unranked tier last and drops a row without a tier', async () => {
    respond([tierRow({ MEMBER_COUNT: null, TIER_SORT_RANK: null, IS_PARTIAL_YEAR: null }), tierRow({ MEMBERSHIP_TIER: null })], []);

    const response = await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    expect(response.rows).toEqual([expect.objectContaining({ memberCount: null, sortRank: Number.MAX_SAFE_INTEGER, isPartialYear: false })]);
    expect(response.foundationRevenue).toEqual([]);
  });

  it('warns and drops the year the cap cuts through, so no year shows part of its tiers', async () => {
    const newest = Array.from({ length: HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP - 2 }, (_, index) => tierRow({ YEAR: 2026, MEMBERSHIP_TIER: `Tier ${index}` }));
    respond(
      [...newest, tierRow({ YEAR: 2025, MEMBERSHIP_TIER: 'Gold' }), tierRow({ YEAR: 2025, MEMBERSHIP_TIER: 'Silver' }), tierRow({ YEAR: 2025 })],
      [REVENUE_ROW]
    );

    const response = await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP - 2);
    expect(response.rows.every((row) => row.year === 2026)).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_members_tiers',
      'Membership tier rows hit the read cap',
      expect.objectContaining({ foundation_slug: 'acme' })
    );
  });

  it('keeps the last capped year whole when the cap lands on a year boundary', async () => {
    const newest = Array.from({ length: HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP - 2 }, (_, index) => tierRow({ YEAR: 2026, MEMBERSHIP_TIER: `Tier ${index}` }));
    respond(
      [...newest, tierRow({ YEAR: 2025, MEMBERSHIP_TIER: 'Gold' }), tierRow({ YEAR: 2025, MEMBERSHIP_TIER: 'Silver' }), tierRow({ YEAR: 2024 })],
      [REVENUE_ROW]
    );

    const response = await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP);
    expect(response.rows.filter((row) => row.year === 2025)).toHaveLength(2);
  });

  it('keeps the capped rows when the cap cuts through the only year', async () => {
    respond(
      Array.from({ length: HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP + 1 }, (_, index) => tierRow({ MEMBERSHIP_TIER: `Tier ${index}` })),
      [REVENUE_ROW]
    );

    const response = await new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP);
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getTiers(req, { foundationSlug: 'acme' })).rejects.toBe(failure);
  });
});
