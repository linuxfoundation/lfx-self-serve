// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { buildHealthMetricsYearOptions } from './dashboard-metrics.constants';
import { HEALTH_METRICS_BASE_PATH } from './health-metrics-engagement.constants';

import type { HealthMetricsYearOption } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsOverviewEmptyCopy, HealthMetricsOverviewExploreLink } from '../interfaces/health-metrics-overview.interface';

/**
 * Period selector — the 4 most recent options from {@link buildHealthMetricsYearOptions} (3 completed years
 * plus YTD), the periods every Health Metrics view carries columns for. Call fresh per use, so the labels
 * stay correct across a calendar-year rollover in a long-running SSR process.
 */
export function buildHealthMetricsOverviewPeriods(): HealthMetricsYearOption[] {
  return buildHealthMetricsYearOptions().slice(-4);
}

/** The NPS audience the Overview card reports; the Members tab leads with the same one. */
export const HEALTH_METRICS_OVERVIEW_NPS_AUDIENCE = 'Board';

/** The board attendance cohort the Overview card reports. */
export const HEALTH_METRICS_OVERVIEW_BOARD_COHORT = 'board';

/** The periods the participating orgs view splits by engagement; the others read `null`. */
export const HEALTH_METRICS_OVERVIEW_ENGAGEMENT_SPLIT_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR'];

/** Events read per Overview list (upcoming, past); one past it flags a truncated read. */
export const HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP = 1000;

/** Board members read for the Overview table; one past it flags a truncated read. */
export const HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP = 500;

/** Each card's title and the info tooltip beside it. */
export const HEALTH_METRICS_OVERVIEW_CARDS = {
  orgs: { title: 'Participating organizations', info: 'Organizations with an active or lapsed membership in this period' },
  nps: { title: 'Net Promoter Score', info: 'Share of promoters minus share of detractors' },
  churn: { title: 'Membership churn', info: 'Memberships that did not renew, by tier' },
  balance: { title: 'Outstanding balance', info: 'Unpaid membership invoices past their due date' },
  events: { title: 'Events', info: 'The data here corresponds to the selected time period at the top right of the page.\n\n(Source: Salesforce)' },
  training: { title: 'Training and certification', info: 'Enrollments and revenue from LF Education' },
  code: { title: 'Code contribution', info: "Contributors across the foundation's repositories" },
  board: { title: 'Board meeting participation', info: 'Attendance of board members at governing board meetings' },
} as const;

/** The circle behind an empty state's icon, grey by default and green for good news. */
const EMPTY_NEUTRAL = { circleClass: 'bg-gray-50', iconClass: 'text-gray-400' } as const;

/** Each card's empty state. */
export const HEALTH_METRICS_OVERVIEW_EMPTY_COPY = {
  orgs: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-building',
    title: 'No participating organizations yet',
    text: 'Members and non-members appear here once organizations join the foundation or take part in its activities.',
  },
  nps: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-face-smile',
    title: 'No survey results yet',
    text: 'The score appears after the first member satisfaction survey closes.',
  },
  churn: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-arrow-trend-down',
    title: 'No churn to report',
    text: 'No memberships lapsed in this period, so there is nothing to compare by tier.',
  },
  balance: {
    circleClass: 'bg-emerald-50',
    iconClass: 'text-emerald-700',
    icon: 'fa-light fa-circle-check',
    title: 'All invoices are paid',
    text: 'No member has an invoice more than 60 days overdue.',
  },
  events: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-calendar',
    title: 'No events in this period',
    text: 'Registrations, sponsorship and speaking proposals show here once the foundation runs an event.',
  },
  training: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-graduation-cap',
    title: 'No enrollments yet',
    text: 'Enrollments and revenue from courses, exams and edX appear here once learners sign up.',
  },
  code: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-code-branch',
    title: 'No contribution data yet',
    text: 'Connect the foundation’s repositories in LFX Insights to see contributors.',
  },
  board: {
    ...EMPTY_NEUTRAL,
    icon: 'fa-light fa-users',
    title: 'No board meetings recorded yet',
    text: 'Attendance shows here once the governing board meets, or when you add a past meeting.',
  },
} as const satisfies Record<keyof typeof HEALTH_METRICS_OVERVIEW_CARDS, HealthMetricsOverviewEmptyCopy>;

/** The balance card's empty state when no balance was measured, so the card claims nothing is paid. */
export const HEALTH_METRICS_OVERVIEW_BALANCE_UNMEASURED_COPY: HealthMetricsOverviewEmptyCopy = {
  ...EMPTY_NEUTRAL,
  icon: 'fa-light fa-file-invoice-dollar',
  title: 'No balance data yet',
  text: 'Overdue membership invoices appear here once the foundation’s billing data is available.',
};

/** A card's error state; the read failed, so nothing it would show can be trusted. */
export const HEALTH_METRICS_OVERVIEW_ERROR_COPY: HealthMetricsOverviewEmptyCopy = {
  ...EMPTY_NEUTRAL,
  icon: 'fa-light fa-triangle-exclamation',
  title: 'Unavailable right now',
  text: 'We could not load this card. Refresh the page to try again.',
};

