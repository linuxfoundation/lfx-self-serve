// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS,
} from '@lfx-one/shared/constants';
import type { OrgLensInfluenceBlock, OrgLensProjectInfluenceCard } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
// Defaults to null so every suite here bypasses the cache; the cache-contract suite opts in.
const { buildOrgCacheKey, getJson, setJson } = vi.hoisted(() => ({ buildOrgCacheKey: vi.fn(() => null as string | null), getJson: vi.fn(), setJson: vi.fn() }));

vi.mock('./snowflake.service', async () => {
  // The real predicate, so a missing-object degrade (and which object is blamed) runs as in production.
  const { isMissingObjectError } = await import('../helpers/snowflake-error.helper');
  return {
    SnowflakeService: class {
      public static getInstance() {
        return { execute };
      }
      public static isMissingObjectError(error: unknown, expectedObject?: string) {
        return isMissingObjectError(error, expectedObject);
      }
    },
  };
});
vi.mock('./valkey.service', () => ({
  buildOrgCacheKey,
  valkeyService: { getJson, setJson },
}));
// See org-lens-projects.service.spec.ts for why this delegates to the real classification utils instead of stubbing.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/insights.utils');
  return {
    ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
    buildInsightsUrl: () => '',
    normalizeHealthScoreCategoryV2: actual.normalizeHealthScoreCategoryV2,
  };
});

import { OrgLensProjectDetailService } from './org-lens-project-detail.service';

const ORG = '0014100000AcmeAAAA';
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

/** Snowflake's answer while lf-dbt has not built the team-member flag yet (lfx-self-serve#4685). */
const MISSING_TEAM_MEMBER_FLAG = Object.assign(new Error("SQL compilation error: error line 5 at position 14\ninvalid identifier 'IS_CDP_TEAM_MEMBER'"), {
  code: '000904',
});

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

  it('returns null health when the v2 category is unrecognized (LFXV2-3379)', async () => {
    mockHeroRow({ HEALTH_SCORE_CATEGORY_V2: 'Typo' });

    const block = await service.getHeroBlock(ORG, SLUG);

    expect(block?.hero.health).toBeNull();
  });

  it('returns null health when the v2 category is null (LFXV2-3379)', async () => {
    mockHeroRow({ HEALTH_SCORE_CATEGORY_V2: null });

    const block = await service.getHeroBlock(ORG, SLUG);

    expect(block?.hero.health).toBeNull();
  });

  it('passes the v2 score, max, covered count and category scores straight through from the warehouse', async () => {
    mockHeroRow({
      HEALTH_OVERALL_SCORE_V2: 70,
      HEALTH_SCORE_CATEGORY_V2: 'Healthy',
      COVERED_CATEGORY_COUNT_V2: 2,
      HEALTH_MAX_SCORE_V2: 75,
      HEALTH_MAINTAINER_V2: 38,
      HEALTH_SECURITY_V2: 32,
      HEALTH_DEVELOPMENT_V2: null,
    });

    const block = await service.getHeroBlock(ORG, SLUG);

    expect(block?.hero.healthCoveredCategoryCount).toBe(2);
    expect(block?.hero.healthMaxScore).toBe(75);
    expect(block?.hero.healthOverallScore).toBe(70);
    expect(block?.hero.healthMaintainer).toBe(38);
    expect(block?.hero.healthSecurity).toBe(32);
    expect(block?.hero.healthDevelopment).toBeNull();
  });
});

