// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LeaderboardDimension, OrgLensLeaderboardTimeRange } from './org-lens-project-detail.interface';

/** One influence-score category (e.g. "Maintainers", "Meeting Attendance") shown in the detail drawer. */
export interface OrgLeaderboardDetailCategory {
  key: string;
  name: string;
}

/**
 * One category's figures as served by the BFF. The ratio fields are optional rather than nullable:
 * maintainers and board members are binary point awards and membership tier maps from the tier, so
 * those rows have no ratio at all — an absent field reads as "no ratio here", where a null would
 * invite the client to render "0 of 0".
 */
export interface OrgLeaderboardDetailCategoryFigure {
  key: string;
  points: number;
  /** The organization's own count. Absent for membership tier, which is not scored on participation. */
  count?: number;
  /** Range-scoped project-wide total the count is measured against. */
  projectTotal?: number;
  /**
   * Project-wide lifetime total for the activity, regardless of the active range. A zero means the
   * project does not run this activity at all, which is a different fact from an organization that
   * did not participate in one that it does run.
   */
  projectAllTimeTotal?: number;
}

/**
 * A ranked organization's score breakdown for one leaderboard dimension, as served by the BFF.
 *
 * `totalScore` is the figure the clicked leaderboard row displays; the client renders it rather than
 * summing `categories`, because the categories summing to the score is a warehouse guarantee and
 * re-deriving it client-side would reintroduce the drift that guarantee exists to prevent.
 *
 * Categories the caller may not see are absent from `categories` and named in `withheldCategories` —
 * never present with zeroed figures, since a zero is a claim about the data and absence is not.
 */
export interface OrgLeaderboardDetailBreakdown {
  organizationId: string;
  organizationName: string;
  dimension: LeaderboardDimension;
  range: OrgLensLeaderboardTimeRange;
  totalScore: number;
  level: OrgLeaderboardDetailLevel;
  /** Whether the caller belongs to the subject organization. A display input for explaining withheld rows, never a gate. */
  isOwnOrganization: boolean;
  /** The organization's 1-based position on this dimension's board over the full ranked set; null when unranked. */
  rank: number | null;
  /** Organizations ranked on this board for the project and range, for the "#3 out of 41" phrasing. */
  totalOrganizations: number;
  /**
   * The organization's share of one activity board — contributions for technical, collaborations for
   * ecosystem — not of everything the dimension scores, and not a driver of the total. Absent when
   * the warehouse has no activity row for the organization.
   */
  activitySharePercent?: number;
  /** In the drawer's display order, one entry per category the caller may see. */
  categories: OrgLeaderboardDetailCategoryFigure[];
  /** Keys omitted from `categories`, listed explicitly so a category absent for any other reason does not read as "hidden for privacy". */
  withheldCategories: string[];
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

/** Influence level derived from a company's total score for one leaderboard dimension. */
export type OrgLeaderboardDetailLevel = 'Silent' | 'Participating' | 'Contributing' | 'Leading';

/** Sorted, percentage-computed category row rendered in the drawer's breakdown list. */
export interface OrgLeaderboardDetailCategoryRow {
  key: string;
  name: string;
  points: number;
  /** Share of the total score this category's points represent. */
  pct: number;
  /** The organization's count, or null for a category with no count to show (binary awards, membership tier). */
  count: number | null;
  /** Range-scoped project-wide total, or null when the category has no ratio. */
  projectTotal: number | null;
  /** True when the project never runs this activity at all — rendered differently from a zero count. */
  notTrackedForProject: boolean;
  /** True when the server withheld this category's figures, so only its name is rendered. */
  withheld: boolean;
  /** Info-icon copy for this row — why its figures are withheld, or why it has points but no count. Null when the row needs no explanation. */
  tooltip: string | null;
}
