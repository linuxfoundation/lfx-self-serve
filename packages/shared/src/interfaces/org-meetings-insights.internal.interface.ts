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

/** One row of `ORG_LENS_MEETINGS_INFLUENCE`, grain `(ACCOUNT_ID, PROJECT_SLUG)` — range-independent. */
export interface OrgMeetingsInfluenceWarehouseRow {
  PROJECT_SLUG: string;
  PROJECT_NAME: string;
  ECOSYSTEM_INFLUENCE: number;
  BAND: string;
  RANK: number;
  RANK_TOTAL: number;
  FROM_ATTENDANCE_PCT: number;
  DELTA_PCT: number;
  /** Zero-baseline detector for the "New" delta rule; `TREND_DIRECTION` cannot identify it. */
  PRIOR_YEAR_SCORE: number;
  TREND_DIRECTION: string;
  /** The nine displayed `{label, pct}` categories, renormalized to 100% and sorted descending. */
  BREAKDOWN: unknown;
}
