// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ORG_LENS_ROI_CONTRIBUTION_TYPES,
  ORG_LENS_ROI_COVERAGE_REASONS,
  ORG_LENS_ROI_METHODS,
  ORG_LENS_ROI_PROJECT_MEASURES,
  ORG_LENS_ROI_PROJECT_SANKEY_MEASURES,
  ORG_LENS_ROI_PROJECT_SORT_FIELDS,
  ORG_LENS_ROI_PROJECT_VIEWS,
} from '../constants/org-lens-roi.constants';

export type OrgLensRoiMethod = (typeof ORG_LENS_ROI_METHODS)[number];

/** Which measure the projects donut ranks and sizes projects by. */
export type OrgLensRoiProjectMeasure = (typeof ORG_LENS_ROI_PROJECT_MEASURES)[number];

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

/** One contribution category's modelled investment. Shared by the portfolio breakdown and each project's. */
export interface OrgLensRoiCategoryRow {
  type: OrgLensRoiContributionType;
  label: string;
  expenditure: number;
}

export interface OrgLensRoiInvestmentBreakdown {
  rows: OrgLensRoiCategoryRow[];
  /** Equals `/summary.totalExpenditure` exactly. A difference is a defect, not a caveat to render. */
  total: number;
}

export interface OrgLensRoiProjectRow {
  projectId: string;
  projectSlug: string;
  projectName: string;
  totalExpenditure: number;
  totalReturn: number;
  profit: number;
  /** Null — never zero — when the project has no investment to divide by. */
  roi: number | null;
  bcr: number | null;
  breakevenMarkup: number | null;
  /** Sums to `totalExpenditure` by construction; never rescale client-side. */
  categories: OrgLensRoiCategoryRow[];
}

export interface OrgLensRoiProjects {
  method: OrgLensRoiMethod;
  /** The complete, uncapped project set. */
  rows: OrgLensRoiProjectRow[];
}

/** One rendered arc of the category donut. A view model — never serialized, never a wire contract. */
export interface OrgLensRoiCategorySlice {
  key: string;
  label: string;
  expenditure: number;
  share: number;
  color: string;
}

/** One rendered arc of the projects donut. A view model — never serialized, never a wire contract. */
export interface OrgLensRoiProjectSlice {
  key: string;
  label: string;
  /** The true signed measure, which is what the label reports. */
  value: number;
  /** What the arc is sized by. Never negative, because an arc cannot be. */
  weight: number;
  color: string;
}

export type OrgLensRoiProjectView = (typeof ORG_LENS_ROI_PROJECT_VIEWS)[number];

export type OrgLensRoiProjectSankeyMeasure = (typeof ORG_LENS_ROI_PROJECT_SANKEY_MEASURES)[number];

export type OrgLensRoiProjectSortField = (typeof ORG_LENS_ROI_PROJECT_SORT_FIELDS)[number];

export type OrgLensRoiProjectAriaSort = 'ascending' | 'descending' | 'none';

/** One entry of the shared picker — both the chips already chosen and the search matches on offer. */
export interface OrgLensRoiProjectOption {
  projectId: string;
  projectName: string;
  /** The project's return, formatted. The picker ranks by return, so this is what it shows. */
  amount: string;
}

/** One stacked investment category within a bar. Never rescaled: the parts sum to the whole already. */
export interface OrgLensRoiProjectBarSegment {
  type: OrgLensRoiContributionType;
  label: string;
  expenditure: number;
  color: string;
}

/** One project's row of the comparison bar chart. A view model — never serialized. */
export interface OrgLensRoiProjectBarRow {
  projectId: string;
  projectName: string;
  segments: OrgLensRoiProjectBarSegment[];
  totalExpenditure: number;
  totalReturn: number;
}

/** One `{from, to, flow}` link of the sankey. A view model — never serialized. */
export interface OrgLensRoiProjectFlowLink {
  from: string;
  to: string;
  flow: number;
}

/** One plotted project of the efficiency view. A view model — never serialized. */
export interface OrgLensRoiProjectBubblePoint {
  projectId: string;
  projectName: string;
  /** Investment, lifted to the log floor when non-positive. */
  x: number;
  /** Return, lifted to the log floor when non-positive. */
  y: number;
  r: number;
  /** True when either coordinate was lifted, so the point can be disclosed rather than trusted. */
  isFloored: boolean;
}

/**
 * One row of the projects table, carrying both the raw measures it sorts on and the strings it
 * renders, so neither formatting nor null handling happens in the template.
 */
export interface OrgLensRoiProjectTableRow {
  projectId: string;
  projectSlug: string;
  projectName: string;
  totalExpenditure: number;
  totalReturn: number;
  profit: number;
  roi: number | null;
  bcr: number | null;
  breakevenMarkup: number | null;
  investmentLabel: string;
  returnLabel: string;
  profitLabel: string;
  roiLabel: string;
  bcrLabel: string;
  breakevenMarkupLabel: string;
}
