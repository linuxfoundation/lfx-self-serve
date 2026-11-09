// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import rather than the utils barrel: this is a constants module, and the barrel reaches
// modules that depend on Angular. `color.utils` itself imports nothing, so there is no cycle.
import { hexToRgba } from '../utils/color.utils';
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

/**
 * Annotated like `ORG_LENS_ROI_METHOD_LABELS`, so adding a method without a description fails here
 * rather than leaving one option in the settings drawer unexplained. Wording follows the model
 * methodology (lf-dbt, docs/lfx_roi: "Why the logistic method is the default").
 */
export const ORG_LENS_ROI_METHOD_DESCRIPTIONS: Record<(typeof ORG_LENS_ROI_METHODS)[number], string> = {
  logit:
    'Pools evidence across your other projects and across the project’s other organizations, which steadies short or sparse histories. Its markups are the least related to how much a pair spends.',
  direct:
    'Ranks pairs on their raw activity rate alone. It saturates for pairs that are active every month and keeps a heavier top tail, so it is best read as a robustness check on the logistic figures.',
};

/**
 * `localStorage` key the selected estimation method persists under. Versioned so that choices saved
 * before Logit was confirmed as the default reset once to it; bump again only for the same reason.
 */
export const ORG_LENS_ROI_METHOD_STORAGE_KEY = 'lfx-org-roi-estimation-method-v2';

