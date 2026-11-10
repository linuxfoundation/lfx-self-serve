// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_EMPTY_SOURCES } from './health-metrics-l2.constants';
import { lfxColors } from './colors.constants';
import {
  HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE,
  HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
} from './health-metrics-engagement.constants';

import type { FilterOption } from '../interfaces/filter.interface';
import type { HealthMetricsEngagementAttendanceRule } from '../interfaces/health-metrics-engagement.interface';
import type { HealthMetricsFootnotePart, HealthMetricsL2Blank, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersAtRisk,
  HealthMetricsMembersAtRiskBucket,
  HealthMetricsMembersAtRiskFilterOption,
  HealthMetricsMembersBreakdownTableClasses,
  HealthMetricsMembersBoardAttendance,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardLatestTone,
  HealthMetricsMembersBoardCohortOption,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDepartures,
  HealthMetricsMembersChurnModeOption,
  HealthMetricsMembersDataSectionKey,
  HealthMetricsMembersDirectory,
  HealthMetricsMembersDirectoryTierOption,
  HealthMetricsMembersEngagementLevel,
  HealthMetricsMembersGrowth,
  HealthMetricsMembersNps,
  HealthMetricsMembersNpsCategory,
  HealthMetricsMembersQueryParams,
  HealthMetricsMembersRenewals,
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMembersReservedTier,
  HealthMetricsMembersTierIcon,
  HealthMetricsMembersRenewalsWindowOption,
  HealthMetricsMembersTiers,
} from '../interfaces/health-metrics-members.interface';

/**
 * The eight Members sections in render order. `key` is the section's URL fragment and the scroll-spy
 * allowlist; the DOM id is `sec-mem-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_MEMBERS_SECTIONS = [
  {
    key: 'growth',
    // One read serves every period, so the empty state never names a past year.
    empty: { icon: 'fa-light fa-chart-line', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members, snapshot: true },
    label: 'Member growth by year',
    heading: 'Member growth by year',
    description: 'New members each month, this year against last year.',
    footnote: [],
    footnoteCaution: false,
  },
  {
    key: 'breakdown',
    empty: { icon: 'fa-light fa-building', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Membership breakdown by tier',
    heading: 'Membership breakdown by tier',
    // `{year}` is the running year, filled in by `buildHealthMetricsMembersSections`.
    description: 'Members per tier at each year end. {year} is year to date.',
    footnote: [],
    footnoteCaution: false,
  },
  {
    key: 'list',
    empty: { icon: 'fa-light fa-building', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'All members',
    heading: 'All members',
    description:
      "The full directory — PCC's most-used table, carried over with its columns intact and the engagement touchpoints added. Sorted by annual dues, highest first, so the accounts that carry the revenue lead; within a tier, least engaged first.",
    footnote: [
      { text: 'This is the ' },
      { text: 'whole table at Level 2', bold: true },
      { text: ", not behind a drill-in — it is the most-used view in PCC, so it stays one click from the tab. PCC's " },
      { text: 'Period', bold: true },
      { text: ' column is replaced by ' },
      { text: 'Renews', bold: true },
      {
        text: ': the term start is rarely acted on, the end date always is. Contribution, Sponsorship, Training and Events show — where not yet tracked — a data gap reads as "not tracked", never as zero.',
      },
    ],
    footnoteCaution: false,
  },
  {
    key: 'risk',
    empty: { icon: 'fa-light fa-file-invoice-dollar', source: HEALTH_METRICS_L2_EMPTY_SOURCES.invoice, snapshot: true },
    label: 'At-risk & balance',
    heading: 'At-risk & outstanding balance',
    description: 'Act-now view. Sorted by dues at risk rather than days overdue — the ED needs the money order, not the calendar order.',
    footnote: [
      {
        text: 'Overdue balance and lapsed engagement together are the strongest churn predictor available today — which is why this sits above churn, not below it.',
      },
    ],
    footnoteCaution: false,
  },
  {
    key: 'renewals',
    empty: { icon: 'fa-light fa-arrow-trend-down', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Renewals',
    heading: 'Renewals',
    description: 'The forward-looking view: what is up for renewal and what it is worth, while there is still time to act.',
    footnote: [
      { text: 'Organization, tier, dues and renewal date', bold: true },
      {
        text: ' come from the membership record — the term end date PCC shows as "Period". Renewal status (Confirmed / In discussion / Unconfirmed) is a CRM pipeline stage no system we read carries, so it is left out rather than every row reading Unconfirmed.',
      },
    ],
    footnoteCaution: true,
  },
  {
    key: 'board',
    empty: { icon: 'fa-light fa-users-rectangle', source: HEALTH_METRICS_L2_EMPTY_SOURCES.board },
    label: 'Board & voting attendance',
    heading: 'Board & voting-member attendance',
    description:
      'Governance participation. This lives in Members rather than Engagement because it sits next to dues and renewals — an unused board seat is a paid benefit going to waste.',
    footnote: [],
    footnoteCaution: false,
  },
  {
    key: 'nps',
    empty: { icon: 'fa-light fa-clipboard-list', source: HEALTH_METRICS_L2_EMPTY_SOURCES.survey },
    label: 'Satisfaction (NPS)',
    heading: 'Satisfaction (NPS)',
    description:
      'Deliberately low in this section — NPS moves once a quarter at most, so it is context rather than a signal to act on. Non-responses are shown at full weight.',
    footnote: [],
    footnoteCaution: false,
  },
  {
    key: 'churn',
    empty: { icon: 'fa-light fa-arrow-trend-down', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Membership churn',
    heading: 'Membership churn',
    description:
      'Lagging by definition and deliberately last: it reports members already gone. Revenue churn leads — logo churn counts a top-tier and an entry-tier loss as one each.',
    footnote: [],
    footnoteCaution: false,
  },
] as const satisfies readonly HealthMetricsL2Section[];

/** The tab's blank card, shown in place of every section when none has data for the period. */
export const HEALTH_METRICS_MEMBERS_BLANK: HealthMetricsL2Blank = {
  icon: 'fa-light fa-building',
  noun: 'member',
  lead: 'Member details appear once organizations hold an active membership with the foundation.',
  reasons: ['The foundation may be newly launched', 'Memberships may not be linked to it yet', 'Your Program Manager can check membership records'],
  pastActivity: 'membership',
};

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX = 'sec-mem-';

