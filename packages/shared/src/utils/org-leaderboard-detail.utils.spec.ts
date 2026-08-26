// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_SCORED_COMPONENT_COUNTS,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES,
} from '../constants/org-leaderboard-detail-drawer.constants';
import type { OrgLeaderboardDetailBreakdown, OrgLeaderboardDetailCategoryFigure } from '../interfaces/org-leaderboard-detail-drawer.interface';
import { orgLeaderboardDetailCategoryRows } from './org-leaderboard-detail.utils';

const categories = [
  { key: 'a', name: 'A' },
  { key: 'b', name: 'B' },
  { key: 'c', name: 'C' },
];

function breakdown(figures: OrgLeaderboardDetailCategoryFigure[], totalScore: number, withheldCategories: string[] = []): OrgLeaderboardDetailBreakdown {
  return {
    organizationId: 'org-1',
    organizationName: 'Example Org',
    dimension: 'ecosystem',
    range: 'all',
    totalScore,
    level: 'Contributing',
    isOwnOrganization: false,
    rank: 3,
    totalOrganizations: 41,
    categories: figures,
    withheldCategories,
  };
}

describe('orgLeaderboardDetailCategoryRows', () => {
  it('computes pct as a share of the total score and sorts descending by points', () => {
    const rows = orgLeaderboardDetailCategoryRows(
      categories,
      breakdown(
        [
          { key: 'a', points: 10, count: 1 },
          { key: 'b', points: 40, count: 2 },
          { key: 'c', points: 50, count: 3 },
        ],
        100
      )
    );
    expect(rows.map((row) => row.key)).toEqual(['c', 'b', 'a']);
    expect(rows.map((row) => row.pct)).toEqual([50, 40, 10]);
    expect(rows.every((row) => !row.withheld)).toBe(true);
  });

  it('renders a zero-scoring category rather than dropping it, so the list accounts for every category', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, breakdown([{ key: 'a', points: 10, count: 1 }], 10));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.key === 'b')).toMatchObject({ points: 0, pct: 0, count: null });
  });

  it('yields zero-width bars instead of dividing by zero when the organization scored nothing', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, breakdown([{ key: 'a', points: 0, count: 0 }], 0));
    expect(rows.map((row) => row.pct)).toEqual([0, 0, 0]);
  });

  it('groups withheld rows at the end and carries no figures for them', () => {
    const rows = orgLeaderboardDetailCategoryRows(
      categories,
      breakdown(
        [
          { key: 'a', points: 10, count: 1 },
          { key: 'c', points: 5, count: 1 },
        ],
        105,
        ['b']
      )
    );
    expect(rows.map((row) => row.key)).toEqual(['a', 'c', 'b']);
    expect(rows.find((row) => row.key === 'b')).toMatchObject({ withheld: true, points: 0, pct: 0, count: null, projectTotal: null });
  });

  it('keeps withheld rows in their declared order instead of ranking them, which would leak their sizes', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, breakdown([{ key: 'a', points: 100, count: 1 }], 107, ['b', 'c']));
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c']);
  });

  it('flags a category the project never runs, so it renders differently from a zero count', () => {
    const rows = orgLeaderboardDetailCategoryRows(
      categories,
      breakdown(
        [
          { key: 'a', points: 0, count: 0, projectTotal: 0, projectAllTimeTotal: 0 },
          { key: 'b', points: 0, count: 0, projectTotal: 0, projectAllTimeTotal: 120 },
        ],
        0
      )
    );
    expect(rows.find((row) => row.key === 'a')?.notTrackedForProject).toBe(true);
    expect(rows.find((row) => row.key === 'b')?.notTrackedForProject).toBe(false);
  });
});

describe('drawer category lists', () => {
  // A component added to a dimension's total upstream, without a row here to explain it, would leave
  // part of every score silently unaccounted for — which is the defect this feature exists to fix.
  it('lists exactly as many categories as the warehouse sums into each dimension total', () => {
    expect(ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES).toHaveLength(ORG_LEADERBOARD_DETAIL_SCORED_COMPONENT_COUNTS.technical);
    expect(ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES).toHaveLength(ORG_LEADERBOARD_DETAIL_SCORED_COMPONENT_COUNTS.ecosystem);
  });
});
