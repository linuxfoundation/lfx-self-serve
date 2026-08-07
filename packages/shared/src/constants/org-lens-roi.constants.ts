// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

export const ORG_LENS_ROI_KPI_EXPLANATION = {
  totalExpenditure:
    'A modelled cost, not actual or reported compensation. We count your organization’s public contribution activity — commits, community participation, meetings, events, memberships, and training — and price it at standard rates that are the same for every organization. No salary, payroll, or invoice data is used.',
  totalReturn:
    'The modelled economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.',
  roi: 'Net return divided by investment, shown as a percentage. 100% means you got back your investment again on top of it. Blank when there is no investment to divide by.',
  bcr: 'Total return divided by investment. A benefit-cost ratio of 5× means every dollar of modelled investment is associated with five dollars of modelled return. Always exactly one more than ROI.',
} as const;
