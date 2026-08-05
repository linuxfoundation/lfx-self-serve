// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Snowflake row shapes for the three `ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_MEETINGS_*` models —
 * server-side only. These mirror warehouse columns, not the wire contract; the BFF maps them onto
 * `OrgMeetingsKpiSummary` / `OrgMeetingsSpendBreakdown` / `OrgInfluenceRow`.
 *
 * None of these carries a person-identifying column: the models consume `person_key` inside
 * `COUNT(DISTINCT …)` and never project it (FR-015).
 */

/** One row of `ORG_LENS_MEETINGS_KPI`, grain `(ACCOUNT_ID, TIME_RANGE_TYPE)`. */
export interface OrgMeetingsKpiWarehouseRow {
  EMPLOYEES_ACTIVE: number;
  MEETINGS_ATTENDED: number;
  PROJECTS_SUPPORTED: number;
  FOUNDATIONS_SUPPORTED: number;
  PRIOR_EMPLOYEES_ACTIVE: number;
  PRIOR_MEETINGS_ATTENDED: number;
  PRIOR_PROJECTS_SUPPORTED: number;
  PRIOR_FOUNDATIONS_SUPPORTED: number;
}

/** One row of `ORG_LENS_MEETINGS_SPEND`, grain `(ACCOUNT_ID, TIME_RANGE_TYPE, BREAKDOWN_KIND, LABEL)`. */
export interface OrgMeetingsSpendWarehouseRow {
  BREAKDOWN_KIND: string;
  LABEL: string;
  ATTENDANCE_COUNT: number;
  PCT: number;
  RANK: number;
  IS_OTHER: boolean;
  /** `{label, pct}` objects — in-universe entities only, capped at 20. Null unless `IS_OTHER`. */
  OTHER_ITEMS: unknown;
  /** In-universe entities beyond the 20 itemized, rendered as the trailing "+N more" row. */
  OTHER_OVERFLOW_COUNT: number | null;
}

/** One row of `ORG_LENS_MEETINGS_INFLUENCE`, grain `(ACCOUNT_ID, PROJECT_SLUG, TIME_RANGE_TYPE)`. */
export interface OrgMeetingsInfluenceWarehouseRow {
  PROJECT_SLUG: string;
  PROJECT_NAME: string;
  ECOSYSTEM_INFLUENCE: number;
  /** The nine displayed categories summed — the denominator every percentage on the row derives from. */
  DISPLAYED_INFLUENCE: number;
  BAND: string;
  RANK: number;
  RANK_TOTAL: number;
  /**
   * Foundation-wide population at the fixed `last_2_years` window, carried so the figure the
   * Organization Dashboard publishes stays reconcilable. Does NOT vary with the requested range, and
   * is null for projects with no `last_2_years` row — those must omit the reference, not show zero.
   */
  RANK_TOTAL_ALL: number | null;
  FROM_ATTENDANCE_PCT: number;
  DELTA_PCT: number;
  /** Zero-baseline detector for the "New" delta rule; `TREND_DIRECTION` cannot identify it. */
  PRIOR_WINDOW_SCORE: number;
  TREND_DIRECTION: string;
  /** The nine displayed `{label, pct}` categories, summing to exactly 100.0 and sorted descending. */
  BREAKDOWN: unknown;
}
