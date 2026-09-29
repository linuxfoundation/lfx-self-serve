// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';

import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersSectionKey,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersModeOption,
} from '../interfaces/health-metrics-members.interface';

/**
 * The seven Members sections in render order. `key` is the section's URL fragment and the scroll-spy
 * allowlist; the DOM id is `sec-mem-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_MEMBERS_SECTIONS = [
  {
    key: 'tiers',
    label: 'Membership & revenue',
    heading: 'Membership & revenue by tier',
    description:
      'The most-used view. Composition over time rather than a total-members line — where the base is shifting is the question a total cannot answer.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'list',
    label: 'All members',
    heading: 'All members',
    description:
      'The full directory, with the engagement touchpoints alongside membership and dues. Sorted by annual dues, highest first, so the accounts that carry the revenue lead.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'risk',
    label: 'At-risk & balance',
    heading: 'At-risk & outstanding balance',
    description: 'Act-now view. Sorted by dues at risk rather than days overdue — the money order, not the calendar order.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'renewals',
    label: 'Renewals',
    heading: 'Renewals',
    description: 'The forward-looking view: what is up for renewal and what it is worth, while there is still time to act.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'board',
    label: 'Board & voting attendance',
    heading: 'Board & voting-member attendance',
    description:
      'Governance participation. This lives in Members rather than Engagement because it sits next to dues and renewals — an unused board seat is a paid benefit going to waste.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'nps',
    label: 'Satisfaction (NPS)',
    heading: 'Satisfaction (NPS)',
    description:
      'Deliberately low in this section — NPS moves once a quarter at most, so it is context rather than a signal to act on. Non-responses are shown at full weight.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'churn',
    label: 'Membership churn',
    heading: 'Membership churn',
    description:
      'Lagging by definition and deliberately last: it reports members already gone. Revenue churn leads — logo churn counts a top-tier and an entry-tier loss as one each.',
    footnote: '',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX = 'sec-mem-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_MEMBERS_DATA_SECTIONS = ['tiers'] as const satisfies readonly HealthMetricsMembersSectionKey[];

/** Note under the sub-nav items, linking to Engagement's group attendance. */
export const HEALTH_METRICS_MEMBERS_SUB_NAV_CROSS_REFERENCE: HealthMetricsL2CrossReference = {
  text: 'Group attendance is in',
  linkLabel: 'Engagement',
  route: 'engagement',
  fragment: 'committees',
};

/** The project selector does not narrow Members, so the page says so above its sections. */
export const HEALTH_METRICS_MEMBERS_SCOPE_NOTE = 'Members figures are foundation-wide. The project selector does not narrow them.';

/** A delta or share the data cannot support, e.g. a partial year with no same-window comparison. */
export const HEALTH_METRICS_MEMBERS_NOT_AVAILABLE = 'not available';

/** Read-failed / no-foundation value: no tier rows, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED: HealthMetricsMembersTiers = { rows: [], foundationRevenue: [] };

/** The toggle over the hero; the first is the default. */
export const HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS: readonly HealthMetricsMembersTiersModeOption[] = [
  { id: 'members', label: 'Members' },
  { id: 'revenue', label: 'Revenue' },
];

/** Upper bound on tier rows read; the busiest foundation has around a hundred. */
export const HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP = 500;

/** One colour per tier in `tier_sort_rank` order, darkest for the top tier; reused past the eighth. */
export const HEALTH_METRICS_MEMBERS_TIERS_COLORS: readonly string[] = [
  lfxColors.blue[900],
  lfxColors.blue[600],
  lfxColors.blue[300],
  lfxColors.violet[700],
  lfxColors.violet[400],
  lfxColors.emerald[600],
  lfxColors.emerald[300],
  lfxColors.amber[500],
];
