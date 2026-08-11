// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';

export const ORG_LENS_ROI_METHODS = ['logit', 'direct'] as const;

export const ORG_LENS_ROI_DEFAULT_METHOD = 'logit';

/**
 * Why an organization has or hasn't got figures. `unmapped` is permanent; `not_estimated` is
 * mapped-but-unestimated and must not be described to viewers as arriving on a later run.
 */
export const ORG_LENS_ROI_COVERAGE_REASONS = ['covered', 'unmapped', 'not_estimated'] as const;

export const ORG_LENS_ROI_METHOD_LABELS: Record<(typeof ORG_LENS_ROI_METHODS)[number], string> = {
  logit: 'Logistic markup',
  direct: 'Direct markup',
};

/** `localStorage` key the selected estimation method persists under. */
export const ORG_LENS_ROI_METHOD_STORAGE_KEY = 'lfx-org-roi-estimation-method';

export const ORG_LENS_ROI_CACHE_KEY = {
  summary: 'roi-summary:v1',
  coverage: 'roi-coverage:v1',
  annual: 'roi-annual:v1',
  /** Unlike its siblings this key carries no method suffix — see the read in `org-lens-roi.service.ts`. */
  investmentBreakdown: 'roi-investment-breakdown:v1',
  projects: 'roi-projects:v1',
} as const;

/** Order must match the warehouse seed's display order. */
export const ORG_LENS_ROI_CONTRIBUTION_TYPES = [
  'code',
  'community',
  'meetings',
  'event_attendance',
  'event_sponsorship',
  'membership_project',
  'membership_tlf',
  'educ_courses',
] as const;

/** Disclosure copy only — changing these recalculates nothing; the rates live in the warehouse. */
export const ORG_LENS_ROI_GLOBAL_ASSUMPTIONS = {
  codeSalaryUsd: 200_000,
  communitySalaryUsd: 150_000,
  overheadMultiplier: 1.5,
} as const;

export const ORG_LENS_ROI_KPI_ICON_CLASS = {
  totalExpenditure: 'bg-blue-100 text-blue-600',
  totalReturn: 'bg-emerald-100 text-emerald-600',
  roi: 'bg-violet-100 text-violet-600',
  bcr: 'bg-amber-100 text-amber-600',
} as const;

/** Rendered wherever a metric is undefined, so an absent value never reads as zero. */
export const ORG_LENS_ROI_NO_VALUE = '—';

/** Categories holding less than this share of total investment collapse into one labelled remainder. */
export const ORG_LENS_ROI_CATEGORY_REMAINDER_THRESHOLD = 0.02;

/** Projects are drawn as slices until they cover this share of the measure; the rest collapse into one remainder. */
export const ORG_LENS_ROI_PROJECT_DONUT_COVERAGE = 0.8;

/** A ceiling on slice count regardless of coverage — a flat distribution would otherwise draw hundreds of unreadable slivers. */
export const ORG_LENS_ROI_PROJECT_DONUT_MAX_SLICES = 10;

export const ORG_LENS_ROI_PROJECT_MEASURES = ['investment', 'return', 'netReturn'] as const;

/** Annotated like `ORG_LENS_ROI_METHOD_LABELS`, so adding a measure without a label fails here rather than at each index site. */
export const ORG_LENS_ROI_PROJECT_MEASURE_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_MEASURES)[number], string> = {
  investment: 'Investment',
  return: 'Return',
  netReturn: 'Net Return',
};

/** Ends in gray so the remainder slice reads as "everything else" rather than as another category. */
export const ORG_LENS_ROI_DONUT_PALETTE: readonly string[] = [
  lfxColors.blue[600],
  lfxColors.emerald[500],
  lfxColors.violet[500],
  lfxColors.amber[500],
  lfxColors.blue[400],
  lfxColors.emerald[400],
  lfxColors.violet[400],
  lfxColors.amber[400],
  lfxColors.blue[300],
  lfxColors.emerald[300],
];

export const ORG_LENS_ROI_DONUT_REMAINDER_COLOR = lfxColors.gray[400];

export const ORG_LENS_ROI_KPI_EXPLANATION = {
  totalExpenditure:
    'A modelled cost, not actual or reported compensation. We count your organization’s public contribution activity — commits, community participation, meetings, events, memberships, and training — and price it at standard rates that are the same for every organization. No salary, payroll, or invoice data is used.',
  totalReturn:
    'The modelled economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.',
  roi: 'Net return divided by investment, shown as a percentage. 100% means you got back your investment again on top of it. Blank when there is no investment to divide by.',
  bcr: 'Total return divided by investment. A benefit-cost ratio of 5× means every dollar of modelled investment is associated with five dollars of modelled return. Always exactly one more than ROI.',
} as const;