/** The "Explore …" links into each Level 2 section; each clears that section's filters on arrival. */
export const HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS = {
  members: {
    label: 'Explore All Members',
    commands: [HEALTH_METRICS_BASE_PATH, 'members'],
    fragment: 'list',
    queryParams: { memTier: null, memNps: null, memSearch: null, memPage: null },
  },
  nonMembers: {
    label: 'Explore Company Participation',
    commands: [HEALTH_METRICS_BASE_PATH, 'non-members'],
    fragment: 'orgs',
    queryParams: { nonFit: null, nonSearch: null, nonPage: null },
  },
  nps: { label: 'Explore Satisfaction (NPS)', commands: [HEALTH_METRICS_BASE_PATH, 'members'], fragment: 'nps', queryParams: { npsAudience: 'Board' } },
  churn: {
    label: 'Explore Membership Churn',
    commands: [HEALTH_METRICS_BASE_PATH, 'members'],
    fragment: 'churn',
    queryParams: { churnMode: null, churnPage: null },
  },
  balance: {
    label: 'Explore At-Risk & Balance',
    commands: [HEALTH_METRICS_BASE_PATH, 'members'],
    fragment: 'risk',
    queryParams: { riskBucket: null, riskPage: null },
  },
  pastEvents: { label: 'Explore Past Events', commands: [HEALTH_METRICS_BASE_PATH, 'events'], fragment: 'past', queryParams: {} },
  speakers: { label: 'Explore Speakers & Proposals', commands: [HEALTH_METRICS_BASE_PATH, 'events'], fragment: 'spk', queryParams: {} },
  training: { label: 'Explore Enrollment & Revenue', commands: [HEALTH_METRICS_BASE_PATH, 'training'], fragment: 'enroll', queryParams: {} },
} as const satisfies Record<string, HealthMetricsOverviewExploreLink>;

/** The design's purple for maintainers and this year's registrations; no `lfxColors` scale carries it. */
export const HEALTH_METRICS_OVERVIEW_PURPLE = '#AD46FF';

/** Fills for dots, bars and legend swatches, applied via `[class]`. */
export const HEALTH_METRICS_OVERVIEW_FILL_CLASSES = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-400',
  low: 'bg-red-400',
  muted: 'bg-gray-300',
  blue: 'bg-blue-500',
  purple: 'bg-[#AD46FF]',
} as const;

/** The same tones as SVG strokes, for the donut, gauge, training arc and trend chart. */
export const HEALTH_METRICS_OVERVIEW_STROKES = {
  high: lfxColors.emerald[500],
  medium: lfxColors.amber[400],
  low: lfxColors.red[400],
  track: lfxColors.gray[100],
  progress: lfxColors.blue[500],
  needle: lfxColors.gray[900],
  gridline: lfxColors.gray[100],
  baseline: lfxColors.gray[200],
  lastYear: lfxColors.gray[400],
  today: lfxColors.gray[300],
  thisYear: HEALTH_METRICS_OVERVIEW_PURPLE,
} as const;

/** The forecast range band behind the predicted line: the progress blue at 10%. */
export const HEALTH_METRICS_OVERVIEW_TREND_BAND_FILL = `${lfxColors.blue[500]}1A`;

/** An upcoming event's `comp_score` → its registrations bar; an unknown or empty score keeps the neutral blue. */
export const HEALTH_METRICS_OVERVIEW_EVENT_PACE_FILLS = {
  high: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high,
  medium: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium,
  low: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low,
} as const;

/** A past event's registrations against its goal: at or above the first share green, the second amber, else red. */
export const HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES = { onTrack: 1, atRisk: 0.8 } as const;

/** The status legend beside the event list; the registrations bar's fill carries the same three tones. */
export const HEALTH_METRICS_OVERVIEW_EVENT_LEGEND = [
  { key: 'on-track', label: 'On track', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
  { key: 'at-risk', label: 'At risk', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium },
  { key: 'action', label: 'Action required', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low },
] as const;

/** The upcoming share of the total events bar: the purple hatched over its lightest tint. */
export const HEALTH_METRICS_OVERVIEW_UPCOMING_HATCH = `repeating-linear-gradient(135deg, ${HEALTH_METRICS_OVERVIEW_PURPLE} 0 2px, ${lfxColors.violet[100]} 2px 5px)`;

/** The events card's tooltips. */
export const HEALTH_METRICS_OVERVIEW_EVENTS_INFO = {
  total:
    'Total past and upcoming events that had their start date in the selected time period or have their start date in the future and are open for registrations.\n\n(Source: Salesforce)',
  sponsorship: 'Total received sponsorship for all events in the selected period.\n\n(Source: Salesforce)',
  upcoming: 'All events that have their start date in the future and are open for registrations.\n\n(Source: Salesforce)',
  past: 'All events that had their start date in the selected time period.\n\n(Source: Salesforce)',
  registrations: 'Total number of registrations for the event.\n\n(Source: Cvent)',
  talks: 'Accepted speaking proposals out of all proposals for the event. CFP In Review shows while proposals are being reviewed.\n\n(Source: Sessionize)',
} as const;

/** Events shown before "View all". */
export const HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE = 5;

/** The registration trend's window: days before the event at the chart's left edge. */
export const HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS = 180;

/** Board attendance at or above this share draws green; above zero amber, zero red. */
export const HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE = 0.67;