/** Reads a deep link waits for: each section's issue adds its key. */
export const HEALTH_METRICS_MEMBERS_DATA_SECTIONS = [
  'growth',
  'breakdown',
  'list',
  'risk',
  'renewals',
  'board',
  'nps',
  'churn',
] as const satisfies readonly HealthMetricsMembersDataSectionKey[];

/** Read-failed / no-foundation value: no month rows, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED: HealthMetricsMembersGrowth = { months: [] };

/** The earliest year read; the chart draws at most one line per colour, newest first. */
export const HEALTH_METRICS_MEMBERS_GROWTH_FIRST_YEAR = 2017;

/** Upper bound on month rows read: 12 a year, from the first year on, with decades to spare. */
export const HEALTH_METRICS_MEMBERS_GROWTH_ROW_CAP = 600;

/** The plot's SVG viewBox, stretched to the card; January and December sit `insetX` in from each edge. */
export const HEALTH_METRICS_MEMBERS_GROWTH_PLOT = { width: 1000, height: 300, insetX: 40 } as const;

/** One colour per year, newest first: this year in accent, then the design's palette. */
export const HEALTH_METRICS_MEMBERS_GROWTH_LINE_COLORS = [
  lfxColors.blue[500],
  lfxColors.violet[400],
  lfxColors.emerald[400],
  lfxColors.amber[400],
  lfxColors.red[400],
  lfxColors.gray[400],
  lfxColors.violet[300],
  lfxColors.emerald[300],
  lfxColors.amber[300],
  lfxColors.red[300],
] as const;

/** Read-failed / no-foundation value: no tier rows, so the section renders no figures. */
export const HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED: HealthMetricsMembersTiers = { rows: [] };

/** Upper bound on tier rows read; the busiest foundation has around a hundred. */
export const HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP = 500;

/** The first year the breakdown shows; a foundation that started later starts at its own first year. */
export const HEALTH_METRICS_MEMBERS_BREAKDOWN_FIRST_YEAR = 2019;

/** The tiers with an icon of their own. */
export const HEALTH_METRICS_MEMBERS_RESERVED_TIERS = ['diamond', 'platinum', 'gold', 'silver'] as const;

/** How a reserved tier reads, whatever the foundation's spelling of it. */
export const HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS: Record<HealthMetricsMembersReservedTier, string> = {
  diamond: 'Diamond',
  platinum: 'Platinum',
  gold: 'Gold',
  silver: 'Silver',
};

/**
 * The tier icons as the design draws them: a gradient cut to a diamond (Diamond, Platinum) or a ring (Gold, Silver).
 * The Platinum gradient is the design's darker one.
 */
