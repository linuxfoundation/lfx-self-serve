// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';

import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeStepType,
  HealthMetricsMembersDataSectionKey,
  HealthMetricsMembersMovementDrawerCopy,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersMovements,
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

/** Reads a deep link waits for: each section's issue adds its key; `bridge` is the second read in `#tiers`. */
export const HEALTH_METRICS_MEMBERS_DATA_SECTIONS = ['tiers', 'bridge'] as const satisfies readonly HealthMetricsMembersDataSectionKey[];

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

/** Read-failed / no-foundation value: no steps, so the bridge renders no bars. */
export const HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED: HealthMetricsMembersBridge = { steps: [] };

/** Upper bound on bridge rows read: six per year, so a century of years. */
export const HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP = 600;

/** Every `MEMBERSHIP_WATERFALL` step in bar order, and the allowlist the bridge read keeps rows against. */
export const HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES = ['start_of_year', 'new', 'upgrade', 'downgrade', 'churned', 'today'] as const;

/** The movements a bar opens as a named list, and the allowlist the movements read validates against. */
export const HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES = ['new', 'upgrade', 'downgrade'] as const;

/** Read-failed value for a movement list. */
export const HEALTH_METRICS_MEMBERS_MOVEMENTS_UNMEASURED: HealthMetricsMembersMovements = { rows: [], totalRecords: 0 };

/** Rows per page of a movement list; the longest list today runs to several hundred. */
export const HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE = 25;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE = 100;

/** Bar labels in the design's order; the closing total's label depends on the year, so it is built. */
export const HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS: Record<Exclude<HealthMetricsMembersBridgeStepType, 'today'>, string> = {
  start_of_year: 'Start of year',
  new: 'New',
  upgrade: 'Upgrades',
  downgrade: 'Downgrades',
  churned: 'Churned',
};

/** Under the bridge: why it stands in for a total-members line. */
export const HEALTH_METRICS_MEMBERS_BRIDGE_FOOTER =
  "The bridge replaces PCC's total-members all-time line: it says why the number moved — adds, upgrades, downgrades and churn — rather than only that it did.";

/** Each movement drawer's copy, from the design's named lists. The from-tier is not in the data yet. */
export const HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY: Record<HealthMetricsMembersMovementListType, HealthMetricsMembersMovementDrawerCopy> = {
  new: {
    title: 'Joined this year',
    pastTitle: 'Joined in',
    subtitle: 'New memberships, largest dues first',
    note: "The dues column is annual. A new member's first 90 days predict whether they renew — worth checking that each one has attended something.",
    verb: 'joined',
  },
  upgrade: {
    title: 'Moved up a tier',
    pastTitle: 'Moved up a tier in',
    subtitle: 'Existing members who increased their commitment',
    note: 'Upgrades are the strongest signal a member is getting value. Worth understanding what changed for them — it is repeatable.',
    verb: 'moved up',
  },
  downgrade: {
    title: 'Moved down a tier',
    pastTitle: 'Moved down a tier in',
    subtitle: 'Reduced commitment — often a precursor to churn',
    note: 'A downgrade keeps the logo but loses the revenue, so logo churn misses it entirely. These accounts are the highest-value save opportunities.',
    verb: 'moved down',
  },
};
