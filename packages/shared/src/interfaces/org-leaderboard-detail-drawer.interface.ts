// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LeaderboardDimension } from './org-lens-project-detail.interface';

/** One influence-score category (e.g. "Maintainers", "Meeting Attendance") shown in the detail drawer. */
export interface OrgLeaderboardDetailCategory {
  key: string;
  name: string;
}

/**
 * Demo/placeholder per-company score breakdown for the Org Lens Project Detail leaderboard detail
 * drawer (LFXV2-2934). See `packages/shared/src/constants/org-leaderboard-detail-drawer.constants.ts`
 * for the real seam comment — this shape mirrors the eventual Snowflake-backed payload so swapping
 * the data source later doesn't require changing the drawer component.
 */
export interface OrgLeaderboardDetailCompany {
  rank: number;
  activityPct: number;
  score: number;
  /** Points earned per category key, independent (no preset weights) — sums to `score`. */
  points: Record<string, number>;
  /** Raw activity count behind each category's points, keyed the same as `points`. */
  counts: Record<string, number>;
}

/** One methodology bullet — a bolded lead-in category label followed by the scoring explanation. */
export interface OrgLeaderboardDetailMethodologyBullet {
  label: string;
  text: string;
}

/** Structured "How this score is calculated" content for one leaderboard dimension. */
export interface OrgLeaderboardDetailMethodology {
  intro: string;
  bullets: OrgLeaderboardDetailMethodologyBullet[];
  levelMapping: string;
}

/** Row-level identity + context needed to open the leaderboard detail drawer for a clicked row. */
export interface OrgLeaderboardDetailRequest {
  dimension: LeaderboardDimension;
  orgName: string;
}

/** Influence level derived from a company's total score for one leaderboard dimension. */
export type OrgLeaderboardDetailLevel = 'Silent' | 'Participating' | 'Contributing' | 'Leading';

/** Sorted, percentage-computed category row rendered in the drawer's breakdown list. */
export interface OrgLeaderboardDetailCategoryRow {
  key: string;
  name: string;
  count: number;
  points: number;
  pct: number;
  /**
   * When true the row's raw count and share percentage must not be rendered — the category is
   * privacy-restricted for the viewing org (see `ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_KEYS`).
   */
  masked: boolean;
}
