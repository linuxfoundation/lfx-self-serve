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

/** Each card's title and its tooltip, in the PCC copy. */
export const HEALTH_METRICS_OVERVIEW_CARDS = {
  orgs: {
    title: 'Participating organizations',
    info: 'Engagement scores are calculated for every participating organization, classifying them into three distinct levels: low, medium, and high engagement. These scores are derived from nine engagement areas:\n\n1. Board Meeting Attendance (Source: Attendance Record in PCC)\n2. Event Attendance (Source: Cvent)\n3. Code Contribution (Source: Insights)\n4. Mailing List Contributions (Source: Groups.io)\n5. Training and Certification (Source: Thought Industries)\n6. Event Sponsorship (Source: Salesforce)\n7. Corporate Training Purchases (Source: Salesforce)\n8. Speaking Proposal Submissions (Source: Sessionize)\n9. Satisfaction Levels (Source: NPS surveys in PCC)',
  },
  nps: {
    title: 'Net Promoter Score',
    info: 'The Net Promoter Score (NPS) is derived from the most recent NPS survey conducted. It is calculated by taking the difference between the percentage of promoters and the percentage of demoters.\n\nTypically, an NPS score exceeding 30 is widely considered to be an excellent rating.\n\n(Source: NPS Survey in PCC)',
  },
  churn: {
    title: 'Membership churn',
    info: 'The data here corresponds to the selected time period at the top right of the page.\n\nPlease note that all metrics in this section exclude free membership accounts and “Downgrades” are included in Lost Members.\n\n(Source: Salesforce)',
  },
  balance: {
    title: 'Outstanding balance',
    info: 'Outstanding Balance:\nUSD amount that is overdue from your members.\n(Source: NetSuite)\n\nMedium Risk:\nUSD amount that is currently between 60 and 89 days overdue from your members\n(Source: NetSuite)\n\nHigh Risk:\nUSD amount that is currently overdue for 90 days and more from your members, This amount also includes members that have indicated not to renew their membership independent from their invoice status.\n(Source: NetSuite)',
  },
  events: {
    title: 'Events',
    info: 'The data here corresponds to the selected time period at the top right of the page.\n\nYou can set and edit your annual goals for sponsorship and each upcoming event by clicking on the set goal link or edit icon.\n\n(Source: Salesforce)',
  },
  training: {
    title: 'Training and certification',
    info: 'The data here corresponds to the selected time period at the top right of the page.\n\nYou can switch between enrollments and revenue and set or edit your annual goals for number of enrollments and revenue, respectively.\n\n(Source: Thought Industries)',
  },
  code: {
    title: 'Code contribution',
    info: 'The data here corresponds to the selected time period at the top right of the page and originates from LFX Insights.\n\nAll percentage comparisons are against previous period’s figures.\n\n(Source: Insights)',
  },
  board: {
    title: 'Board meeting participation',
    info: 'The data here corresponds to the selected time period at the top right of the page.\n\nBoard meeting participation is recorded at 100% for an organization when at least one of its eligible members attends the meeting. In this metric, only voting representatives are considered eligible. The calculation takes into account all past board meetings held within the selected time period. (Source: PCC Meeting Attendance Record)',
  },
} as const;

/** The participating organizations card's KPI tooltips, in the PCC copy. */
export const HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS = {
  active:
    'Total active members in SFDC at the end of the selected time period. In the case of the YTD time period, the member count reflects yesterday’s status.\n\n(Source: Salesforce)',
  new: 'Total number of members added in the selected time period based on the recorded install date. In the case of YTD time period, the new member count reflects yesterday’s status.\n\n(Source: Salesforce)',
  nonMembers:
    'Total number of organizations with a recorded activity in the selected time period but who do not have a membership.\n\nPlease note that organizations where a parent or child has a membership to the project are excluded.\n\n(Source: Salesforce)',
  nonRenewals:
    'Members who chose not to continue their membership in the selected time period but were active members in the last period.\n\n(Source: Salesforce)',
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
    label: 'Explore Members',
    commands: [HEALTH_METRICS_BASE_PATH, 'members'],
    fragment: 'list',
    queryParams: { memTier: null, memNps: null, memSearch: null, memPage: null },
  },
  nonMembers: {
    label: 'Explore Non-Member Participation',
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

/** The three event statuses: the label the legend shows and a screen reader hears, and the bar fill that shows it. */
export const HEALTH_METRICS_OVERVIEW_EVENT_STATUS = {
  onTrack: { label: 'On track', fillClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
  atRisk: { label: 'At risk', fillClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium },
  action: { label: 'Action required', fillClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low },
} as const;

/** An upcoming event's `comp_score` → its status; an unknown or empty score keeps the neutral blue, with no status. */
export const HEALTH_METRICS_OVERVIEW_EVENT_PACE = {
  high: HEALTH_METRICS_OVERVIEW_EVENT_STATUS.onTrack,
  medium: HEALTH_METRICS_OVERVIEW_EVENT_STATUS.atRisk,
  low: HEALTH_METRICS_OVERVIEW_EVENT_STATUS.action,
} as const;

/** The design's thresholds for a past event's registrations against its goal: at or above the first green, the second amber, else red. */
export const HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES = { onTrack: 1, atRisk: 0.8 } as const;

/** The status legend beside the event list; the registrations bar's fill carries the same three tones. */
export const HEALTH_METRICS_OVERVIEW_EVENT_LEGEND = Object.entries(HEALTH_METRICS_OVERVIEW_EVENT_STATUS).map(([key, status]) => ({
  key,
  label: status.label,
  dotClass: status.fillClass,
}));

/** The upcoming share of the total events bar: the purple hatched over its lightest tint. */
export const HEALTH_METRICS_OVERVIEW_UPCOMING_HATCH = `repeating-linear-gradient(135deg, ${HEALTH_METRICS_OVERVIEW_PURPLE} 0 2px, ${lfxColors.violet[100]} 2px 5px)`;

/** The events card's tooltips, in the PCC copy. */
export const HEALTH_METRICS_OVERVIEW_EVENTS_INFO = {
  total:
    'Total past and upcoming events that had their start date in the selected time period or have their start date in the future and are open for registrations.\n\n(Source: Salesforce)',
  sponsorship: 'Total received sponsorship for all events in the selected period.\n\n(Source: Salesforce)',
  upcoming: 'All events that have their start date in the future and are open for registrations.\n\n(Source: Salesforce)',
  past: 'All events that had their start date in the selected time period.\n\n(Source: Salesforce)',
  registrations: 'Total number of registrations for the event.\n\n(Source: Cvent)',
  talks:
    'Total number of speaking proposals for the event.\nCFP Not Yet Open, CFP Not Yet Closed and CFP In Review indicate the relevant status within the CFP (Call for Proposal) process.\n\n(Source: Sessionize)',
} as const;

/** Events shown before "View all". */
export const HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE = 5;

/** The registration trend's window: days before the event at the chart's left edge. */
export const HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS = 180;

/** Board attendance at or above this share draws green; above zero amber, zero red. */
export const HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE = 0.67;