describe('OrgLensProjectDetailService.getLeaderboardBreakdown', () => {
  const service = new OrgLensProjectDetailService();
  const SUBJECT = 'crowd-org-1';

  const breakdownRow = {
    ACCOUNT_ID: ORG,
    ORGANIZATION_NAME: 'Acme Motors',
    TECHNICAL_INFLUENCE_SCORE: 42,
    TECHNICAL_INFLUENCE_LEVEL: 'Leading',
    ECOSYSTEM_INFLUENCE_SCORE: 17,
    ECOSYSTEM_INFLUENCE_LEVEL: 'Participating',
  };

  // Every warehouse column the service's category map reads, spelled out here independently of that
  // map. A column named on only one side resolves to no column on the other and surfaces as a zeroed
  // figure rather than an error, so the assertions below check the mapped values, not just the keys.
  // The maintainer category's count and total are maintainer roles, read from the roles table instead.
  // Per-category points are chosen so they sum exactly to each dimension's score at two decimals but
  // NOT at one, which is what pins the drawer's total to its own column of points.
  const populatedBreakdownRow = {
    ACCOUNT_ID: ORG,
    ORGANIZATION_NAME: 'Acme Motors',
    TECHNICAL_INFLUENCE_SCORE: 42.5,
    TECHNICAL_INFLUENCE_LEVEL: 'Leading',
    ECOSYSTEM_INFLUENCE_SCORE: 6.25,
    ECOSYSTEM_INFLUENCE_LEVEL: 'Participating',

    MAINTAINERS_POINTS: 3.5,
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

  const maintainerRoles = { ORGANIZATION_ROLES: 2, PROJECT_ROLES: 20 };

  function mockWarehouse(overrides: { hero?: unknown; breakdown?: unknown; rolesMissing?: boolean } = {}): void {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_MAINTAINER_ROLES')) {
        if (overrides.rolesMissing) {
          throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.PROJECT_MAINTAINER_ROLES' does not exist or not authorized.");
        }
        return { rows: [maintainerRoles] };
      }
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
    buildOrgCacheKey.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    setJson.mockClear();
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
  it.each(['technical', 'ecosystem'] as const)('resolves a warehouse column for every %s category it declares', async (dimension) => {
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

  // The lifetime total is what the drawer reads to say "not tracked for this project", so it may only
  // be served where the warehouse totals that activity per project. The fixture supplies every
  // foundation-scoped lifetime column too: serving one would let a total that 265 sibling projects
  // share decide a claim about this one.
  it.each([
    ['technical', []],
    ['ecosystem', ['collab', 'meeting']],
  ] as const)('serves a lifetime total for %s only where the warehouse totals it per project', async (dimension, projectScoped) => {
    mockWarehouse({ breakdown: populatedBreakdownRow });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, dimension, SUBJECT, '1y');

    const served = breakdown!.categories.filter((figure) => figure.projectAllTimeTotal !== undefined).map((figure) => figure.key);
    expect(served).toEqual([...projectScoped]);
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

  it.each([
    ['1y', 365],
    ['2y', 730],
    ['all', null],
  ] as const)(
    'counts the maintainer category for toggle %s as the organization roles against every company roles, keeping the score points',
    async (range, days) => {
      mockWarehouse({ breakdown: populatedBreakdownRow });

      const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, range);

      expect(breakdown!.categories.find((figure) => figure.key === 'maintainer')).toEqual({ key: 'maintainer', points: 3.5, count: 2, projectTotal: 20 });
      const rolesCalls = (execute.mock.calls as [string, unknown[]][]).filter(([sql]) => sql.includes('PROJECT_MAINTAINER_ROLES'));
      expect(rolesCalls).toHaveLength(1);
      // The clicked row's organization, the project, then the toggle's overlap window.
      expect(rolesCalls[0][1]).toEqual(days === null ? [SUBJECT, SUBJECT, SLUG] : [SUBJECT, SUBJECT, SLUG, days]);
    }
  );

  it('does not read maintainer roles for the ecosystem dimension', async () => {
    mockWarehouse();

    await service.getLeaderboardBreakdown(ORG, SLUG, 'ecosystem', SUBJECT, '1y');

    expect((execute.mock.calls as [string][]).some(([sql]) => sql.includes('PROJECT_MAINTAINER_ROLES'))).toBe(false);
  });

  it('keeps the maintainer points but leaves the count out, and does not store the breakdown, when the roles table is missing', async () => {
    buildOrgCacheKey.mockReturnValue('breakdown-key');
    getJson.mockResolvedValue(null);
    mockWarehouse({ breakdown: populatedBreakdownRow, rolesMissing: true });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y');

    expect(breakdown!.categories.find((figure) => figure.key === 'maintainer')).toEqual({ key: 'maintainer', points: 3.5 });
    expect(breakdown!.totalScore).toBe(42.5);
    expect(setJson).not.toHaveBeenCalled();
  });

  it('stores the breakdown under a versioned key when the roles were read', async () => {
    buildOrgCacheKey.mockReturnValue('breakdown-key');
    getJson.mockResolvedValue(null);
    mockWarehouse({ breakdown: populatedBreakdownRow });

    await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y');

    expect(buildOrgCacheKey).toHaveBeenCalledWith(ORG, expect.stringMatching(/^project-detail-breakdown-technical:v3:/));
    expect(setJson).toHaveBeenCalledWith('breakdown-key', expect.objectContaining({ organizationId: SUBJECT }), expect.anything());
  });

  // lfx-self-serve#4685: the clicked organization's roles (N) leave CDP team members out; every company's (M) do not.
  it("leaves CDP team members' roles out of the organization's count, not out of every company's total", async () => {
    mockWarehouse({ breakdown: populatedBreakdownRow });

    await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y');

    const [[sql, , options]] = (execute.mock.calls as [string, unknown[], unknown][]).filter(([query]) => query.includes('PROJECT_MAINTAINER_ROLES'));
    const credited = 'ORGANIZATION_ID = ? AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)';
    expect(sql).toContain(`COUNT(DISTINCT IFF(${credited}, MEMBER_ID, NULL), IFF(${credited}, SEGMENT_ID, NULL)) AS ORGANIZATION_ROLES`);
    expect(sql).toContain('COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS PROJECT_ROLES');
    expect(options).toMatchObject({ expectMissingObject: 'PROJECT_MAINTAINER_ROLES', expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
  });

  it('counts team members, and does not store the breakdown, while the roles table has no team-member flag yet', async () => {
    buildOrgCacheKey.mockReturnValue('breakdown-key');
    getJson.mockResolvedValue(null);
    mockWarehouse({ breakdown: populatedBreakdownRow });
    const answer = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER')) throw MISSING_TEAM_MEMBER_FLAG;
      return answer(sql);
    });

    const breakdown = await service.getLeaderboardBreakdown(ORG, SLUG, 'technical', SUBJECT, '1y');

    expect(breakdown!.categories.find((figure) => figure.key === 'maintainer')).toEqual({ key: 'maintainer', points: 3.5, count: 2, projectTotal: 20 });
    expect(setJson).not.toHaveBeenCalled();
  });
});

describe('OrgLensProjectDetailService.getInfluenceBlock commits card', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
    buildOrgCacheKey.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('TECH_COMMITS_PCT')) return { rows: [{ TECH_COMMITS_PCT: 12.34 }] };
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return { rows: [] };
    });
  });

  it('labels the card "Commits" under a versioned cache key', async () => {
    const block = await service.getInfluenceBlock(ORG, SLUG, '1y');

    const commits = block!.technical.find((card) => card.key === 'commits');
    expect(commits?.label).toBe('Commits');
    expect(commits?.caption).toEqual({ prefix: 'Employees made ', emphasis: '12.3%', suffix: ' of all commits.' });
    expect(buildOrgCacheKey).toHaveBeenCalledWith(ORG, expect.stringMatching(/^project-detail-influence:v6:/));
  });
});

