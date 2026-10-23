// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  events: { title: 'Events', info: 'Events run by this foundation in the period' },
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

/** Fills for dots, bars and legend swatches, applied via `[class]`. */
export const HEALTH_METRICS_OVERVIEW_FILL_CLASSES = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-400',
  low: 'bg-red-400',
  muted: 'bg-gray-300',
  blue: 'bg-blue-500',
  purple: 'bg-[#AD46FF]',
} as const;

/** Status pills for upcoming (pace against last year) and past (outcome against the goal) events. */
export const HEALTH_METRICS_OVERVIEW_BADGE_CLASSES = {
  good: 'bg-emerald-50 text-emerald-700',
  watch: 'bg-amber-50 text-amber-700',
  nearMiss: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-700',
} as const;

/** The same tones as SVG strokes, for the donut, gauge and trend chart. */
export const HEALTH_METRICS_OVERVIEW_STROKES = {
  high: '#00BC7D',
  medium: '#FFB900',
  low: '#FF6467',
  track: '#F1F5F9',
} as const;

/** An upcoming event's `comp_score` → its pill and bar. An unknown or empty score draws neither. */
export const HEALTH_METRICS_OVERVIEW_EVENT_PACE = {
  high: { label: 'On track', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.good, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
  medium: { label: 'At risk', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.watch, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium },
  low: { label: 'Action required', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.bad, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low },
} as const;

/** A past event's outcome → its pill and bar; the labels match the Events tab's past section. */
export const HEALTH_METRICS_OVERVIEW_EVENT_OUTCOME = {
  hit: { label: 'Hit goal', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.good, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
  'near-miss': { label: 'Just missed', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.nearMiss, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium },
  missed: { label: 'Missed goal', badgeClass: HEALTH_METRICS_OVERVIEW_BADGE_CLASSES.bad, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low },
} as const;

/** Events shown before "Load more", and how many each click adds. */
export const HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE = 5;

/** The registration trend's window: days before the event at the chart's left edge. */
export const HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS = 180;

/** Board attendance at or above this share draws green; above zero amber, zero red. */
export const HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE = 0.67;
