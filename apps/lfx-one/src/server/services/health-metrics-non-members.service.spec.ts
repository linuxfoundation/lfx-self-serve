// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = vi.fn(() => false);
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { HEALTH_METRICS_L2_RANGES, HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';

import { HealthMetricsNonMembersService, isSupportedNonMembersRange } from './health-metrics-non-members.service';

import type { Request } from 'express';

const req = {} as Request;

describe('isSupportedNonMembersRange', () => {
  it('accepts the periods the views carry and rejects anything else', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedNonMembersRange)).toBe(true);
    expect(isSupportedNonMembersRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedNonMembersRange('toString')).toBe(false);
  });
});

describe('HealthMetricsNonMembersService.getOrgs', () => {
  const query = { foundationSlug: 'acme', range: 'YTD' as const, filter: 'all' as const, search: '', offset: 0, pageSize: 10 };

  function orgRow(overrides: Record<string, unknown> = {}) {
    return {
      SCOPE_TOTAL: 1412,
      TOTAL_RECORDS: 1412,
      NEW_COUNT: 37,
      IS_PAGE_ROW: true,
      ACCOUNT_ID: '0014100000AcmeAAAA',
      ACCOUNT_NAME: 'Acme Motors',
      LAST_ENGAGED_DATE: new Date(Date.UTC(2026, 2, 14)),
      MEETINGS_ATTENDED_COUNT: 42,
      DISTINCT_PEOPLE_COUNT: 9,
      CONTRIBUTIONS_COUNT: 1840,
      IS_NEW: true,
      SORT_RANK: 1,
      IS_HIGH_FIT: false,
      ...overrides,
    };
  }

  function orgsRead(): [string, unknown[]] {
    return execute.mock.calls[0] as [string, unknown[]];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [orgRow()] });
  });

  it('reads the period columns for the range and binds only the foundation when unfiltered', async () => {
    for (const [range, suffix] of [
      ['YTD', 'ytd'],
      ['COMPLETED_YEAR', 'last_completed_year'],
      ['COMPLETED_YEAR_2', 'prev_completed_year'],
      ['COMPLETED_YEAR_3', '3rd_last_completed_year'],
    ] as const) {
      execute.mockClear();
      await new HealthMetricsNonMembersService().getOrgs(req, { ...query, range });

      const [sql, binds] = orgsRead();
      expect(binds).toEqual(['acme']);
      expect(sql.match(/\?/g)).toHaveLength(binds.length);
      expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_COMPANY_PARTICIPATION p');
      expect(sql).toContain('LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_FIT_SCORE f');
      for (const column of ['meetings_attended_count', 'distinct_people_count', 'contributions_count', 'is_new', 'sort_rank']) {
        expect(sql).toContain(`p.${column}_${suffix} AS ${column}`);
      }
      expect(sql).toContain(`COALESCE(f.is_high_fit_${suffix}, FALSE) AS is_high_fit`);
      expect(sql).not.toMatch(/FROM scoped WHERE/);
    }
  });

  it('filters to meeting attendees or high-fit organizations after the scope is counted', async () => {
    await new HealthMetricsNonMembersService().getOrgs(req, { ...query, filter: 'meetings' });
    expect(orgsRead()[0]).toContain('SELECT * FROM scoped WHERE meetings_attended_count > 0');

    execute.mockClear();
    await new HealthMetricsNonMembersService().getOrgs(req, { ...query, filter: 'high-fit' });
    expect(orgsRead()[0]).toContain('SELECT * FROM scoped WHERE is_high_fit');
  });

  it('binds an escaped search after the foundation', async () => {
    await new HealthMetricsNonMembersService().getOrgs(req, { ...query, filter: 'meetings', search: '50%_off!' });

    const [sql, binds] = orgsRead();
    expect(binds).toEqual(['acme', '%50!%!_off!!%']);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    expect(sql).toContain("WHERE meetings_attended_count > 0 AND account_name ILIKE ? ESCAPE '!'");
  });

  it("scopes to the period's active organizations and pages in the view's sort_rank order", async () => {
    await new HealthMetricsNonMembersService().getOrgs(req, query);

    const [sql] = orgsRead();
    const scoped = sql.slice(sql.indexOf('WITH scoped AS'), sql.indexOf('matched AS'));
    expect(scoped).toContain('AND p.account_id IS NOT NULL');
    expect(scoped).toContain("AND p.account_id <> ''");
    expect(scoped).toContain('AND (COALESCE(p.meetings_attended_count_ytd, 0) > 0 OR COALESCE(p.contributions_count_ytd, 0) > 0)');
    expect(sql).toContain('(SELECT COUNT(*) FROM scoped) AS scope_total');
    expect(sql).toContain('(SELECT COUNT_IF(is_new) FROM scoped) AS new_count');
    expect(sql).toContain('(SELECT COUNT(*) FROM matched) AS total_records');
    expect(sql).toContain('ORDER BY sort_rank ASC NULLS LAST, account_id ASC\n        LIMIT 10 OFFSET 0');
    expect(sql).toContain('ORDER BY page.sort_rank ASC NULLS LAST, page.account_id ASC');
    expect(sql).toContain('LEFT JOIN page ON TRUE');
  });

  it('clamps an oversized page and offset before interpolating them', async () => {
    await new HealthMetricsNonMembersService().getOrgs(req, { ...query, pageSize: 10_000, offset: Number.MAX_SAFE_INTEGER });

    const size = HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE;
    expect(orgsRead()[0]).toContain(`LIMIT ${size} OFFSET ${MAX_SNOWFLAKE_PAGINATION_PAGE * size}`);
  });

  it('maps an organization with an ISO date and keeps missing counts null', async () => {
    execute.mockResolvedValue({
      rows: [orgRow(), orgRow({ ACCOUNT_NAME: '', MEETINGS_ATTENDED_COUNT: null, DISTINCT_PEOPLE_COUNT: null, IS_NEW: null, LAST_ENGAGED_DATE: null })],
    });

    const response = await new HealthMetricsNonMembersService().getOrgs(req, query);

    expect(response).toEqual({
      totalRecords: 1412,
      scopeTotal: 1412,
      newCount: 37,
      rows: [
        {
          accountId: '0014100000AcmeAAAA',
          accountName: 'Acme Motors',
          lastEngagedDate: '2026-03-14',
          meetingsAttended: 42,
          distinctPeople: 9,
          contributions: 1840,
          isNew: true,
        },
        {
          accountId: '0014100000AcmeAAAA',
          accountName: '0014100000AcmeAAAA',
          lastEngagedDate: null,
          meetingsAttended: null,
          distinctPeople: null,
          contributions: 1840,
          isNew: false,
        },
      ],
    });
  });

  it('keeps the totals when the page is past the end', async () => {
    execute.mockResolvedValue({ rows: [{ SCOPE_TOTAL: 1412, TOTAL_RECORDS: 30, NEW_COUNT: 37, IS_PAGE_ROW: null, ACCOUNT_ID: null }] });

    const response = await new HealthMetricsNonMembersService().getOrgs(req, { ...query, offset: 500 });

    expect(response).toEqual({ rows: [], totalRecords: 30, scopeTotal: 1412, newCount: 37 });
  });
});