/**
 * The board is cached for an hour, so entries written before it began serving `organizationId`
 * outlive the deploy that needs it. Those rows are structurally valid but cannot open the drawer:
 * the row renders focusable and clickable while the click does nothing. The cache read is the only
 * place that can catch it, so it has to validate the rows and not just the envelope.
 */
describe('OrgLensProjectDetailService board cache contract', () => {
  const service = new OrgLensProjectDetailService();

  function cachedPage(rows: unknown[]): void {
    buildOrgCacheKey.mockReturnValue('board-key');
    getJson.mockImplementation(async (_key: string, validate: (value: unknown) => boolean) => {
      const page = { rows, total: rows.length, isNonLfProject: false };
      return validate(page) ? page : null;
    });
  }

  beforeEach(() => {
    execute.mockReset();
    getJson.mockReset();
    buildOrgCacheKey.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('PROJECT_NAME') ? [heroRow] : [] }));
  });

  it('serves a cached page whose rows carry an organization id', async () => {
    cachedPage([{ organizationId: 'crowd-org-1', orgName: 'Acme' }]);

    const page = await service.getTechnicalBoard(ORG, SLUG, '1y', 'influence', 0, 10, '');

    expect(page!.rows).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a cached page whose rows predate the organization id, so the board re-fetches', async () => {
    cachedPage([{ orgName: 'Acme' }]);

    await service.getTechnicalBoard(ORG, SLUG, '1y', 'influence', 0, 10, '');

    expect(execute).toHaveBeenCalled();
  });

  it('still serves an empty cached page, which carries no rows to validate', async () => {
    cachedPage([]);

    const page = await service.getTechnicalBoard(ORG, SLUG, '1y', 'influence', 0, 10, '');

    expect(page!.rows).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('OrgLensProjectDetailService.getCardRoster paging', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('COUNT(*)') ? [{ N: 0 }] : [] }));
  });

  function rosterSql(): string {
    const call = execute.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('OFFSET'));
    expect(call).toBeDefined();
    return call![0] as string;
  }

  it('caps an oversized page at the deepest allowed page', async () => {
    await service.getCardRoster(ORG, 'Acme', SLUG, 'contributors', '1y', 1e25, 10);

    const sql = rosterSql();
    expect(sql).toContain('LIMIT 10 OFFSET 1000000');
    expect(sql).not.toContain('e+');
  });

  it('truncates a fractional page', async () => {
    await service.getCardRoster(ORG, 'Acme', SLUG, 'contributors', '1y', 2.7, 10);

    expect(rosterSql()).toContain('LIMIT 10 OFFSET 20');
  });
});