/** The four complementary views of the projects section, in tab order. */
export const ORG_LENS_ROI_PROJECT_VIEWS = ['bar', 'sankey', 'bubble', 'table'] as const;

export const ORG_LENS_ROI_PROJECT_VIEW_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_VIEWS)[number], string> = {
  bar: 'Investment vs return',
  sankey: 'Where it flows',
  bubble: 'Efficiency',
  table: 'All projects',
};

/** The three views driven by the shared project selection; the table always pages the complete set. */
export const ORG_LENS_ROI_PROJECT_SELECTION_VIEWS = ['bar', 'sankey', 'bubble'] as const;

/** How many projects the shared picker starts with, taken from the top by return. */
export const ORG_LENS_ROI_PROJECT_PICKER_DEFAULT_COUNT = 5;

/** Matches beyond this are not offered; the search box exists to find one project, not to browse. */
export const ORG_LENS_ROI_PROJECT_PICKER_MAX_MATCHES = 20;

/**
 * Per-view drawing ceilings. "All" is a legitimate selection on an organization with hundreds of
 * projects, and no view stays readable at that size — so each draws its leading N and discloses the
 * shortfall, rather than the selection being silently capped at the picker. The three differ
 * because legibility does: bars degrade by height, flows by link crossings, points barely at all.
 */
export const ORG_LENS_ROI_PROJECT_BAR_MAX_ROWS = 25;

/** Lowest of the three: a flow diagram crosses every link against every other. */
export const ORG_LENS_ROI_PROJECT_SANKEY_MAX_PROJECTS = 12;

/** Highest of the three: a scatter plot stays legible far longer than bars or flows. */
export const ORG_LENS_ROI_PROJECT_BUBBLE_MAX_POINTS = 250;

export const ORG_LENS_ROI_PROJECT_SANKEY_MEASURES = ['investment', 'return'] as const;

export const ORG_LENS_ROI_PROJECT_SANKEY_MEASURE_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_SANKEY_MEASURES)[number], string> = {
  investment: 'Investment',
  return: 'Return',
};

/** The single node every investment flow passes through, on its way out to the projects. */
export const ORG_LENS_ROI_SANKEY_ORG_NODE = 'Your organization';

export const ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE = 25;

export const ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const ORG_LENS_ROI_PROJECT_SORT_FIELDS = ['name', 'investment', 'return', 'profit', 'roi', 'bcr', 'breakevenMarkup'] as const;

/** Annotated so adding a sort field without a heading fails here rather than at the template. */
export const ORG_LENS_ROI_PROJECT_SORT_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_SORT_FIELDS)[number], string> = {
  name: 'Project',
  investment: 'Investment',
  return: 'Return',
  profit: 'Net return',
  roi: 'ROI',
  bcr: 'BCR',
  breakevenMarkup: 'Breakeven markup',
};

/** The table opens on the payload's own ordering, so the first page needs no client re-sort. */
export const ORG_LENS_ROI_PROJECTS_TABLE_DEFAULT_SORT = 'return';

/**
 * Keyed by contribution type rather than by position, so a category keeps its colour as the stack
 * order changes from project to project. Ordered against `ORG_LENS_ROI_CONTRIBUTION_TYPES`.
 */
export const ORG_LENS_ROI_CATEGORY_COLOR: Record<(typeof ORG_LENS_ROI_CONTRIBUTION_TYPES)[number], string> = {
  code: lfxColors.blue[600],
  community: lfxColors.emerald[500],
  meetings: lfxColors.violet[500],
  event_attendance: lfxColors.amber[500],
  event_sponsorship: lfxColors.blue[400],
  membership_project: lfxColors.emerald[400],
  membership_tlf: lfxColors.violet[400],
  educ_courses: lfxColors.amber[400],
};

/** Return is one series against the stacked investment categories, so it needs a colour of its own. */
export const ORG_LENS_ROI_RETURN_COLOR = lfxColors.emerald[600];

/** A log axis cannot plot zero, so non-positive values are lifted to this floor and disclosed. */
export const ORG_LENS_ROI_BUBBLE_LOG_FLOOR = 1;

/**
 * Translucent fills for the efficiency plot, where bubbles overlap and an opaque one hides those
 * behind it. These are the alpha forms of `emerald[600]` and `amber[500]`, which the same points
 * use — at full opacity — for their borders.
 */
export const ORG_LENS_ROI_BUBBLE_FILL = {
  profitable: 'rgba(0, 153, 102, 0.45)',
  lossMaking: 'rgba(254, 154, 0, 0.55)',
} as const;
