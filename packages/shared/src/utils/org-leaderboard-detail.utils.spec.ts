// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { orgLeaderboardDetailCategoryRows, orgLeaderboardDetailLevelFor } from './org-leaderboard-detail.utils';

describe('orgLeaderboardDetailLevelFor', () => {
  it('maps technical scores to the technical thresholds', () => {
    expect(orgLeaderboardDetailLevelFor('technical', 0)).toBe('Silent');
    expect(orgLeaderboardDetailLevelFor('technical', 1)).toBe('Participating');
    expect(orgLeaderboardDetailLevelFor('technical', 4)).toBe('Participating');
    expect(orgLeaderboardDetailLevelFor('technical', 5)).toBe('Contributing');
    expect(orgLeaderboardDetailLevelFor('technical', 14)).toBe('Contributing');
    expect(orgLeaderboardDetailLevelFor('technical', 15)).toBe('Leading');
  });

  it('maps ecosystem scores to the (different) ecosystem thresholds', () => {
    expect(orgLeaderboardDetailLevelFor('ecosystem', 2)).toBe('Silent');
    expect(orgLeaderboardDetailLevelFor('ecosystem', 3)).toBe('Participating');
    expect(orgLeaderboardDetailLevelFor('ecosystem', 10)).toBe('Participating');
    expect(orgLeaderboardDetailLevelFor('ecosystem', 11)).toBe('Contributing');
    expect(orgLeaderboardDetailLevelFor('ecosystem', 19)).toBe('Contributing');
    expect(orgLeaderboardDetailLevelFor('ecosystem', 20)).toBe('Leading');
  });
});

describe('orgLeaderboardDetailCategoryRows', () => {
  const categories = [
    { key: 'a', name: 'A' },
    { key: 'b', name: 'B' },
    { key: 'c', name: 'C' },
  ];

  it('returns an empty array when score is 0 to avoid a divide-by-zero', () => {
    expect(orgLeaderboardDetailCategoryRows(categories, {}, {}, 0)).toEqual([]);
  });

  it('computes pct as a share of score and sorts descending by points when nothing is masked', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, { a: 10, b: 40, c: 50 }, { a: 1, b: 2, c: 3 }, 100);
    expect(rows.map((r) => r.key)).toEqual(['c', 'b', 'a']);
    expect(rows.map((r) => r.pct)).toEqual([50, 40, 10]);
    expect(rows.every((r) => !r.masked)).toBe(true);
  });

  it('defaults missing points/counts for a category to 0', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, { a: 10 }, { a: 1 }, 10);
    const b = rows.find((r) => r.key === 'b');
    expect(b).toMatchObject({ points: 0, count: 0, pct: 0 });
  });

  it('groups masked rows at the bottom regardless of their points', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, { a: 10, b: 90, c: 5 }, { a: 1, b: 9, c: 1 }, 105, ['b']);
    expect(rows.map((r) => r.key)).toEqual(['a', 'c', 'b']);
  });

  it('zeroes out count, points, and pct for masked rows so the values never reach the rendered payload', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, { a: 10, b: 90, c: 5 }, { a: 1, b: 9, c: 1 }, 105, ['b']);
    const masked = rows.find((r) => r.key === 'b');
    expect(masked).toMatchObject({ masked: true, count: 0, points: 0, pct: 0 });
  });

  it('leaves unmasked rows fully populated when a different category is masked', () => {
    const rows = orgLeaderboardDetailCategoryRows(categories, { a: 10, b: 90, c: 5 }, { a: 1, b: 9, c: 1 }, 105, ['b']);
    const unmasked = rows.find((r) => r.key === 'a');
    expect(unmasked).toMatchObject({ masked: false, count: 1, points: 10 });
  });
});