describe('OrgLensProjectDetailService maintainer roles (lfx-self-serve#4482)', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
    buildOrgCacheKey.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('AS MAINTAINER_ROLES')) return { rows: [{ MAINTAINER_ROLES: 3 }] };
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      if (sql.includes(' AS N ')) return { rows: [{ N: 2 }] };
      if (sql.includes('MAINTAINER_NAME')) {
        return {
          rows: [
            { MAINTAINER_NAME: 'Ada Lovelace', ROLE_START_DATE: '2000-01-01', ROLE_END_DATE: null },
            { MAINTAINER_NAME: 'Grace Hopper', ROLE_START_DATE: '2024-03-05', ROLE_END_DATE: '2025-06-30' },
          ],
        };
      }
      return { rows: [] };
    });
  });

  function callsOn(table: string): [string, unknown[]][] {
    return (execute.mock.calls as [string, unknown[]][]).filter(([sql]) => sql.includes(table));
  }

  it.each([
    ['1y', [ORG, SLUG, 365]],
    ['2y', [ORG, SLUG, 730]],
    ['all', [ORG, SLUG]],
  ] as const)('counts the card for toggle %s from the roles overlapping its range', async (range, binds) => {
    const block = await service.getInfluenceBlock(ORG, SLUG, range);

    const card = block!.technical.find((entry) => entry.key === 'maintainers');
    expect(card?.label).toBe('Maintainer roles');
    expect(card?.caption).toEqual({ prefix: 'Our company holds ', emphasis: '3', suffix: ' maintainer roles on this project.' });
    const [[sql, bound]] = callsOn('ORG_MAINTAINER_ROLES');
    expect(sql).toContain('WHERE ACCOUNT_ID = ? AND INSIGHTS_PROJECT_SLUG = ?');
    expect(sql).toContain('ROLE_START_DATE <= CURRENT_DATE()');
    expect(sql.includes('ROLE_END_DATE')).toBe(range !== 'all');
    expect(bound).toEqual(binds);
    expect(callsOn('ORG_LENS_PROJECT_DETAIL_CARDS')[0]?.[0]).not.toContain('TECH_MAINTAINERS_COUNT');
  });

  it('shows the maintainers card as unavailable, not "no roles", and does not store the block, when the roles table is missing', async () => {
    buildOrgCacheKey.mockReturnValue('influence-key');
    getJson.mockResolvedValue(null);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return { rows: sql.includes('PROJECT_NAME') ? [heroRow] : [] };
    });

    const block = await service.getInfluenceBlock(ORG, SLUG, '1y');

    expect(block!.technical.find((entry) => entry.key === 'maintainers')?.caption).toEqual({
      prefix: 'No data for this metric yet.',
      emphasis: '',
      suffix: '',
    });
    // The hero row may still be cached; the influence block (the one carrying the cards) must not be.
    expect(setJson).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ technical: expect.anything() }), expect.anything());
  });

  it.each([
    ['1y', [ORG, SLUG, 365]],
    ['all', [ORG, SLUG]],
  ] as const)('lists one roster row per role overlapping toggle %s, the same rows the card counts', async (range, binds) => {
    const page = await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', range, 0, 10);

    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.cells.slice(1).map((cell) => cell.text))).toEqual([
      ['Unknown', 'Current'],
      ['Mar 5, 2024', 'Jun 30, 2025'],
    ]);
    const rosterCalls = callsOn('ORG_MAINTAINER_ROLES');
    expect(rosterCalls).toHaveLength(2);
    for (const [sql, bound] of rosterCalls) {
      expect(sql).toContain('WHERE ACCOUNT_ID = ? AND INSIGHTS_PROJECT_SLUG = ?');
      expect(sql).toContain('ON pp.ACCOUNT_ID = r.ACCOUNT_ID AND pp.PROJECT_SLUG = r.INSIGHTS_PROJECT_SLUG AND pp.PARTICIPANT_ID = r.MEMBER_ID');
      expect(bound).toEqual(binds);
    }
    // The roster total counts the same distinct roles as the card.
    expect(rosterCalls.some(([sql]) => sql.includes('SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS N'))).toBe(true);
    expect(callsOn('ORG_LENS_PROJECT_DETAIL_MAINTAINERS')).toEqual([]);
  });

  it('pages the roster without avatars, and does not store it, when only the avatar table is missing', async () => {
    buildOrgCacheKey.mockReturnValue('roster-key');
    getJson.mockResolvedValue(null);
    setJson.mockClear();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_LENS_PROJECT_PEOPLE')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_PROJECT_PEOPLE' does not exist or not authorized.");
      }
      if (sql.includes(' AS N ')) return { rows: [{ N: 1 }] };
      return { rows: [{ MAINTAINER_NAME: 'Ada Lovelace', PERSON_AVATAR_URL: null, ROLE_START_DATE: '2024-03-05', ROLE_END_DATE: null }] };
    });

    const page = await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10);

    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.cells.slice(1).map((cell) => cell.text))).toEqual([['Mar 5, 2024', 'Current']]);
    const fallbackCalls = callsOn('ORG_MAINTAINER_ROLES').filter(([sql]) => !sql.includes('ORG_LENS_PROJECT_PEOPLE'));
    expect(fallbackCalls).toHaveLength(2);
    for (const [sql, bound] of fallbackCalls) {
      expect(sql).toContain('WHERE ACCOUNT_ID = ? AND INSIGHTS_PROJECT_SLUG = ?');
      expect(bound).toEqual([ORG, SLUG, 365]);
    }
    expect(setJson).not.toHaveBeenCalled();
  });

  it('degrades the roster to empty, and does not store it, when the roles table is missing', async () => {
    buildOrgCacheKey.mockReturnValue('roster-key');
    getJson.mockResolvedValue(null);
    setJson.mockClear();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('ORG_MAINTAINER_ROLES')) {
        throw new Error("SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES' does not exist or not authorized.");
      }
      return { rows: [] };
    });

    expect(await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10)).toEqual({ rows: [], total: 0 });
    expect(setJson).not.toHaveBeenCalled();
  });

  it('still fails the roster on any other error', async () => {
    execute.mockRejectedValue(new Error('Warehouse timeout'));

    await expect(service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10)).rejects.toThrow('Warehouse timeout');
  });

  // lfx-self-serve#4685: the account's roles leave CDP team members out, as the Overview and Contributors counts do.
  it("leaves CDP team members' roles out of the card count and its roster", async () => {
    await service.getInfluenceBlock(ORG, SLUG, '1y');
    await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10);

    const reads = (execute.mock.calls as [string, unknown[], unknown][]).filter(([sql]) => sql.includes('ORG_MAINTAINER_ROLES'));
    expect(reads).toHaveLength(3);
    for (const [sql, , options] of reads) {
      expect(sql).toContain('AND NOT COALESCE(IS_CDP_TEAM_MEMBER, FALSE)');
      expect(options).toMatchObject({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    }
    expect(reads.some(([sql]) => sql.includes('r.ROLE_END_DATE, r.IS_CDP_TEAM_MEMBER,'))).toBe(true);
  });

  it('counts and lists team members, storing neither, while the roles table has no team-member flag yet', async () => {
    // The key is the sub-resource itself, so the stored keys show which blocks were written.
    buildOrgCacheKey.mockImplementation((...args: unknown[]) => String(args[1]));
    getJson.mockResolvedValue(null);
    setJson.mockClear();
    const answer = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('IS_CDP_TEAM_MEMBER')) throw MISSING_TEAM_MEMBER_FLAG;
      return answer(sql);
    });

    const block = await service.getInfluenceBlock(ORG, SLUG, '1y');
    const page = await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10);

    expect(block!.technical.find((entry) => entry.key === 'maintainers')?.caption.emphasis).toBe('3');
    expect(page.total).toBe(2);
    const storedKeys = (setJson.mock.calls as [string][]).map(([key]) => key);
    expect(storedKeys.some((key) => key.startsWith('project-detail-influence:'))).toBe(false);
    expect(storedKeys.some((key) => key.startsWith('project-detail-roster:v3:'))).toBe(false);
  });

  // The roster selects the flag through its alias, so Snowflake names it qualified; the fallback must still match.
  it("lists team members, without storing the page, when Snowflake names the missing flag as 'R.IS_CDP_TEAM_MEMBER'", async () => {
    buildOrgCacheKey.mockImplementation((...args: unknown[]) => String(args[1]));
    getJson.mockResolvedValue(null);
    setJson.mockClear();
    const answer = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('r.IS_CDP_TEAM_MEMBER')) {
        throw Object.assign(new Error("SQL compilation error: error line 2 at position 107\ninvalid identifier 'R.IS_CDP_TEAM_MEMBER'"), { code: '000904' });
      }
      return answer(sql);
    });

    const page = await service.getCardRoster(ORG, 'Acme', SLUG, 'maintainers', '1y', 0, 10);

    expect(page.total).toBe(2);
    const calls = execute.mock.calls as [string, unknown[], unknown][];
    const failed = calls.filter(([sql]) => sql.includes('r.IS_CDP_TEAM_MEMBER'));
    expect(failed.length).toBeGreaterThan(0);
    for (const [, , options] of failed) expect(options).toMatchObject({ expectInvalidIdentifier: 'IS_CDP_TEAM_MEMBER' });
    expect(calls.some(([sql]) => sql.includes('MAINTAINER_NAME') && !sql.includes('IS_CDP_TEAM_MEMBER'))).toBe(true);
    expect((setJson.mock.calls as [string][]).some(([key]) => key.startsWith('project-detail-roster:'))).toBe(false);
  });
});

