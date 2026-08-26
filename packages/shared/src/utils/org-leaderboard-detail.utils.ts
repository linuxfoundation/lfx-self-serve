// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgLeaderboardDetailBreakdown,
  OrgLeaderboardDetailCategory,
  OrgLeaderboardDetailCategoryRow,
} from '../interfaces/org-leaderboard-detail-drawer.interface';

/**
 * Builds the category rows rendered in the drawer's breakdown list from a served breakdown.
 *
 * Visible rows are sorted descending by points. Withheld rows carry no figures at all — the server
 * never sent them — and are grouped at the end in the categories' own declared order: ranking them
 * among the visible rows, or among each other by size, would disclose the magnitudes the withholding
 * exists to protect.
 *
 * `pct` is each category's share of the total score, so the bars are comparable within one breakdown.
 * A zero total yields zero-width bars rather than a divide-by-zero.
 */
export function orgLeaderboardDetailCategoryRows(
  categories: OrgLeaderboardDetailCategory[],
  breakdown: OrgLeaderboardDetailBreakdown
): OrgLeaderboardDetailCategoryRow[] {
  const withheld = new Set(breakdown.withheldCategories);
  const figures = new Map(breakdown.categories.map((figure) => [figure.key, figure]));
  const total = breakdown.totalScore;

  const visible: OrgLeaderboardDetailCategoryRow[] = [];
  const hidden: OrgLeaderboardDetailCategoryRow[] = [];

  for (const category of categories) {
    if (withheld.has(category.key)) {
      hidden.push({
        key: category.key,
        name: category.name,
        points: 0,
        pct: 0,
        count: null,
        projectTotal: null,
        notTrackedForProject: false,
        withheld: true,
      });
      continue;
    }
    // A category absent from both lists is not a privacy omission — it is a category this dimension
    // does not score (or one the warehouse stopped emitting). Render it as an explicit zero rather
    // than dropping it, so the list always accounts for every category the methodology names.
    const figure = figures.get(category.key);
    const points = figure?.points ?? 0;
    visible.push({
      key: category.key,
      name: category.name,
      points,
      pct: total > 0 ? Math.round((points / total) * 100) : 0,
      count: figure?.count ?? null,
      projectTotal: figure?.projectTotal ?? null,
      notTrackedForProject: figure?.projectAllTimeTotal === 0,
      withheld: false,
    });
  }

  visible.sort((a, b) => b.points - a.points);
  return [...visible, ...hidden];
}
