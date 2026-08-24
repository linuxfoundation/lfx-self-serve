// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute };
    }
    public static isMissingObjectError() {
      return false;
    }
  },
}));
vi.mock('./valkey.service', () => ({
  buildOrgCacheKey: () => null,
  valkeyService: { getJson: vi.fn(), setJson: vi.fn() },
}));
vi.mock('@lfx-one/shared/utils', () => ({
  buildInsightsUrl: () => '',
  classifyHealthScore: () => 'unavailable',
}));

import { OrgLensProjectDetailService } from './org-lens-project-detail.service';

const ORG = '0014100000Te2QjAAJ';
const SLUG = 'k8s';

const heroRow = {
  PROJECT_NAME: 'Kubernetes',
  PROJECT_SLUG: SLUG,
  PROJECT_LOGO_URL: null,
  FOUNDATION_NAME: 'CNCF',
  IS_LF_PROJECT: true,
  DESCRIPTION: null,
  HEALTH_OVERALL_SCORE: 80,
  SOFTWARE_VALUE: null,
  FIRST_COMMIT_TS: null,
};

function trendCall(): { sql: string; binds: unknown[] } {
  const call = execute.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('ROW_NUMBER()') && sql.includes('SPAN_MONTH'));
  expect(call).toBeDefined();
  return { sql: call![0] as string, binds: call![1] as unknown[] };
}

function lifetimeCall(): { sql: string; binds: unknown[] } {
  const call = execute.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('ROW_NUMBER()') && sql.includes('BUCKET_INDEX'));
  expect(call).toBeDefined();
  return { sql: call![0] as string, binds: call![1] as unknown[] };
}

function placeholderCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

describe('OrgLensProjectDetailService.getTrendBlock', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
  });

  it('filters 1y to the trailing 12 months and folds top-10 + All others in SQL', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return { rows: [] };
    });

    await service.getTrendBlock(ORG, SLUG, '1y');

    const { sql, binds } = trendCall();
    expect(sql).toContain("DATEADD('month', 1 - ?, MAX(SPAN_MONTH) OVER ())");
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).toContain('GROUP BY ACCOUNT_ID');
    expect(sql).toContain('MAX_BY(COMBINED_INFLUENCE_SCORE, SPAN_MONTH)');
    expect(sql).toContain("COALESCE(MAX(ORG_NAME), '') ASC");
    expect(sql).toContain('UNION ALL');
    expect(placeholderCount(sql)).toBe(binds.length);
    expect(binds).toEqual([SLUG, 12, 10, 'All others', 10]);
  });

  it('filters 2y to the trailing 24 months with the same fold', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return { rows: [] };
    });

    await service.getTrendBlock(ORG, SLUG, '2y');

    const { binds } = trendCall();
    expect(binds).toEqual([SLUG, 24, 10, 'All others', 10]);
  });

  it('folds the lifetime path without a month window', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      if (sql.includes('BUCKET_GRANULARITY')) {
        return {
          rows: [
            { BUCKET_INDEX: 0, BUCKET_GRANULARITY: 'yearly', BUCKET_START: '2016-01-01', BUCKET_END: '2016-12-31' },
            { BUCKET_INDEX: 1, BUCKET_GRANULARITY: 'yearly', BUCKET_START: '2017-01-01', BUCKET_END: '2017-12-31' },
          ],
        };
      }
      return { rows: [] };
    });

    await service.getTrendBlock(ORG, SLUG, 'all');

    const { sql, binds } = lifetimeCall();
    expect(sql).not.toContain('DATEADD');
    expect(sql).toContain('ORG_LENS_PROJECT_DETAIL_TREND_LIFETIME');
    expect(sql).toContain('ROW_NUMBER()');
    expect(placeholderCount(sql)).toBe(binds.length);
    expect(binds).toEqual([SLUG, 10, 'All others', 10]);
  });

  it('maps already-folded rows without re-folding All others into the named set', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return {
        rows: [
          { ACCOUNT_ID: 'org-b', ORG_NAME: 'Beta', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 1 },
          { ACCOUNT_ID: 'org-b', ORG_NAME: 'Beta', ORG_LOGO_URL: '', SPAN_MONTH: '2025-02-01', COMBINED_INFLUENCE_SCORE: 20 },
          { ACCOUNT_ID: 'org-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 2 },
          { ACCOUNT_ID: 'org-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-02-01', COMBINED_INFLUENCE_SCORE: 10 },
          { ACCOUNT_ID: '', ORG_NAME: 'All others', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 30 },
          { ACCOUNT_ID: '', ORG_NAME: 'All others', ORG_LOGO_URL: '', SPAN_MONTH: '2025-02-01', COMBINED_INFLUENCE_SCORE: 5 },
        ],
      };
    });

    const block = await service.getTrendBlock(ORG, SLUG, '1y');

    expect(block?.trend.map((series) => series.orgName)).toEqual(['Beta', 'Alpha', 'All others']);
    expect(block?.trend[0]?.combined).toEqual([1, 20]);
    expect(block?.trend[1]?.combined).toEqual([2, 10]);
    expect(block?.trend[2]?.combined).toEqual([30, 5]);
    expect(block?.trend[2]?.accountId).toBe('');
  });

  it('breaks latest-score ties by organization name then account id', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return {
        rows: [
          { ACCOUNT_ID: 'acct-z', ORG_NAME: 'Zebra', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 4 },
          { ACCOUNT_ID: 'acct-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 4 },
        ],
      };
    });

    const block = await service.getTrendBlock(ORG, SLUG, '1y');

    expect(block?.trend.map((series) => series.orgName)).toEqual(['Alpha', 'Zebra']);
  });

  it('returns null when the viewing org has no catalog row for the project', async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(service.getTrendBlock(ORG, SLUG, '1y')).resolves.toBeNull();
  });
});
