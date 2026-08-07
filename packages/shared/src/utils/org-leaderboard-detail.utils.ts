// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LeaderboardDimension } from '../interfaces/org-lens-project-detail.interface';
import type {
  OrgLeaderboardDetailCategory,
  OrgLeaderboardDetailCategoryRow,
  OrgLeaderboardDetailLevel,
} from '../interfaces/org-leaderboard-detail-drawer.interface';

/**
 * Maps a total influence score to its Silent/Participating/Contributing/Leading level, per the real
 * scoring methodology (technical and ecosystem use different thresholds).
 */
export function orgLeaderboardDetailLevelFor(dimension: LeaderboardDimension, score: number): OrgLeaderboardDetailLevel {
  if (dimension === 'technical') {
    if (score >= 15) return 'Leading';
    if (score >= 5) return 'Contributing';
    if (score >= 1) return 'Participating';
    return 'Silent';
  }
  if (score >= 20) return 'Leading';
  if (score >= 11) return 'Contributing';
  if (score >= 3) return 'Participating';
  return 'Silent';
}

/**
 * Builds the sorted (descending by points), percentage-computed category rows rendered in the
 * drawer's breakdown list. Returns an empty array when the score is 0 to avoid a divide-by-zero.
 *
 * `maskedCategoryKeys` flags rows whose count, points, and share percentage must be withheld from
 * the viewer (see `ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_KEYS`). Masked rows are grouped at the
 * bottom of the list — since their figures are hidden, ranking them among the visible rows would
 * only leak the position. Their values are zeroed out here rather than merely hidden in the
 * template, so masked figures never reach the rendered payload.
 */
export function orgLeaderboardDetailCategoryRows(
  categories: OrgLeaderboardDetailCategory[],
  points: Record<string, number>,
  counts: Record<string, number>,
  score: number,
  maskedCategoryKeys: readonly string[] = []
): OrgLeaderboardDetailCategoryRow[] {
  if (score <= 0) return [];
  const masked = new Set(maskedCategoryKeys);
  const rows = categories
    .map((category) => ({
      key: category.key,
      name: category.name,
      count: counts[category.key] ?? 0,
      points: points[category.key] ?? 0,
      pct: Math.round(((points[category.key] ?? 0) / score) * 100),
      masked: masked.has(category.key),
    }))
    .sort((a, b) => {
      if (a.masked !== b.masked) return a.masked ? 1 : -1;
      return b.points - a.points;
    });
  return rows.map((row) => {
    if (!row.masked) return row;
    return { ...row, count: 0, points: 0, pct: 0 };
  });
}
