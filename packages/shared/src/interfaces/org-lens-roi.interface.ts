// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ORG_LENS_ROI_CONTRIBUTION_TYPES, ORG_LENS_ROI_COVERAGE_REASONS, ORG_LENS_ROI_METHODS } from '../constants/org-lens-roi.constants';

export type OrgLensRoiMethod = (typeof ORG_LENS_ROI_METHODS)[number];

export type OrgLensRoiContributionType = (typeof ORG_LENS_ROI_CONTRIBUTION_TYPES)[number];

/** `unmapped` — no crowd.dev organization to key on; `not_estimated` — mapped but the estimation produced no rows. */
export type OrgLensRoiCoverageReason = (typeof ORG_LENS_ROI_COVERAGE_REASONS)[number];

export interface OrgLensRoiSummary {
  orgUid: string;
  method: OrgLensRoiMethod;
  hasData: boolean;
  nProjects: number;
  totalExpenditure: number | null;
  totalReturn: number | null;
  profit: number | null;
  /** Null — never zero — when investment is 0. */
  roi: number | null;
  bcr: number | null;
  yearMin: number | null;
  yearMax: number | null;
  dateMin: string | null;
  dateMax: string | null;
}

export interface OrgLensRoiCoverage {
  orgUid: string;
  hasData: boolean;
  coverageReason: OrgLensRoiCoverageReason;
}

export interface OrgLensRoiAnnualRow {
  year: number;
  totalReturn: number;
  expenditure: number;
  profit: number;
  roi: number | null;
  bcr: number | null;
}

export interface OrgLensRoiAnnual {
  method: OrgLensRoiMethod;
  rows: OrgLensRoiAnnualRow[];
  apportioned: boolean;
}