export const HEALTH_METRICS_MEMBERS_TIER_ICONS: Record<HealthMetricsMembersReservedTier, HealthMetricsMembersTierIcon> = {
  diamond: {
    // Platinum's shape in purple; the design's deep stop has no palette token.
    background: `linear-gradient(135deg, ${lfxColors.violet[400]} 0%, ${lfxColors.violet[900]} 40%, ${lfxColors.violet[300]} 58%, #2F0D68 85%, ${lfxColors.violet[800]} 100%)`,
    mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6 14.4 8 8 14.4 1.6 8Z' fill='none' stroke='%23000' stroke-width='2.2' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat`,
    radius: '0',
  },
  platinum: {
    background: `linear-gradient(135deg, ${lfxColors.gray[500]} 0%, ${lfxColors.gray[800]} 40%, ${lfxColors.gray[400]} 58%, ${lfxColors.gray[900]} 85%, ${lfxColors.gray[700]} 100%)`,
    mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6 14.4 8 8 14.4 1.6 8Z' fill='none' stroke='%23000' stroke-width='2.2' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat`,
    radius: '0',
  },
  gold: {
    // The ring's highlights have no palette tokens.
    background: 'conic-gradient(from 45deg, #FDE68A, #D08700, #FFF1B8, #A65F00, #FDE68A)',
    mask: 'radial-gradient(circle closest-side, transparent 52%, #000 56%)',
    radius: '9999px',
  },
  silver: {
    background: 'conic-gradient(from 45deg, #F4F4F5, #A1A1AA, #FAFAFA, #71717A, #F4F4F5)',
    mask: 'radial-gradient(circle closest-side, transparent 52%, #000 56%)',
    radius: '9999px',
  },
};

/** Room a column's popup needs on its right before it opens on the left; the design caps the popup at 280px. */
export const HEALTH_METRICS_MEMBERS_CHART_TIP_ROOM_PX = 292;

/**
 * The breakdown table's classes: row labels and value cells by kind, the striped and total fills, and the rules
 * between cells. Applied via [class], so Tailwind's safelist carries them.
 */
export const HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES: HealthMetricsMembersBreakdownTableClasses = {
  label: {
    tier: 'text-[13px] font-medium text-gray-900',
    total: 'text-[13px] font-semibold text-gray-900',
  },
  cell: {
    tier: 'text-[13px] font-normal text-gray-900',
    total: 'text-[13px] font-semibold text-gray-900',
  },
  stripe: 'bg-gray-50',
  totalFill: 'bg-blue-100',
  cellBase: 'flex min-w-0 items-center justify-end whitespace-nowrap px-[10px] py-[11px] leading-[18px]',
  rowRule: 'border-b border-[color:var(--ui-neutral-alpha-100)]',
  cellRule: 'border-l border-[color:var(--ui-neutral-alpha-100)]',
  totalRule: 'border-t border-gray-900',
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

/** Each cohort's attendance rule: the board's (ENG-01), and voting members as another voting group (ENG-03). */
export const HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES: Record<HealthMetricsMembersBoardCohort, HealthMetricsEngagementAttendanceRule> = {
  board: HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE,
  voting_members: HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE,
};

/** The hero caption's suffix when the latest meeting is below its cohort's rule; the board's is the design's. */
export const HEALTH_METRICS_MEMBERS_BOARD_BELOW_LEVEL_CAPTIONS: Record<HealthMetricsMembersBoardCohort, string> = {
  board: 'below the ~100% this should be',
  voting_members: `below the ${Math.round(HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE.threshold * 100)}% a voting group needs`,
};

/** The trend's latest bar: red or amber below the cohort's rule, the accent otherwise. */
export const HEALTH_METRICS_MEMBERS_BOARD_LATEST_BAR_COLORS: Record<HealthMetricsMembersBoardLatestTone, string> = {
  critical: lfxColors.red[600],
  low: lfxColors.amber[500],
  ok: lfxColors.blue[500],
};

/** The hero value's colour: red or amber below the cohort's rule, ink otherwise. */
export const HEALTH_METRICS_MEMBERS_BOARD_LATEST_TEXT_CLASS: Record<HealthMetricsMembersBoardLatestTone, string> = {
  critical: 'text-red-600',
  low: 'text-amber-600',
  ok: 'text-gray-900',
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

/** Below this whole-percent response rate the sample is too small to trust the score (NPS-04). */
export const HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT = 35;

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

/** Under the churn trend: why churn leads rather than renewal rate. */
export const HEALTH_METRICS_MEMBERS_CHURN_FOOTER: readonly HealthMetricsFootnotePart[] = [
  {
    text: 'Renewal rate is unreliable mid-year because renewals are lumpy, so churn leads instead. Not on the landing page at all — it is an outcome, not a decision.',
  },
];

/** Read-failed value for "Who left". */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_UNMEASURED: HealthMetricsMembersChurnDepartures = { rows: [], totalRecords: 0 };

/** Rows per page of "Who left". */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_PAGE_SIZE = 25;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_MEMBERS_CHURN_DEPARTURES_MAX_PAGE_SIZE = 100;
