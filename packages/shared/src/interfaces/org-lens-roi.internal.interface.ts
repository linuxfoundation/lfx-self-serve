// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface OrgLensRoiSummaryWarehouseRow {
  N_PROJECTS: number;
  TOTAL_EXPENDITURE: number;
  TOTAL_RETURN: number;
  PROFIT: number;
  /** NULL rather than zero when `TOTAL_EXPENDITURE` is 0. */
  ROI: number | null;
  BCR: number | null;
  YEAR_MIN: number | null;
  YEAR_MAX: number | null;
  DATE_MIN: string | null;
  DATE_MAX: string | null;
}

export interface OrgLensRoiAnnualWarehouseRow {
  YEAR: number;
  TOTAL_RETURN: number;
  /** Source column is `EXPENDITURE`, not `TOTAL_EXPENDITURE`. */
  EXPENDITURE: number;
  PROFIT: number;
  ROI: number | null;
  BCR: number | null;
}

export interface OrgLensRoiCoverageWarehouseRow {
  HAS_ROI: number;
  IS_MAPPED: number;
}

/** `ORG_LENS_ROI_INVESTMENT_BREAKDOWN` has no `MARKUP_METHOD` column — the levels source carries none. */
export interface OrgLensRoiInvestmentBreakdownWarehouseRow {
  CONTRIBUTION_TYPE: string;
  CONTRIBUTION_LABEL: string;
  EXPENDITURE: number;
}

/**
 * One row per project × contribution category, from `ORG_LENS_ROI_PROJECTS` left-joined to
 * `ORG_LENS_ROI_PROJECTS_BREAKDOWN`. The project columns repeat across a project's category rows;
 * `CONTRIBUTION_TYPE` is null for a project with no breakdown rows.
 */
export interface OrgLensRoiProjectWarehouseRow {
  PROJECT_ID: string;
  PROJECT_SLUG: string;
  PROJECT_NAME: string;
  TOTAL_EXPENDITURE: number;
  TOTAL_RETURN: number;
  PROFIT: number;
  ROI: number | null;
  BCR: number | null;
  BREAKEVEN_MARKUP: number | null;
  CONTRIBUTION_TYPE: string | null;
  CONTRIBUTION_LABEL: string | null;
  CATEGORY_EXPENDITURE: number | null;
}