export const ORG_LENS_ROI_CACHE_KEY = {
  summary: 'roi-summary:v1',
  coverage: 'roi-coverage:v1',
  annual: 'roi-annual:v1',
  /** Unlike its siblings this key carries no method suffix — see the read in `org-lens-roi.service.ts`. */
  investmentBreakdown: 'roi-investment-breakdown:v1',
  projects: 'roi-projects:v1',
  /** Both are additionally keyed by the project slug — see the reads in `org-lens-roi.service.ts`. */
  projectDetail: 'roi-project-detail:v1',
  projectAnnual: 'roi-project-annual:v1',
  valueDrivers: 'roi-value-drivers:v1',
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
  profit: 'bg-teal-100 text-teal-600',
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

/** The two readings of the annual trend, in tab order. Year over year is the default. */
export const ORG_LENS_ROI_ANNUAL_SERIES_MODES = ['yearly', 'cumulative'] as const;

/** Annotated like `ORG_LENS_ROI_PROJECT_MEASURE_LABELS`, so adding a mode without a label fails here. */
export const ORG_LENS_ROI_ANNUAL_SERIES_MODE_LABELS: Record<(typeof ORG_LENS_ROI_ANNUAL_SERIES_MODES)[number], string> = {
  yearly: 'Year over year',
  cumulative: 'Cumulative',
};

/**
 * Dataset names per mode. The canvas legend and the tooltip both read these, which is why the chart
 * options themselves never have to vary by mode.
 */
export const ORG_LENS_ROI_ANNUAL_SERIES_LABELS: Record<(typeof ORG_LENS_ROI_ANNUAL_SERIES_MODES)[number], { investment: string; return: string }> = {
  yearly: { investment: 'Investment', return: 'Return' },
  cumulative: { investment: 'Cumulative investment', return: 'Cumulative return' },
};

/**
 * The apportionment disclosure, which both modes owe and neither can phrase the same way. The
 * leading sentence is if anything more load-bearing cumulatively, since the whole curve's shape is
 * an artefact of the apportionment weights. Only the trailing clause differs: "movement between
 * years" describes a per-year shape and says nothing true about a monotonic running total.
 */
export const ORG_LENS_ROI_ANNUAL_APPORTIONMENT_NOTE: Record<(typeof ORG_LENS_ROI_ANNUAL_SERIES_MODES)[number], string> = {
  yearly:
    "Yearly figures are apportioned from lifetime totals by each year's share of investment — they are not measured independently for each year, so movement between years reflects when the activity happened rather than a change in performance.",
  cumulative:
    "Yearly figures are apportioned from lifetime totals by each year's share of investment — they are not measured independently for each year, so the shape of the cumulative curve reflects when the activity happened rather than a change in performance.",
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

/**
 * The in-app synopsis of the contribution ROI model, shown in the disclosure under the KPI cards.
 * It is the page's only explanation of what the model does while the staff ROI documentation is
 * unpublished, so keep every claim here true to the model methodology (lf-dbt, docs/lfx_roi) rather
 * than simplifying it into something stronger than the model supports.
 *
 * `investment` carries the page's standing privacy commitment — rates identical for every
 * organization, no pay data — which is asserted by e2e. Do not weaken it.
 */
export const ORG_LENS_ROI_MODEL_OVERVIEW = {
  whatTheseAre:
    'These figures put a dollar value on what your organization puts into Linux Foundation projects, and on the economic return associated with those projects. Both are modelled estimates, useful for comparison and for seeing the scale of an investment — not audited accounting figures.',
  dataSources:
    'Everything is derived from records the Linux Foundation already holds: code and community contribution history, leadership meeting attendance, memberships, event attendance and sponsorship, and training.',
  investment:
    'Money spent directly — membership fees, sponsorships, event tickets, courses — is counted as recorded. Staff time is estimated from activity records, converted to full-time-equivalent effort, and priced at flat benchmark rates that are the same for every organization. No salary, payroll, or invoice data is used.',
  markup:
    'Value is inferred from behavior rather than asked for. An organization that keeps investing in a project, year after year and across several kinds of contribution, reveals that it values the project at least at what that participation costs. How persistently it contributes yields a markup — a strategic importance factor, the perceived value per dollar of efficiently allocated cost. That ranking is turned into dollars using the LF Research survey on contribution ROI.',
  returnAndRoi:
    'Applying the markup to the cost of your contribution portfolio gives Total Return. Set against Total Investment, that gives ROI as a percentage and the benefit-cost ratio as a multiple — always exactly one more than ROI.',
  limits:
    'The model values contributing to open source, not using it. Most organizations that benefit from these projects never contribute, so these figures understate the total value the projects create.',
} as const;

/** The research the markup calibration is anchored to, linked from the model overview. */
export const ORG_LENS_ROI_SURVEY_URL = 'https://www.linuxfoundation.org/research/contribution-roi';

/**
 * Target for the model documentation link in the overview disclosure. Empty on purpose: the ROI
 * articles were removed from the Help Center in #5257 because the page is LF Staff Only, and the
 * link stays unrendered until staff-facing documentation is published. Setting this is the only
 * change needed to bring it back.
 */
export const ORG_LENS_ROI_DOCS_URL = '';

/**
 * Per-metric definitions for the project detail page. The portfolio page explains itself through
 * `ORG_LENS_ROI_MODEL_OVERVIEW` instead, so this is no longer shared between the two surfaces.
 */
export const ORG_LENS_ROI_KPI_EXPLANATION = {
  totalExpenditure:
    'We count your organization’s public contribution activity — commits, community participation, meetings, events, memberships, and training — and price it at standard rates that are the same for every organization. No salary, payroll, or invoice data is used.',
  totalReturn:
    'The modelled economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.',
  profit:
    'Total return less investment — what the modelled return is worth after the modelled cost of earning it. Negative for a project that returned less than it cost, which is a real and reasonably common outcome rather than a data problem.',
  roi: 'Net return divided by investment, shown as a percentage. 100% means you got back your investment again on top of it. Blank when there is no investment to divide by.',
  bcr: 'Total return divided by investment. A benefit-cost ratio of 5× means every dollar of modelled investment is associated with five dollars of modelled return. Always exactly one more than ROI.',
} as const;

/** The complementary views of the projects section, in tab order. */
export const ORG_LENS_ROI_PROJECT_VIEWS = ['table', 'bar', 'sankey', 'drivers', 'bubble'] as const;

export const ORG_LENS_ROI_PROJECT_VIEW_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_VIEWS)[number], string> = {
  bar: 'Investment vs return',
  sankey: 'Where it flows',
  bubble: 'Efficiency',
  table: 'All projects',
  drivers: 'Value drivers',
};

/** The three views driven by the shared project selection; the table and value drivers always cover the complete portfolio. */
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

/**
 * Sankey identifies a node by its key, so the keys are type-prefixed ids and display names are
 * supplied separately. Keying on the name alone merged two projects sharing one, and let a project
 * named after a contribution category — or after the organization node — join that node and form a
 * cycle.
 */
export const ORG_LENS_ROI_SANKEY_ORG_NODE_KEY = 'org';
export const ORG_LENS_ROI_SANKEY_PROJECT_NODE_PREFIX = 'project:';
export const ORG_LENS_ROI_SANKEY_CATEGORY_NODE_PREFIX = 'category:';

export const ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE = 25;

export const ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const ORG_LENS_ROI_PROJECT_SORT_FIELDS = ['name', 'investment', 'return', 'profit', 'roi', 'bcr'] as const;

/** Annotated so adding a sort field without a heading fails here rather than at the template. */
export const ORG_LENS_ROI_PROJECT_SORT_LABELS: Record<(typeof ORG_LENS_ROI_PROJECT_SORT_FIELDS)[number], string> = {
  name: 'Project',
  investment: 'Investment',
  return: 'Return',
  profit: 'Net return',
  roi: 'ROI',
  bcr: 'BCR',
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
 * Most labels a narrow efficiency axis carries. Below two 1/2/5 steps Chart.js ticks every tenth
 * of a decade — 15 ticks, 20px apart, on a $101K–$499K span — so labels fall back to an even stride.
 */
export const ORG_LENS_ROI_BUBBLE_AXIS_MAX_LABELS = 6;

/**
 * Translucent fills for the efficiency plot, where bubbles overlap and an opaque one hides those
 * behind it. Derived from the same palette entries the points use — at full opacity — for their
 * borders, so a palette change moves fill and border together instead of silently parting them.
 */
export const ORG_LENS_ROI_BUBBLE_FILL = {
  profitable: hexToRgba(lfxColors.emerald[600], 0.45),
  lossMaking: hexToRgba(lfxColors.amber[500], 0.55),
} as const;

/** The warehouse taxonomy's category names, with the one-line gloss the chart shows beneath each. */
export const ORG_LENS_ROI_VALUE_DRIVER_CATEGORIES = [
  { category: 'Revenue Boosters', subtitle: 'Productivity, standards' },
  { category: 'Strategic', subtitle: 'Talent, competitive intel' },
  { category: 'Prosocial', subtitle: 'Ecosystem goodwill' },
  { category: 'Risk Mitigation', subtitle: 'Tech debt, longevity' },
  { category: 'Direct Cost Savings', subtitle: 'Shared R&D' },
] as const;

/**
 * The decomposition is shown only for organizations with at least this many projects. lf-dbt#3163
 * recommends it (docs/lfx_roi/user-guide/interpreting-results.md): below it the two markup methods
 * stop agreeing on category values. The warehouse table does not enforce it, so the BFF does.
 */
export const ORG_LENS_ROI_VALUE_DRIVERS_MIN_PROJECTS = 5;

/**
 * A bar longer than this share of the plot width (zero line at the centre, so 50 is the plot edge)
 * carries its value label inside the bar: outside it the label would run past the plot edge or into
 * the category column.
 */
export const ORG_LENS_ROI_VALUE_DRIVERS_LABEL_INSIDE_PCT = 38;

export const ORG_LENS_ROI_VALUE_DRIVERS_COLORS = {
  moreThanAverage: lfxColors.emerald[600],
  lessThanAverage: lfxColors.amber[500],
} as const;

/**
 * Wording is tied to the warehouse model (lf-dbt#3163, docs/lfx_roi/decomposition.md):
 * `PCT_DEVIATION_FROM_TYPICAL_MARKUP` is the percent by which a category moves the portfolio's
 * markup away from the typical organization-project pair. The UI says "return" for it, since that is
 * the page's own vocabulary. Keep these claims in step with that doc.
 */
export const ORG_LENS_ROI_VALUE_DRIVERS_COPY = {
  howToRead:
    'Each bar shows how much a value driver contributes to your portfolio’s return, relative to the typical organization-project pair. The middle line is the typical pair. A bar to the right (green) means that driver contributes more return than it does for a typical pair. A bar to the left (amber) means it contributes less. A bar of +14% means 14% more return than typical from that driver.',
  typical:
    'Typical is the average across all organization-project pairs LFX models. A bar at 0 means your portfolio is typical for that driver, not that the driver provides no value.',
  association:
    'These are associations, not proven causes. Each category is built from measurable activity that tends to go with higher return, not from anything your organization reported.',
  fit: 'The model explains only part of the variation in return, and the bars show that explained part.',
  methodDifference: 'Direct cost savings (shared R&D) can differ noticeably between the two estimation methods. The other categories mostly agree.',
  directional: 'Value driver decomposition can be sensitive to small portfolios. Treat these results as directional.',
  moreLegend: 'More return than typical',
  lessLegend: 'Less return than typical',
  axisCenter: 'Typical',
} as const;
