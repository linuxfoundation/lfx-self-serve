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
 */
export function orgLeaderboardDetailCategoryRows(
  categories: OrgLeaderboardDetailCategory[],
  points: Record<string, number>,
  counts: Record<string, number>,
  score: number
): OrgLeaderboardDetailCategoryRow[] {
  if (score <= 0) return [];
  const rows = categories
    .map((category) => ({
      key: category.key,
      name: category.name,
      count: counts[category.key] ?? 0,
      points: points[category.key] ?? 0,
      pct: Math.round(((points[category.key] ?? 0) / score) * 100),
      isTop: false,
    }))
    .sort((a, b) => b.points - a.points);
  if (rows.length > 0) rows[0].isTop = true;
  return rows;
}
