// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS,
} from '@lfx-one/shared/constants';
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
// See org-lens-projects.service.spec.ts for why this delegates to the real classification utils instead of stubbing.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/insights.utils');
  return {
    buildInsightsUrl: () => '',
    classifyHealthScore: actual.classifyHealthScore,
    normalizeHealthScoreCategoryV2: actual.normalizeHealthScoreCategoryV2,
  };
});

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
    expect(sql).toContain('ACCOUNT_ID IS NOT NULL');
    expect(sql).toContain("ACCOUNT_ID <> ''");
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).toContain('GROUP BY ACCOUNT_ID');
    expect(sql).toContain('MAX_BY(COMBINED_INFLUENCE_SCORE, SPAN_MONTH)');
    expect(sql).toContain("COALESCE(MAX(ORG_NAME), '') ASC");
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('ORDER BY ACCOUNT_ID, SPAN_MONTH ASC');
    expect(sql).not.toContain('IFF(');
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
    expect(sql).toContain('ACCOUNT_ID IS NOT NULL');
    expect(sql).toContain("ACCOUNT_ID <> ''");
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).toContain('ORDER BY ACCOUNT_ID, BUCKET_INDEX ASC');
    expect(sql).not.toContain('IFF(');
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

  it('zero-fills a missing month on the shared axis instead of shifting later points', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return {
        rows: [
          { ACCOUNT_ID: 'org-b', ORG_NAME: 'Beta', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 1 },
          { ACCOUNT_ID: 'org-b', ORG_NAME: 'Beta', ORG_LOGO_URL: '', SPAN_MONTH: '2025-02-01', COMBINED_INFLUENCE_SCORE: 20 },
          { ACCOUNT_ID: 'org-b', ORG_NAME: 'Beta', ORG_LOGO_URL: '', SPAN_MONTH: '2025-03-01', COMBINED_INFLUENCE_SCORE: 8 },
          { ACCOUNT_ID: 'org-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 2 },
          { ACCOUNT_ID: 'org-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-03-01', COMBINED_INFLUENCE_SCORE: 9 },
        ],
      };
    });

    const block = await service.getTrendBlock(ORG, SLUG, '1y');

    expect(block?.trend[0]?.orgName).toBe('Alpha');
    expect(block?.trend[0]?.combined).toEqual([2, 0, 9]);
    expect(block?.trend[1]?.orgName).toBe('Beta');
    expect(block?.trend[1]?.combined).toEqual([1, 20, 8]);
  });

  it('treats the empty account-id sentinel as All others regardless of org name', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return {
        rows: [
          { ACCOUNT_ID: 'org-a', ORG_NAME: 'Alpha', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 4 },
          { ACCOUNT_ID: '', ORG_NAME: 'the rest', ORG_LOGO_URL: '', SPAN_MONTH: '2025-01-01', COMBINED_INFLUENCE_SCORE: 7 },
        ],
      };
    });

    const block = await service.getTrendBlock(ORG, SLUG, '1y');

    expect(block?.trend.map((series) => series.accountId)).toEqual(['org-a', '']);
    expect(block?.trend[1]?.orgName).toBe('All others');
    expect(block?.trend[1]?.combined).toEqual([7]);
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

describe('OrgLensProjectDetailService.getHeroBlock health mapping', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
  });

  function mockHeroRow(overrides: Record<string, unknown>): void {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [{ ...heroRow, ...overrides }] };
      return { rows: [] };
    });
  }

  it('falls back to the raw v2 score when the v2 category is unrecognized', async () => {
    mockHeroRow({ HEALTH_OVERALL_SCORE_V2: 50, HEALTH_SCORE_CATEGORY_V2: 'Typo' });

    const block = await service.getHeroBlock(ORG, SLUG);

    expect(block?.hero.health).toBe('fair');
  });

  it('returns null health when no v2 score or category is present', async () => {
    mockHeroRow({ HEALTH_OVERALL_SCORE_V2: null, HEALTH_SCORE_CATEGORY_V2: null });

    const block = await service.getHeroBlock(ORG, SLUG);

    expect(block?.hero.health).toBeNull();
  });
});

