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
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_AT_RISK_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_OPTION_CAP,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

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

function bridgeRow(overrides: Record<string, unknown> = {}) {
  return {
    YEAR: 2025,
    MOVEMENT_TYPE: 'new',
    SORT_ORDER: 2,
    IS_PARTIAL_YEAR: false,
    MEMBER_COUNT: 7,
    SIGNED_MEMBER_COUNT: 7,
    REVENUE_IMPACT_USD: 140000,
    ...overrides,
  };
}

describe('HealthMetricsMembersService.getBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [bridgeRow()] });
  });

  it('reads every year of the waterfall in bar order, bound only to the foundation', async () => {
    await new HealthMetricsMembersService().getBridge(req, { foundationSlug: 'acme' });

    const [sql, binds] = readOf('MEMBERSHIP_WATERFALL');
    expect(binds).toEqual(['acme']);
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_WATERFALL');
    expect(sql).toContain('ORDER BY year DESC, sort_order ASC NULLS LAST, movement_type ASC');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP + 1}`);
  });

  it("maps steps with the model's own sign and keeps unmeasured counts null", async () => {
    execute.mockResolvedValue({
      rows: [
        bridgeRow({ MOVEMENT_TYPE: 'churned', SORT_ORDER: 5, SIGNED_MEMBER_COUNT: -2, MEMBER_COUNT: 2, REVENUE_IMPACT_USD: -50000 }),
        bridgeRow({ MOVEMENT_TYPE: 'today', SORT_ORDER: 6, MEMBER_COUNT: null, SIGNED_MEMBER_COUNT: null, REVENUE_IMPACT_USD: null, IS_PARTIAL_YEAR: null }),
      ],
    });

    const response = await new HealthMetricsMembersService().getBridge(req, { foundationSlug: 'acme' });

    expect(response.steps).toEqual([
      { year: 2025, movementType: 'churned', sortOrder: 5, isPartialYear: false, memberCount: 2, signedMemberCount: -2, revenueImpactUsd: -50000 },
      { year: 2025, movementType: 'today', sortOrder: 6, isPartialYear: false, memberCount: null, signedMemberCount: null, revenueImpactUsd: null },
    ]);
  });

  it('drops a row with no year or a movement type the bridge does not draw', async () => {
    execute.mockResolvedValue({ rows: [bridgeRow({ YEAR: null }), bridgeRow({ MOVEMENT_TYPE: 'reactivated' }), bridgeRow()] });

    const response = await new HealthMetricsMembersService().getBridge(req, { foundationSlug: 'acme' });

    expect(response.steps).toHaveLength(1);
  });

  it('warns and drops the year the cap cuts through', async () => {
    const newest = Array.from({ length: HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP - 1 }, () => bridgeRow({ YEAR: 2026 }));
    execute.mockResolvedValue({ rows: [...newest, bridgeRow(), bridgeRow()] });

    const response = await new HealthMetricsMembersService().getBridge(req, { foundationSlug: 'acme' });

    expect(response.steps).toHaveLength(HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP - 1);
    expect(response.steps.every((step) => step.year === 2026)).toBe(true);
    expect(warning).toHaveBeenCalledWith(req, 'get_members_bridge', 'Membership bridge rows hit the read cap', expect.objectContaining({ row_cap: 600 }));
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getBridge(req, { foundationSlug: 'acme' })).rejects.toBe(failure);
  });
});

function movementRow(overrides: Record<string, unknown> = {}) {
  return {
    TOTAL_RECORDS: 3,
    IS_PAGE_ROW: true,
    ACCOUNT_ID: '0014100000AcmeAAAA',
    ACCOUNT_NAME: 'Acme Motors',
    MEMBERSHIP_TIER: 'Gold',
    DUES_IMPACT_USD: 89000,
    MOVEMENT_DATE: new Date('2025-03-14T00:00:00Z'),
    LAST_ENGAGED_DATE: null,
    ...overrides,
  };
}

describe('HealthMetricsMembersService.getMovements', () => {
  const query = { foundationSlug: 'acme', year: 2025, movementType: 'upgrade' as const, offset: 25, pageSize: 25 };

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [movementRow()] });
  });

  it('binds foundation, year and movement in placeholder order and pages in sort-rank order', async () => {
    await new HealthMetricsMembersService().getMovements(req, query);

    const [sql, binds] = readOf('MEMBERSHIP_MOVEMENT_DETAIL');
    expect(binds).toEqual(['acme', 2025, 'upgrade']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain('ORDER BY sort_rank ASC NULLS LAST, account_id ASC NULLS LAST');
    expect(sql).toContain('LIMIT 25 OFFSET 25');
    expect(sql).toContain('LEFT JOIN page ON TRUE');
  });

  it('leaves rows without an account id out of both the total and the page window', async () => {
    await new HealthMetricsMembersService().getMovements(req, query);

    const [sql] = readOf('MEMBERSHIP_MOVEMENT_DETAIL');
    const scoped = sql.slice(sql.indexOf('WITH scoped AS'), sql.indexOf('totals AS'));
    expect(scoped).toContain('AND account_id IS NOT NULL');
    expect(scoped).toContain("AND account_id <> ''");
  });

  it('clamps an oversized page and offset before interpolating them', async () => {
    await new HealthMetricsMembersService().getMovements(req, { ...query, pageSize: 10_000, offset: Number.MAX_SAFE_INTEGER });

    const [sql] = readOf('MEMBERSHIP_MOVEMENT_DETAIL');
    const size = HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE;
    expect(sql).toContain(`LIMIT ${size} OFFSET ${MAX_SNOWFLAKE_PAGINATION_PAGE * size}`);
  });

  it('maps rows with ISO dates and falls back to the account id for a missing name', async () => {
    execute.mockResolvedValue({
      rows: [movementRow(), movementRow({ ACCOUNT_ID: '0014100000BetaAAAA', ACCOUNT_NAME: null, MEMBERSHIP_TIER: '', MOVEMENT_DATE: '2025-06-01' })],
    });

    const response = await new HealthMetricsMembersService().getMovements(req, query);

    expect(response).toEqual({
      totalRecords: 3,
      rows: [
        {
          accountId: '0014100000AcmeAAAA',
          accountName: 'Acme Motors',
          membershipTier: 'Gold',
          duesImpactUsd: 89000,
          movementDate: '2025-03-14',
          lastEngagedDate: null,
        },
        {
          accountId: '0014100000BetaAAAA',
          accountName: '0014100000BetaAAAA',
          membershipTier: null,
          duesImpactUsd: 89000,
          movementDate: '2025-06-01',
          lastEngagedDate: null,
        },
      ],
    });
  });

  it('falls back to the account id for a blank name', async () => {
    execute.mockResolvedValue({ rows: [movementRow({ ACCOUNT_NAME: '' })] });

    const response = await new HealthMetricsMembersService().getMovements(req, query);

    expect(response.rows[0].accountName).toBe('0014100000AcmeAAAA');
  });

  it('keeps the total when the page is past the end', async () => {
    execute.mockResolvedValue({ rows: [{ TOTAL_RECORDS: 3, IS_PAGE_ROW: null, ACCOUNT_ID: null }] });

    const response = await new HealthMetricsMembersService().getMovements(req, query);

    expect(response).toEqual({ rows: [], totalRecords: 3 });
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getMovements(req, query)).rejects.toBe(failure);
  });
});

describe('HealthMetricsMembersService.getDirectory', () => {
  const query = { foundationSlug: 'acme', range: 'YTD' as const, tier: '', nps: '' as const, search: '', offset: 0, pageSize: 10 };

  function directoryRow(overrides: Record<string, unknown> = {}) {
    return {
      SCOPE_TOTAL: 725,
      TOTAL_RECORDS: 16,
      AT_RISK_COUNT: 27,
      IS_PAGE_ROW: true,
      ACCOUNT_ID: '0014100000AcmeAAAA',
      ACCOUNT_NAME: 'Acme Motors',
      MEMBERSHIP_TIER: 'Gold Membership',
      ANNUAL_DUES_USD: 89500,
      ENGAGEMENT_LEVEL: 'Low',
      ENGAGEMENT_SCORE: 2.26,
      NPS_CATEGORY: 'Detractor',
      IS_AT_RISK: true,
      RENEWAL_DATE: new Date(Date.UTC(2027, 0, 11)),
      RENEWAL_DUES_USD: null,
      LAST_ENGAGED_DATE: '2026-02-03',
      CONTRIBUTION_COUNT: 12,
      SPONSORSHIP_USD: 1250.5,
      TRAINING_ENROLLMENT_COUNT: 0,
      EVENT_REGISTRATION_COUNT: null,
      ...overrides,
    };
  }

  function directoryRead(): [string, unknown[]] {
    return execute.mock.calls[0] as [string, unknown[]];
  }

  function respondDirectory(rows: unknown[]) {
    execute.mockResolvedValue({ rows });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    respondDirectory([directoryRow()]);
  });

  it('reads the period columns for the range and binds only the foundation when unfiltered', async () => {
    for (const [range, suffix] of [
      ['YTD', 'ytd'],
      ['COMPLETED_YEAR', 'last_completed_year'],
      ['COMPLETED_YEAR_2', 'prev_completed_year'],
      ['COMPLETED_YEAR_3', '3rd_last_completed_year'],
    ] as const) {
      execute.mockClear();
      await new HealthMetricsMembersService().getDirectory(req, { ...query, range });

      const [sql, binds] = directoryRead();
      expect(binds).toEqual(['acme']);
      expect(sql.match(/\?/g)).toHaveLength(binds.length);
      expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_DIRECTORY');
      for (const column of ['contribution_count', 'sponsorship_usd', 'training_enrollment_count', 'event_registration_count']) {
        expect(sql).toContain(`${column}_${suffix} AS ${column}`);
      }
      expect(sql).not.toMatch(/FROM scoped WHERE/);
    }
  });

  it('binds tier, NPS and an escaped search in placeholder order', async () => {
    await new HealthMetricsMembersService().getDirectory(req, { ...query, tier: 'Gold Membership', nps: 'Promoter', search: '50%_off!' });

    const [sql, binds] = directoryRead();
    expect(binds).toEqual(['acme', 'Gold Membership', 'Promoter', '%50!%!_off!!%']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain("WHERE TRIM(membership_tier) = ? AND nps_category = ? AND account_name ILIKE ? ESCAPE '!'");
  });

  it("counts the foundation and its at-risk members before the filters, and pages in the view's sort_rank order", async () => {
    await new HealthMetricsMembersService().getDirectory(req, query);

    const [sql] = directoryRead();
    const scoped = sql.slice(sql.indexOf('WITH scoped AS'), sql.indexOf('matched AS'));
    expect(scoped).toContain('AND account_id IS NOT NULL');
    expect(scoped).toContain("AND account_id <> ''");
    expect(sql).toContain('(SELECT COUNT(*) FROM scoped) AS scope_total');
    expect(sql).toContain('(SELECT COUNT_IF(is_at_risk) FROM scoped) AS at_risk_count');
    expect(sql).toContain('(SELECT COUNT(*) FROM matched) AS total_records');
    expect(scoped).toContain('sort_rank,');
    expect(sql).toContain('ORDER BY sort_rank ASC NULLS LAST, account_id ASC\n        LIMIT');
    expect(sql).toContain('ORDER BY page.sort_rank ASC NULLS LAST, page.account_id ASC');
    expect(sql).toContain('LIMIT 10 OFFSET 0');
    expect(sql).toContain('LEFT JOIN page ON TRUE');
  });

  it('clamps an oversized page and offset before interpolating them', async () => {
    await new HealthMetricsMembersService().getDirectory(req, { ...query, pageSize: 10_000, offset: Number.MAX_SAFE_INTEGER });

    const [sql] = directoryRead();
    const size = HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_PAGE_SIZE;
    expect(sql).toContain(`LIMIT ${size} OFFSET ${MAX_SNOWFLAKE_PAGINATION_PAGE * size}`);
  });

  it('maps a member with ISO dates, and keeps untracked values null', async () => {
    const response = await new HealthMetricsMembersService().getDirectory(req, query);

    expect(response).toEqual({
      totalRecords: 16,
      scopeTotal: 725,
      atRiskCount: 27,
      rows: [
        {
          accountId: '0014100000AcmeAAAA',
          accountName: 'Acme Motors',
          membershipTier: 'Gold Membership',
          annualDuesUsd: 89500,
          engagementLevel: 'Low',
          engagementScore: 2.26,
          npsCategory: 'Detractor',
          isAtRisk: true,
          renewalDate: '2027-01-11',
          renewalDuesUsd: null,
          lastEngagedDate: '2026-02-03',
          contributionCount: 12,
          sponsorshipUsd: 1250.5,
          trainingEnrollmentCount: 0,
          eventRegistrationCount: null,
        },
      ],
    });
  });

  it('drops an unknown engagement band or NPS category, and a blank tier or name', async () => {
    respondDirectory([directoryRow({ ENGAGEMENT_LEVEL: 'Extreme', NPS_CATEGORY: 'Neutral', MEMBERSHIP_TIER: '', ACCOUNT_NAME: '', IS_AT_RISK: null })]);

    const response = await new HealthMetricsMembersService().getDirectory(req, query);

    expect(response.rows[0]).toMatchObject({
      accountName: '0014100000AcmeAAAA',
      membershipTier: null,
      engagementLevel: null,
      npsCategory: null,
      isAtRisk: false,
    });
  });

  it('keeps the totals when the page is past the end', async () => {
    respondDirectory([{ SCOPE_TOTAL: 725, TOTAL_RECORDS: 16, AT_RISK_COUNT: 27, IS_PAGE_ROW: null, ACCOUNT_ID: null }]);

    const response = await new HealthMetricsMembersService().getDirectory(req, query);

    expect(response).toMatchObject({ rows: [], totalRecords: 16, scopeTotal: 725, atRiskCount: 27 });
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getDirectory(req, query)).rejects.toBe(failure);
  });
});

describe('HealthMetricsMembersService.getDirectoryTiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [{ MEMBERSHIP_TIER: null }, { MEMBERSHIP_TIER: 'Gold Membership' }, { MEMBERSHIP_TIER: 'Silver Membership' }] });
  });

  it('reads the trimmed tiers highest-paying first, bound only to the foundation', async () => {
    const response = await new HealthMetricsMembersService().getDirectoryTiers(req, { foundationSlug: 'acme' });

    const [sql, binds] = execute.mock.calls[0] as [string, unknown[]];
    expect(binds).toEqual(['acme']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain("SELECT NULLIF(TRIM(membership_tier), '') AS membership_tier");
    expect(sql).toContain("AND NULLIF(TRIM(membership_tier), '') IS NOT NULL");
    expect(sql).toContain("GROUP BY NULLIF(TRIM(membership_tier), '')");
    expect(sql).toContain('ORDER BY MAX(annual_dues_usd) DESC NULLS LAST, membership_tier ASC');
    expect(sql).toContain(`LIMIT ${HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_OPTION_CAP}`);
    expect(response).toEqual({ tiers: ['Gold Membership', 'Silver Membership'] });
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getDirectoryTiers(req, { foundationSlug: 'acme' })).rejects.toBe(failure);
  });
});

describe('HealthMetricsMembersService.getAtRisk', () => {
  const query = { foundationSlug: 'acme', bucket: 'all' as const, offset: 0, pageSize: 10 };
  const totals = {
    TOTAL_RECORDS: 3,
    SCOPED_RECORDS: 3,
    FOUNDATION_HIGH_RISK_BALANCE_USD: 90000,
    FOUNDATION_MEDIUM_RISK_BALANCE_USD: 30000,
    FOUNDATION_60_89_DAYS_MEMBERS_COUNT: 2,
    FOUNDATION_60_89_DAYS_OUTSTANDING_BALANCE_USD: 50000,
    FOUNDATION_90_PLUS_DAYS_MEMBERS_COUNT: 1,
    FOUNDATION_90_PLUS_DAYS_OUTSTANDING_BALANCE_USD: 70000,
  };

  function atRiskRow(overrides: Record<string, unknown> = {}) {
    return {
      ...totals,
      IS_PAGE_ROW: true,
      ACCOUNT_ID: '0014100000AcmeRsk1',
      ACCOUNT_NAME: 'Acme Robotics',
      MEMBERSHIP_TIER: 'Gold Membership',
      OUTSTANDING_BALANCE_USD: 70000,
      DAYS_OVERDUE: 104,
      LAST_ENGAGED_DATE: new Date(Date.UTC(2026, 2, 4)),
      SORT_RANK: 1,
      ...overrides,
    };
  }

  function atRiskRead(): [string, unknown[]] {
    return execute.mock.calls[0] as [string, unknown[]];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [atRiskRow()] });
  });

  it('scopes to balances 60+ days overdue and binds no bucket filter for all', async () => {
    await new HealthMetricsMembersService().getAtRisk(req, query);

    const [sql, binds] = atRiskRead();
    expect(binds).toEqual(['acme', '60_89_days', '90_plus_days']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_AT_RISK');
    const scoped = sql.slice(sql.indexOf('WITH scoped AS'), sql.indexOf('matched AS'));
    expect(scoped).toContain("AND account_id <> ''");
    expect(scoped).toContain('AND aging_bucket IN (?, ?)');
    expect(sql).not.toMatch(/FROM scoped WHERE/);
  });

  it("filters the page and its count to one bucket, but reads the hero and aging from the model's totals", async () => {
    await new HealthMetricsMembersService().getAtRisk(req, { ...query, bucket: '90_plus_days' });

    const [sql, binds] = atRiskRead();
    expect(binds).toEqual(['acme', '60_89_days', '90_plus_days', '90_plus_days']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain('SELECT * FROM scoped WHERE aging_bucket = ?');
    expect(sql).toContain('(SELECT COUNT(*) FROM matched) AS total_records');
    const totalsCte = sql.slice(sql.indexOf('totals AS'), sql.indexOf('page AS'));
    expect(totalsCte).toContain('ANY_VALUE(foundation_high_risk_balance_usd) AS foundation_high_risk_balance_usd');
    expect(totalsCte).toContain('ANY_VALUE(foundation_60_89_days_members_count) AS foundation_60_89_days_members_count');
    expect(totalsCte).toContain('ANY_VALUE(foundation_90_plus_days_outstanding_balance_usd) AS foundation_90_plus_days_outstanding_balance_usd');
    expect(totalsCte).toContain('COUNT(*) AS scoped_records');
    expect(totalsCte).toContain('FROM scoped');
    expect(totalsCte).not.toMatch(/SUM\(|COUNT_IF\(/);
  });

  it("pages in the view's sort_rank order and clamps an oversized page and offset", async () => {
    await new HealthMetricsMembersService().getAtRisk(req, { ...query, pageSize: 10_000, offset: Number.MAX_SAFE_INTEGER });

    const [sql] = atRiskRead();
    const size = HEALTH_METRICS_MEMBERS_AT_RISK_MAX_PAGE_SIZE;
    expect(sql).toContain(`ORDER BY sort_rank ASC NULLS LAST, account_id ASC\n        LIMIT ${size} OFFSET ${MAX_SNOWFLAKE_PAGINATION_PAGE * size}`);
    expect(sql).toContain('LEFT JOIN page ON TRUE');
  });

  it('maps the totals, adding the hero up from the buckets shown, and a member with an ISO date', async () => {
    const response = await new HealthMetricsMembersService().getAtRisk(req, query);

    expect(response).toEqual({
      totalRecords: 3,
      summary: { outstandingBalanceUsd: 120000, highRiskBalanceUsd: 90000, mediumRiskBalanceUsd: 30000, memberCount: 3 },
      aging: [
        { bucket: '60_89_days', memberCount: 2, balanceUsd: 50000 },
        { bucket: '90_plus_days', memberCount: 1, balanceUsd: 70000 },
      ],
      rows: [
        {
          accountId: '0014100000AcmeRsk1',
          accountName: 'Acme Robotics',
          membershipTier: 'Gold Membership',
          outstandingBalanceUsd: 70000,
          daysOverdue: 104,
          lastEngagedDate: '2026-03-04',
        },
      ],
    });
  });

  it('keeps the totals when the page is past the end, and a blank name falls back to the id', async () => {
    execute.mockResolvedValue({ rows: [{ ...totals, IS_PAGE_ROW: null, ACCOUNT_ID: null }] });
    expect(await new HealthMetricsMembersService().getAtRisk(req, query)).toMatchObject({ rows: [], totalRecords: 3 });

    execute.mockResolvedValue({ rows: [atRiskRow({ ACCOUNT_NAME: '', MEMBERSHIP_TIER: '', LAST_ENGAGED_DATE: null })] });
    expect((await new HealthMetricsMembersService().getAtRisk(req, query)).rows[0]).toMatchObject({
      accountName: '0014100000AcmeRsk1',
      membershipTier: null,
      lastEngagedDate: null,
    });
  });

  it('reads measured zeros when the foundation has no member at risk', async () => {
    const empty = { TOTAL_RECORDS: 0, SCOPED_RECORDS: 0, IS_PAGE_ROW: null, ACCOUNT_ID: null };
    for (const rows of [[], [empty]]) {
      execute.mockResolvedValue({ rows });

      expect(await new HealthMetricsMembersService().getAtRisk(req, query)).toMatchObject({
        rows: [],
        totalRecords: 0,
        summary: { outstandingBalanceUsd: 0, highRiskBalanceUsd: 0, mediumRiskBalanceUsd: 0, memberCount: 0 },
        aging: [
          { bucket: '60_89_days', memberCount: 0, balanceUsd: 0 },
          { bucket: '90_plus_days', memberCount: 0, balanceUsd: 0 },
        ],
      });
    }
  });

  // An unset model total is not a zero: the hero sum and the bar it feeds stay unset.
  it('keeps an unset model total null for a foundation with members at risk', async () => {
    execute.mockResolvedValue({ rows: [atRiskRow({ FOUNDATION_90_PLUS_DAYS_OUTSTANDING_BALANCE_USD: null, FOUNDATION_HIGH_RISK_BALANCE_USD: null })] });

    expect(await new HealthMetricsMembersService().getAtRisk(req, query)).toMatchObject({
      summary: { outstandingBalanceUsd: null, highRiskBalanceUsd: null, mediumRiskBalanceUsd: 30000, memberCount: 3 },
      aging: [
        { bucket: '60_89_days', memberCount: 2, balanceUsd: 50000 },
        { bucket: '90_plus_days', memberCount: 1, balanceUsd: null },
      ],
    });
  });

  it('rethrows a failed read', async () => {
    const failure = new Error('warehouse down');
    execute.mockRejectedValue(failure);

    await expect(new HealthMetricsMembersService().getAtRisk(req, query)).rejects.toBe(failure);
  });
});
