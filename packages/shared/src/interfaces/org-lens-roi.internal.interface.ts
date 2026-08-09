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