describe('OrgLensProjectDetailService.getLeaderboardBreakdown', () => {
  const service = new OrgLensProjectDetailService();
  const SUBJECT = 'crowd-org-1';

  const breakdownRow = {
    ACCOUNT_ID: ORG,
    ORGANIZATION_NAME: 'Red Hat',
    TECHNICAL_INFLUENCE_SCORE: 42,
    TECHNICAL_INFLUENCE_LEVEL: 'Leading',
    ECOSYSTEM_INFLUENCE_SCORE: 17,
    ECOSYSTEM_INFLUENCE_LEVEL: 'Participating',
  };

  // Every warehouse column the service's category map reads, spelled out here independently of that
  // map. A column named on only one side resolves to no column on the other and surfaces as a zeroed
  // figure rather than an error, so the assertions below check the mapped values, not just the keys.
  // Per-category points are chosen so they sum exactly to each dimension's score at two decimals but
  // NOT at one, which is what pins the drawer's total to its own column of points.
  const populatedBreakdownRow = {
    ACCOUNT_ID: ORG,
    ORGANIZATION_NAME: 'Red Hat',
    TECHNICAL_INFLUENCE_SCORE: 42.5,
    TECHNICAL_INFLUENCE_LEVEL: 'Leading',
    ECOSYSTEM_INFLUENCE_SCORE: 6.25,
    ECOSYSTEM_INFLUENCE_LEVEL: 'Participating',

    MAINTAINERS_POINTS: 3.5,
    MAINTAINERS_COUNT: 2,
    MAINTAINERS_PROJECT_TOTAL: 20,
    CONTRIBUTORS_POINTS: 7.25,
    CONTRIBUTORS_COUNT: 3,
    CONTRIBUTORS_PROJECT_TOTAL: 30,
    COMMITS_POINTS: 12.5,
    COMMITS_COUNT: 4,
    COMMITS_PROJECT_TOTAL: 40,
    PRS_OPENED_POINTS: 19.25,
    PRS_OPENED_COUNT: 5,
    PRS_OPENED_PROJECT_TOTAL: 50,

    COLLABORATION_ACTIVITY_POINTS: 0.33,
    COLLABORATION_ACTIVITY_COUNT: 6,
    COLLABORATION_ACTIVITY_PROJECT_TOTAL: 60,
    COLLABORATION_ACTIVITY_ALL_TIME_TOTAL: 600,
    MEETING_ATTENDANCE_POINTS: 1.1,
    MEETING_ATTENDANCE_COUNT: 7,
    MEETING_ATTENDANCE_PROJECT_TOTAL: 70,
    MEETING_ATTENDANCE_ALL_TIME_TOTAL: 700,
    EVENT_ATTENDANCE_POINTS: 0.66,
    EVENT_ATTENDANCE_COUNT: 8,
    EVENT_ATTENDANCE_FOUNDATION_TOTAL: 80,
    EVENT_ATTENDANCE_FOUNDATION_ALL_TIME_TOTAL: 800,
    COMMITTEE_MEMBERS_POINTS: 0.5,
    COMMITTEE_MEMBERS_COUNT: 9,
    COMMITTEE_MEMBERS_FOUNDATION_TOTAL: 90,
    COMMITTEE_MEMBERS_FOUNDATION_ALL_TIME_TOTAL: 900,
    BOARD_MEMBERS_POINTS: 1,
    BOARD_MEMBERS_COUNT: 10,
    BOARD_MEMBERS_FOUNDATION_TOTAL: 100,
    BOARD_MEMBERS_FOUNDATION_ALL_TIME_TOTAL: 1000,
    EVENT_SPEAKERS_POINTS: 0.25,
    EVENT_SPEAKERS_COUNT: 11,
    EVENT_SPEAKERS_FOUNDATION_TOTAL: 110,
    EVENT_SPEAKERS_FOUNDATION_ALL_TIME_TOTAL: 1100,
    MEETUP_ATTENDANCE_POINTS: 0.75,
    MEETUP_ATTENDANCE_COUNT: 12,
    MEETUP_ATTENDANCE_FOUNDATION_TOTAL: 120,
    MEETUP_ATTENDANCE_FOUNDATION_ALL_TIME_TOTAL: 1200,
    SPONSORSHIP_EVENTS_POINTS: 0.4,
    SPONSORSHIP_EVENTS_COUNT: 13,
    SPONSORSHIP_EVENTS_FOUNDATION_TOTAL: 130,
    SPONSORSHIP_EVENTS_FOUNDATION_ALL_TIME_TOTAL: 1300,
    CERTIFIED_INDIVIDUALS_POINTS: 0.6,
    CERTIFIED_INDIVIDUALS_COUNT: 14,
    CERTIFIED_INDIVIDUALS_FOUNDATION_TOTAL: 140,
    CERTIFIED_INDIVIDUALS_FOUNDATION_ALL_TIME_TOTAL: 1400,
    MEMBERSHIP_TIER_POINTS: 0.66,
  };

  function mockWarehouse(overrides: { hero?: unknown; breakdown?: unknown } = {}): void {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('LEADERBOARD_BREAKDOWN')) {
        return { rows: 'breakdown' in overrides && overrides.breakdown === null ? [] : [overrides.breakdown ?? breakdownRow] };
      }
      if (sql.includes('PROJECT_NAME')) {
        return { rows: 'hero' in overrides && overrides.hero === null ? [] : [overrides.hero ?? heroRow] };
      }
      return { rows: [] };
    });
  }

  function keysOf(categories: readonly { key: string }[]): string[] {
    return categories.map((category) => category.key);
  }

  beforeEach(() => {
    execute.mockReset();
  });

  // The drawer renders the shared category lists while the server projects its own column map, so a
  // key renamed on one side would otherwise surface as a silently missing row rather than a failure.
  it.each([
    ['technical', ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES],
    ['ecosystem', ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES],
  ] as const)('emits exactly the shared %s category keys, in the shared order', async (dimension, categories) => {
    mockWarehouse();

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, dimension, SUBJECT, '1y');

    expect(keysOf(breakdown!.categories)).toEqual(keysOf(categories));
    expect(breakdown!.withheldCategories).toEqual([]);
  });

  it('omits the privately-sourced ecosystem categories for a caller outside the subject organization', async () => {
    mockWarehouse({ breakdown: { ...breakdownRow, ACCOUNT_ID: 'a-different-account' } });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, 'ecosystem', SUBJECT, '1y');

    // Reported in the withheld list's own order, which is what the drawer's name-only rows key off.
    const ecosystemKeys = keysOf(ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES);
    const withheld = ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS.filter((key) => ecosystemKeys.includes(key));
    expect(breakdown!.withheldCategories).toEqual(withheld);
    expect(keysOf(breakdown!.categories)).toEqual(ecosystemKeys.filter((key) => !withheld.includes(key)));
  });

  it('withholds nothing on the technical dimension, whose categories are all publicly derivable', async () => {
    mockWarehouse({ breakdown: { ...breakdownRow, ACCOUNT_ID: 'a-different-account' } });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y');

    expect(breakdown!.withheldCategories).toEqual([]);
    expect(keysOf(breakdown!.categories)).toEqual(keysOf(ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES));
  });

  // The route middleware authorizes the viewing org only, so without this gate a grant on one
  // organization would read any project slug.
  it('returns null when the viewing organization has no catalog row for the project', async () => {
    mockWarehouse({ hero: null });

    await expect(service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y')).resolves.toBeNull();
  });

  it('returns null for the ecosystem dimension on a non-LF project, matching its empty board', async () => {
    mockWarehouse({ hero: { ...heroRow, IS_LF_PROJECT: false } });

    await expect(service.getLeaderboardBreakdown(ORG, SLUG, 'ecosystem', SUBJECT, '1y')).resolves.toBeNull();
    await expect(service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y')).resolves.not.toBeNull();
  });

  // Guards the column names themselves: a renamed or mistyped warehouse column reads as absent and
  // would otherwise ship as a plausible zero row.
  it.each([
    ['technical', ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES],
    ['ecosystem', ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES],
  ] as const)('resolves a warehouse column for every %s category it declares', async (dimension) => {
    mockWarehouse({ breakdown: populatedBreakdownRow });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, dimension, SUBJECT, '1y');

    for (const figure of breakdown!.categories) {
      expect(figure.points, `${figure.key} points`).toBeGreaterThan(0);
      // Membership Tier is a flat award with no activity to count, so it carries points only.
      if (figure.key === 'tier') continue;
      expect(figure.count, `${figure.key} count`).toBeGreaterThan(0);
      expect(figure.projectTotal, `${figure.key} denominator`).toBeGreaterThan(0);
    }
  });

  // The drawer prints a "Total score" row directly beneath the column of per-category points, so the
  // parts have to add up to the whole at the precision both are served at.
  it.each([
    ['technical', 42.5],
    ['ecosystem', 6.25],
  ] as const)('serves %s category points that sum to the total score it reports', async (dimension, expectedTotal) => {
    mockWarehouse({ breakdown: populatedBreakdownRow });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, dimension, SUBJECT, '1y');

    expect(breakdown!.totalScore).toBe(expectedTotal);
    const summed = breakdown!.categories.reduce((total, figure) => total + figure.points, 0);
    expect(summed).toBeCloseTo(breakdown!.totalScore, 2);
  });
});