describe('OrgLensProjectDetailService maintainer roles sparkline and drawer total (lfx-self-serve#4605)', () => {
  const service = new OrgLensProjectDetailService();

  function yearMonth(monthsAgo: number): string {
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  // The sparkline tables still carry an older people-based maintainers series, which the card must never show.
  const peopleSeriesValue = 99;
  const EXCLUDING = 'ORG_VALUE_EXCLUDING_TEAM_MEMBERS';

  /** A `maintainer-roles` row: the account's roles without team members' when the read selects that column, with them otherwise. */
  function rolesRow(sql: string, period: Record<string, unknown>, excluded: number, included: number, project: number): Record<string, unknown> {
    return { METRIC_KEY: 'maintainer-roles', ...period, ORG_VALUE: sql.includes(EXCLUDING) ? excluded : included, PROJECT_VALUE: project };
  }

  function mockWarehouse(overrides: { missingTable?: string; roles?: boolean; projectRoles?: number } = {}): void {
    const withRoles = overrides.roles ?? true;
    execute.mockImplementation(async (sql: string) => {
      if (overrides.missingTable && sql.includes(`.${overrides.missingTable}`)) {
        throw new Error(`SQL compilation error:\nObject 'ANALYTICS.PLATINUM_LFX_ONE.${overrides.missingTable}' does not exist or not authorized.`);
      }
      if (sql.includes('.PROJECT_MAINTAINER_ROLES')) return { rows: [{ MAINTAINER_ROLES: overrides.projectRoles ?? 1234 }] };
      if (sql.includes('AS MAINTAINER_ROLES')) return { rows: [{ MAINTAINER_ROLES: 3 }] };
      if (sql.includes('ORG_LENS_PROJECT_DETAIL_SPARKLINES_LIFETIME')) {
        return {
          rows: [
            { METRIC_KEY: 'maintainers', BUCKET_INDEX: 1, ORG_VALUE: peopleSeriesValue, PROJECT_VALUE: peopleSeriesValue },
            { METRIC_KEY: 'contributors', BUCKET_INDEX: 1, ORG_VALUE: 6, PROJECT_VALUE: 60 },
            ...(withRoles ? [rolesRow(sql, { BUCKET_INDEX: 0 }, 1, 2, 5), rolesRow(sql, { BUCKET_INDEX: 1 }, 4, 6, 9)] : []),
          ],
        };
      }
      if (sql.includes('ORG_LENS_PROJECT_DETAIL_SPARKLINES')) {
        return {
          rows: [
            { METRIC_KEY: 'maintainers', SPAN_MONTH: yearMonth(0), ORG_VALUE: peopleSeriesValue, PROJECT_VALUE: peopleSeriesValue },
            { METRIC_KEY: 'contributors', SPAN_MONTH: yearMonth(0), ORG_VALUE: 6, PROJECT_VALUE: 60 },
            ...(withRoles ? [rolesRow(sql, { SPAN_MONTH: yearMonth(1) }, 2, 4, 8), rolesRow(sql, { SPAN_MONTH: yearMonth(0) }, 3, 5, 10)] : []),
          ],
        };
      }
      if (sql.includes('BUCKET_SPINE')) {
        return {
          rows: [
            { BUCKET_INDEX: 0, BUCKET_GRANULARITY: 'yearly', BUCKET_START: '2024-01-01', BUCKET_END: '2024-12-01' },
            { BUCKET_INDEX: 1, BUCKET_GRANULARITY: 'yearly', BUCKET_START: '2025-01-01', BUCKET_END: '2025-12-01' },
          ],
        };
      }
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return { rows: [] };
    });
  }

  function card(block: OrgLensInfluenceBlock | null, key: string): OrgLensProjectInfluenceCard {
    return block!.technical.find((entry) => entry.key === key)!;
  }

  function callsOn(table: string): [string, unknown[]][] {
    return (execute.mock.calls as [string, unknown[]][]).filter(([sql]) => sql.includes(`.${table}`));
  }

  beforeEach(() => {
    execute.mockReset();
    getJson.mockReset();
    getJson.mockResolvedValue(null);
    setJson.mockClear();
    buildOrgCacheKey.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
  });

  it.each(['1y', '2y'] as const)(
    "draws the %s sparkline from the maintainer-roles series: the account's and every company's roles per month",
    async (range) => {
      mockWarehouse();

      const maintainers = card(await service.getInfluenceBlock(ORG, SLUG, range), 'maintainers');

      expect(maintainers.sparkline).toHaveLength(36);
      expect(maintainers.sparkline.slice(-3)).toEqual([0, 2, 3]);
      expect(maintainers.projectSparkline.slice(-3)).toEqual([0, 8, 10]);
      expect(maintainers.sparkline).not.toContain(peopleSeriesValue);
      expect(callsOn('ORG_LENS_PROJECT_DETAIL_SPARKLINES')[0][1]).toEqual([ORG, SLUG]);
    }
  );

  it('draws the all-time sparkline from the maintainer-roles series per lifetime bucket, on the shared bucket axis', async () => {
    mockWarehouse();

    const block = await service.getInfluenceBlock(ORG, SLUG, 'all');

    expect(block!.periods).toEqual(['2024', '2025']);
    expect(card(block, 'maintainers')).toMatchObject({ sparkline: [1, 4], projectSparkline: [5, 9] });
    expect(card(block, 'contributors')).toMatchObject({ sparkline: [0, 6], projectSparkline: [0, 60] });
    expect(callsOn('ORG_LENS_PROJECT_DETAIL_SPARKLINES_LIFETIME')[0][1]).toEqual([ORG, SLUG]);
  });

  it('shows no maintainers sparkline when the account holds no roles on the project', async () => {
    mockWarehouse({ roles: false });

    expect(card(await service.getInfluenceBlock(ORG, SLUG, '1y'), 'maintainers')).toMatchObject({ sparkline: [], projectSparkline: [] });
  });

  it('stores the influence block under a versioned key when every roles read succeeded', async () => {
    buildOrgCacheKey.mockReturnValue('influence-key');
    mockWarehouse();

    await service.getInfluenceBlock(ORG, SLUG, '1y');

    expect(buildOrgCacheKey).toHaveBeenCalledWith(ORG, expect.stringMatching(/^project-detail-influence:v6:/));
    expect(setJson).toHaveBeenCalledWith('influence-key', expect.objectContaining({ technical: expect.anything() }), expect.anything());
  });

  // lfx-self-serve#4685: the account's roles leave CDP team members out; the grey all-companies line and the other series do not.
  it.each([
    ['1y', 'ORG_LENS_PROJECT_DETAIL_SPARKLINES', 'SPAN_MONTH'],
    ['all', 'ORG_LENS_PROJECT_DETAIL_SPARKLINES_LIFETIME', 'BUCKET_INDEX'],
  ] as const)("reads the %s maintainer-roles account series without team members' roles from %s, every other value as is", async (range, table, period) => {
    mockWarehouse();

    await service.getInfluenceBlock(ORG, SLUG, range);

    const [[sql, , options]] = (execute.mock.calls as [string, unknown[], unknown][]).filter(([query]) => query.includes(`.${table}`));
    expect(sql).toContain(
      `SELECT METRIC_KEY, ${period}, IFF(METRIC_KEY = 'maintainer-roles', COALESCE(${EXCLUDING}, ORG_VALUE), ORG_VALUE) AS ORG_VALUE, PROJECT_VALUE`
    );
    expect(options).toMatchObject({ expectInvalidIdentifier: EXCLUDING });
  });

  it.each([
    ['1y', 'ORG_LENS_PROJECT_DETAIL_SPARKLINES', 'SPAN_MONTH', [0, 4, 5]],
    ['all', 'ORG_LENS_PROJECT_DETAIL_SPARKLINES_LIFETIME', 'BUCKET_INDEX', [2, 6]],
  ] as const)(
    'draws the inclusive %s account series, keeps every other card, and does not store the block, while %s has no team-member count yet',
    async (range, table, period, inclusive) => {
      buildOrgCacheKey.mockReturnValue('influence-key');
      mockWarehouse();
      const answer = execute.getMockImplementation()!;
      execute.mockImplementation(async (sql: string) => {
        if (sql.includes(EXCLUDING)) {
          throw Object.assign(new Error(`SQL compilation error: error line 2 at position 32\ninvalid identifier '${EXCLUDING}'`), { code: '000904' });
        }
        return answer(sql);
      });

      const block = await service.getInfluenceBlock(ORG, SLUG, range);

      expect(card(block, 'maintainers').sparkline.slice(-inclusive.length)).toEqual(inclusive);
      expect(card(block, 'contributors').sparkline).toContain(6);
      expect(callsOn(table).at(-1)?.[0]).toContain(`SELECT METRIC_KEY, ${period}, ORG_VALUE, PROJECT_VALUE`);
      expect(setJson).not.toHaveBeenCalledWith('influence-key', expect.anything(), expect.anything());
    }
  );

  it("keeps team members' roles in the drawer's every-company total", async () => {
    mockWarehouse();

    await service.getCardDrawer(ORG, SLUG, 'maintainers', '1y');

    const [[sql]] = callsOn('PROJECT_MAINTAINER_ROLES');
    expect(sql).not.toContain('IS_CDP_TEAM_MEMBER');
  });

  it.each([
    ['1y', [SLUG, 365]],
    ['2y', [SLUG, 730]],
    ['all', [SLUG]],
  ] as const)('totals every company roles overlapping toggle %s in the maintainers drawer', async (range, binds) => {
    mockWarehouse();

    const drawer = await service.getCardDrawer(ORG, SLUG, 'maintainers', range);

    expect(drawer!.definition.total).toBe('1,234');
    const [[, bound]] = callsOn('PROJECT_MAINTAINER_ROLES');
    expect(bound).toEqual(binds);
  });

  it('does not read maintainer roles for another card drawer', async () => {
    mockWarehouse();

    await service.getCardDrawer(ORG, SLUG, 'contributors', '1y');

    expect(callsOn('PROJECT_MAINTAINER_ROLES')).toEqual([]);
  });

  it('shows the maintainers drawer total as unavailable, and does not store the drawer, when the roles table is missing', async () => {
    buildOrgCacheKey.mockReturnValue('drawer-key');
    mockWarehouse({ missingTable: 'PROJECT_MAINTAINER_ROLES' });

    const drawer = await service.getCardDrawer(ORG, SLUG, 'maintainers', '1y');

    expect(drawer!.definition.total).toBe('—');
    expect(setJson).not.toHaveBeenCalled();
  });

  it('stores the maintainers drawer under a versioned key when the total was read', async () => {
    buildOrgCacheKey.mockReturnValue('drawer-key');
    mockWarehouse({ projectRoles: 0 });

    const drawer = await service.getCardDrawer(ORG, SLUG, 'maintainers', '1y');

    expect(drawer!.definition.total).toBe('0');
    expect(buildOrgCacheKey).toHaveBeenCalledWith(ORG, expect.stringMatching(/^project-detail-drawer:v3:/));
    expect(setJson).toHaveBeenCalledWith('drawer-key', drawer, expect.anything());
  });
});

describe('OrgLensProjectDetailService.getTechnicalBoard paging', () => {
  const service = new OrgLensProjectDetailService();

  beforeEach(() => {
    execute.mockReset();
    buildOrgCacheKey.mockReturnValue(null);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PROJECT_NAME')) return { rows: [heroRow] };
      return { rows: sql.includes('COUNT(*)') ? [{ N: 0 }] : [] };
    });
  });

  function boardSql(): string {
    const call = execute.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('OFFSET'));
    expect(call).toBeDefined();
    return call![0] as string;
  }

  it('caps an oversized page at the deepest allowed page', async () => {
    await service.getTechnicalBoard(ORG, SLUG, '1y', 'influence', 1e25, 10, '');

    const sql = boardSql();
    expect(sql).toContain('LIMIT 10 OFFSET 1000000');
    expect(sql).not.toContain('e+');
  });

  it('truncates a fractional page', async () => {
    await service.getTechnicalBoard(ORG, SLUG, '1y', 'influence', 2.7, 10, '');

    expect(boardSql()).toContain('LIMIT 10 OFFSET 20');
  });
});
