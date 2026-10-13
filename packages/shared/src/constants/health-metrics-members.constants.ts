// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS } from './health-metrics-engagement.constants';

import type { FilterOption } from '../interfaces/filter.interface';
import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersAtRisk,
  HealthMetricsMembersAtRiskBucket,
  HealthMetricsMembersAtRiskFilterOption,
  HealthMetricsMembersBridge,
  HealthMetricsMembersBoardAttendance,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardCohortOption,
  HealthMetricsMembersBridgeStepType,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDepartures,
  HealthMetricsMembersChurnModeOption,
  HealthMetricsMembersChurnRisk,
  HealthMetricsMembersDataSectionKey,
  HealthMetricsMembersDirectory,
  HealthMetricsMembersDirectoryTierOption,
  HealthMetricsMembersEngagementLevel,
  HealthMetricsMembersMovementDrawerCopy,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersMovements,
  HealthMetricsMembersNps,
  HealthMetricsMembersNpsCategory,
  HealthMetricsMembersQueryParams,
  HealthMetricsMembersRenewals,
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMembersRenewalsWindowOption,
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
      "The full directory — PCC's most-used table, carried over with its columns intact and the engagement touchpoints added. Sorted by annual dues, highest first, so the accounts that carry the revenue lead; within a tier, least engaged first.",
    footnote:
      'This is the whole table at Level 2, not behind a drill-in — it is the most-used view in PCC, so it stays one click from the tab. PCC\'s Period column is replaced by Renews: the term start is rarely acted on, the end date always is. Contribution, Sponsorship, Training and Events show — where not yet tracked — a data gap reads as "not tracked", never as zero.',
    footnoteCaution: false,
  },
  {
    key: 'risk',
    label: 'At-risk & balance',
    heading: 'At-risk & outstanding balance',
    description: 'Act-now view. Sorted by dues at risk rather than days overdue — the money order, not the calendar order.',
    footnote:
      'Overdue balance and lapsed engagement together are the strongest churn predictor available today — which is why this sits above churn, not below it.',
    footnoteCaution: false,
  },
  {
    key: 'renewals',
    label: 'Renewals',
    heading: 'Renewals',
    description: 'The forward-looking view: what is up for renewal and what it is worth, while there is still time to act.',
    footnote:
      'Organization, tier, dues and renewal date come from the membership record — the term end date PCC shows as "Period". Renewal status (Confirmed / In discussion / Unconfirmed) is a CRM pipeline stage no system we read carries, so it is left out rather than every row reading Unconfirmed.',
    footnoteCaution: true,
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
export const HEALTH_METRICS_MEMBERS_DATA_SECTIONS = [
  'tiers',
  'bridge',
  'list',
  'risk',
  'renewals',
  'board',
  'nps',
  'churn',
] as const satisfies readonly HealthMetricsMembersDataSectionKey[];

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

/** The directory's filter, search and page state in the URL; each key is namespaced to the section. */
export const HEALTH_METRICS_MEMBERS_QUERY_PARAMS = {
  directoryTier: 'memTier',
  directoryNps: 'memNps',
  directorySearch: 'memSearch',
  directoryPage: 'memPage',
  atRiskBucket: 'riskBucket',
  atRiskPage: 'riskPage',
  renewalsWindow: 'renewalsWindow',
  renewalsPage: 'renewalsPage',
  boardCohort: 'boardCohort',
  boardPage: 'boardPage',
  npsAudience: 'npsAudience',
  churnMode: 'churnMode',
  churnPage: 'churnPage',
} as const satisfies Record<string, keyof HealthMetricsMembersQueryParams>;

/** `MEMBERSHIP_DIRECTORY`'s NPS categories, and the allowlist the directory read validates against. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES = ['Promoter', 'Passive', 'Detractor'] as const;

/** `MEMBERSHIP_DIRECTORY`'s own engagement bands; the page never re-bands the score. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS = ['High', 'Medium', 'Low'] as const;

/** The NPS filter; the empty value matches every member, with or without a response. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_OPTIONS: readonly FilterOption<string>[] = [
  { label: 'All NPS', value: '' },
  ...HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES.map((category) => ({ label: category, value: category })),
];

/** The tier filter's match-all option; the tiers themselves come from the read. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_ALL_TIERS_OPTION: FilterOption<string> = { label: 'All tiers', value: '' };

/** Shown, unselectable, under "All tiers" when the tier read failed, so the short list is not mistaken for none. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_TIERS_UNAVAILABLE_OPTION: HealthMetricsMembersDirectoryTierOption = {
  label: 'Tier list unavailable',
  value: '__tiers_unavailable__',
  disabled: true,
};

/** Read-failed / no-foundation value: no members, so the section renders no rows. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_UNMEASURED: HealthMetricsMembersDirectory = {
  rows: [],
  totalRecords: 0,
  scopeTotal: 0,
  atRiskCount: 0,
};

/** Rows per page, and the design's rows-per-page choices; the largest foundation has several hundred members. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE = 10;

export const HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_PAGE_SIZE = 100;

export const HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH = 100;

/** Longest tier name the filter accepts; the view's column is far wider than any real tier. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_TIER_LENGTH = 200;

export const HEALTH_METRICS_MEMBERS_DIRECTORY_SEARCH_DEBOUNCE_MS = 200;

/** Upper bound on the tier options read; a foundation has a handful. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_OPTION_CAP = 100;

/** One pill style for every tier, as the design draws it. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_PILL_CLASS = 'bg-blue-50 text-blue-700';

/** NPS chips after the member's name. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CHIP_CLASSES: Record<HealthMetricsMembersNpsCategory, string> = {
  Promoter: 'bg-emerald-50 text-emerald-700',
  Passive: 'bg-gray-100 text-gray-500',
  Detractor: 'bg-red-50 text-red-700',
};

/** Engagement band dots. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_DOT_CLASSES: Record<HealthMetricsMembersEngagementLevel, string> = {
  High: 'bg-emerald-600',
  Medium: 'bg-amber-600',
  Low: 'bg-red-600',
};

/** Hover text on a not-tracked cell. */
export const HEALTH_METRICS_MEMBERS_DIRECTORY_NOT_TRACKED = 'Not tracked yet for this foundation';

/** `MEMBERSHIP_AT_RISK`'s buckets past 60 days, oldest last; the section leaves out balances under 60 days. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS = ['60_89_days', '90_plus_days'] as const;

/** The design's label for each aging bucket, on its pill and its aging bar. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_LABELS: Record<HealthMetricsMembersAtRiskBucket, string> = {
  '60_89_days': '60–89 days',
  '90_plus_days': '90+ days',
};

/** The bucket pills over the hero; the first is the default. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS: readonly HealthMetricsMembersAtRiskFilterOption[] = [
  { id: 'all', label: 'All at risk' },
  ...HEALTH_METRICS_MEMBERS_AT_RISK_BUCKETS.map((bucket) => ({ id: bucket, label: HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_LABELS[bucket] })),
];

/** `MEMBERSHIP_AT_RISK`'s `churn_risk` bands, highest first. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_CHURN_RISKS = ['High', 'Medium', 'Low'] as const;

/** Each churn-risk chip's colours, applied via `[class]`. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_CHURN_RISK_CLASSES: Record<HealthMetricsMembersChurnRisk, string> = {
  High: 'bg-red-50 text-red-700',
  Medium: 'bg-amber-50 text-amber-700',
  Low: 'bg-gray-100 text-gray-500',
};

/** Read-failed / no-foundation value: no members, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_UNMEASURED: HealthMetricsMembersAtRisk = {
  rows: [],
  totalRecords: 0,
  summary: { outstandingBalanceUsd: 0, highRiskBalanceUsd: 0, mediumRiskBalanceUsd: 0, memberCount: 0 },
  aging: [],
};

/** Rows per page; the busiest foundation has under a hundred members at risk. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_PAGE_SIZE = 10;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_MAX_PAGE_SIZE = 100;

/** The aging bars' fill. */
export const HEALTH_METRICS_MEMBERS_AT_RISK_BAR_CLASS = 'bg-red-600';

/** Read-failed / no-foundation value: no renewals, and no figures rather than zeros. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_UNMEASURED: HealthMetricsMembersRenewals = {
  rows: [],
  totalRecords: 0,
  summary: { renewalCount: null, valueUsd: null, withoutDuesCount: null },
};

/** `MEMBERSHIP_RENEWALS`' windows, one per `is_renewing_*` flag; the first is the default. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS = ['90_days', '180_days', 'this_year'] as const;

/** The window pills over the hero. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_OPTIONS: readonly HealthMetricsMembersRenewalsWindowOption[] = [
  { id: '90_days', label: 'Next 90 days' },
  { id: '180_days', label: 'Next 180 days' },
  { id: 'this_year', label: 'This year' },
];

/** Each window as the empty state phrases it, e.g. "No renewals in the next 90 days". */
export const HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_PHRASES: Record<HealthMetricsMembersRenewalsWindow, string> = {
  '90_days': 'in the next 90 days',
  '180_days': 'in the next 180 days',
  this_year: 'this year',
};

/** Rows per page; the busiest foundation has around a hundred renewals in the window. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_PAGE_SIZE = 10;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_MAX_PAGE_SIZE = 100;

/** The MEM-02 marker beside a renewing member with an outstanding balance, in the Needs action colour. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_BALANCE_MARKER = {
  label: 'Balance outstanding',
  icon: 'fa-light fa-circle-exclamation',
  textClass: 'text-red-600',
} as const;

/** The marker beside a member who already renewed; the model's window totals still count the renewal. */
export const HEALTH_METRICS_MEMBERS_RENEWALS_RENEWED_MARKER = {
  label: 'Renewed',
  icon: 'fa-light fa-circle-check',
  textClass: 'text-emerald-700',
} as const;

/** `MEMBERSHIP_BOARD_ATTENDANCE`'s cohorts; the first is the default. */
export const HEALTH_METRICS_MEMBERS_BOARD_COHORTS = ['board', 'voting_members'] as const;

/** The cohort toggle over the hero. */
export const HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS: readonly HealthMetricsMembersBoardCohortOption[] = [
  { id: 'board', label: 'Board' },
  { id: 'voting_members', label: 'Voting members' },
];

/** The meeting noun in each cohort's hero caption. */
export const HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS: Record<HealthMetricsMembersBoardCohort, string> = {
  board: 'board meeting',
  voting_members: 'voting meeting',
};

/** Read-failed / no-foundation value: no cohorts measured, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_BOARD_ATTENDANCE_UNMEASURED: HealthMetricsMembersBoardAttendance = {
  cohorts: { board: null, voting_members: null },
  trend: [],
  rows: [],
  totalRecords: 0,
};

/** Rows per page of the meetings table. */
export const HEALTH_METRICS_MEMBERS_BOARD_PAGE_SIZE = 10;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_BOARD_MAX_PAGE_SIZE = 100;

/** Meetings the attendance chart plots: the latest twelve in the period, oldest first. */
export const HEALTH_METRICS_MEMBERS_BOARD_TREND_MEETINGS = 12;

/** Where "see who" lands: Engagement's representatives, cut to those who never attended. */
export const HEALTH_METRICS_MEMBERS_BOARD_NEVER_ATTENDED_LINK = {
  route: 'engagement',
  fragment: 'reps',
  queryParams: { [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.repFilter]: 'never' },
} as const;

/** Read-failed / no-foundation value: no audience surveyed, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_NPS_UNMEASURED: HealthMetricsMembersNps = {
  audiences: [],
  selectedAudience: null,
  trend: [],
};

/** Audiences the toggle leads with, in order; the rest follow alphabetically. */
export const HEALTH_METRICS_MEMBERS_NPS_LEADING_AUDIENCES = ['Board', 'Maintainers'] as const;

/** Longest audience name a caller may pass; the view's names are far shorter. */
export const HEALTH_METRICS_MEMBERS_NPS_MAX_AUDIENCE_LENGTH = 100;

/** Below this whole-percent response rate, a score is not a foundation-wide signal. */
export const HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT = 40;

/** A response-rate fall of at least this many points makes a rising score unproven; a smaller one is noise. */
export const HEALTH_METRICS_MEMBERS_NPS_RATE_DROP_PP = 5;

/** The response distribution's segments, left to right, with non-responses last at full weight. */
export const HEALTH_METRICS_MEMBERS_NPS_SEGMENTS = [
  { key: 'promoters', label: 'Promoters', colorClass: 'bg-emerald-600' },
  { key: 'passives', label: 'Passives', colorClass: 'bg-amber-600' },
  { key: 'detractors', label: 'Detractors', colorClass: 'bg-red-600' },
  { key: 'noResponse', label: 'No response', colorClass: 'bg-gray-200' },
] as const;

/** Read-failed / no-foundation value: no churn rows, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_CHURN_UNMEASURED: HealthMetricsMembersChurn = { years: [], tiers: [] };

/** The toggle over the hero; revenue churn leads. */
export const HEALTH_METRICS_MEMBERS_CHURN_MODE_OPTIONS: readonly HealthMetricsMembersChurnModeOption[] = [
  { id: 'revenue', label: 'Revenue churn' },
  { id: 'logo', label: 'Logo churn' },
];

/** Upper bound on churn rows read: the busiest foundation has around a hundred, about nine a year. */
export const HEALTH_METRICS_MEMBERS_CHURN_ROW_CAP = 1000;

/** Years the trend plots, ending at the selected one. */
export const HEALTH_METRICS_MEMBERS_CHURN_TREND_YEARS = 4;

/** A tier churn rate (percent) at or above this renders in the Needs action colour. */
export const HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT = 25;

/** The share-of-loss bar fill. */
export const HEALTH_METRICS_MEMBERS_CHURN_SHARE_BAR_CLASS = 'bg-red-600';

/** Read-failed value for "Who left". */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED: HealthMetricsMembersChurnDepartures = { rows: [], totalRecords: 0 };

/** Rows per page of "Who left". */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE = 25;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_MAX_PAGE_SIZE = 100;
