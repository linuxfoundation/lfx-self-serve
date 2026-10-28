// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { buildHealthMetricsYearOptions } from './dashboard-metrics.constants';
import { HEALTH_METRICS_BASE_PATH } from './health-metrics-engagement.constants';

import type { HealthMetricsYearOption } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsOverviewBlankCopy,
  HealthMetricsOverviewBlankTile,
  HealthMetricsOverviewEmptyCopy,
  HealthMetricsOverviewEmptyStateCopy,
  HealthMetricsOverviewExploreLink,
} from '../interfaces/health-metrics-overview.interface';

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

/** Each card's empty state, for YTD and for a past year; the design writes it for an Executive Director. */
export const HEALTH_METRICS_OVERVIEW_EMPTY_COPY = {
  orgs: {
    icon: 'fa-light fa-building',
    ytd: {
      title: 'No organizations yet',
      text: '',
      reasons: [
        'Members show once their membership is active',
        'Non-members show once they join code, events, meetings or training',
        'Missing members? Your Program Manager can check their records',
      ],
    },
    past: {
      title: 'No organizations in {Y}',
      text: '',
      reasons: [
        'No members or participating organizations were recorded',
        'The foundation may not have launched yet',
        'Members may have been counted under a parent foundation',
      ],
    },
  },
  nps: {
    icon: 'fa-light fa-clipboard-list',
    ytd: {
      title: 'No responses yet',
      text: '',
      reasons: ['The score comes from your latest member satisfaction survey', 'No survey has closed yet this year', 'Send a survey to hear how members feel'],
    },
    past: {
      title: 'No survey in {Y}',
      text: 'No member satisfaction survey closed this year. Each survey counts toward the year it closes.',
      reasons: [],
    },
  },
  churn: {
    icon: 'fa-light fa-arrow-trend-down',
    ytd: {
      title: 'No churn so far',
      text: 'Every paid member due so far has renewed. Memberships ending December 31 count toward next year.',
      reasons: [],
    },
    past: {
      title: 'No churn in {Y}',
      text: '',
      reasons: [
        'Every paid member due for renewal renewed',
        'The foundation may have had no paid tiers this year',
        'Free and associate memberships aren’t counted',
      ],
    },
  },
  balance: {
    icon: 'fa-light fa-file-invoice-dollar',
    ytd: {
      title: 'All invoices paid',
      text: 'No invoice is 60 or more days overdue and no member has said they won’t renew. Late invoices show here as soon as they come up.',
      reasons: [],
    },
    past: {
      title: 'Nothing overdue in {Y}',
      text: 'Every member invoice was paid within 60 days, and no member said they wouldn’t renew.',
      reasons: [],
    },
  },
  events: {
    icon: 'fa-light fa-ticket',
    ytd: {
      title: 'No events scheduled',
      text: 'Registrations, sponsorship and proposals show once an event is on the calendar. Planning one? Your LF Events contact can set it up.',
      reasons: [],
    },
    past: {
      title: 'No events in {Y}',
      text: 'The foundation didn’t hold its own event this year. Co-located or parent-foundation events are counted there instead.',
      reasons: [],
    },
  },
  training: {
    icon: 'fa-light fa-graduation-cap',
    ytd: {
      title: 'No enrollments so far',
      text: '',
      reasons: [
        'Enrollments come from the foundation’s courses on LF Education',
        'Courses may not be published yet',
        'Your LF Education contact can help plan a course',
      ],
    },
    past: {
      title: 'No enrollments in {Y}',
      text: '',
      reasons: [
        'No one enrolled in the foundation’s courses this year',
        'Courses may not have been published yet',
        'Courses may have been offered under another project',
      ],
    },
  },
  code: {
    icon: 'fa-light fa-code',
    ytd: {
      title: 'No contributions tracked',
      text: 'Contributors come from the foundation’s repositories in LFX Insights. None are connected yet, or they had no activity this year.',
      reasons: [],
    },
    past: {
      title: 'No contributions in {Y}',
      text: 'No code activity was recorded this year. Repositories connected later need their history imported to show earlier years.',
      reasons: [],
    },
  },
  board: {
    icon: 'fa-light fa-users-rectangle',
    ytd: {
      title: 'No board meetings yet',
      text: 'Attendance is tracked for board meetings scheduled in LFX, and none has been recorded this year. Met elsewhere? Add the meeting so attendance counts.',
      reasons: [],
    },
    past: {
      title: 'No board meetings in {Y}',
      text: 'No governing board meeting was recorded this year. Meetings held outside LFX count once added as past meetings.',
      reasons: [],
    },
  },
} as const satisfies Record<keyof typeof HEALTH_METRICS_OVERVIEW_CARDS, HealthMetricsOverviewEmptyStateCopy>;

/** The balance card's empty state when no balance was measured, so the card claims nothing is paid. */
const BALANCE_UNMEASURED = {
  title: 'No balance data yet',
  text: 'Overdue membership invoices appear here once the foundation’s billing data is available.',
  reasons: [],
} as const;

export const HEALTH_METRICS_OVERVIEW_BALANCE_UNMEASURED_COPY: HealthMetricsOverviewEmptyStateCopy = {
  icon: 'fa-light fa-file-invoice-dollar',
  ytd: BALANCE_UNMEASURED,
  past: BALANCE_UNMEASURED,
};

/** A card's error state; the read failed, so nothing it would show can be trusted. */
export const HEALTH_METRICS_OVERVIEW_ERROR_COPY: HealthMetricsOverviewEmptyCopy = {
  icon: 'fa-light fa-triangle-exclamation',
  title: 'Unavailable right now',
  text: 'We could not load this card. Refresh the page to try again.',
  reasons: [],
};

/** The single card shown in place of the Overview when every card is empty, for YTD and for a past year. */
export const HEALTH_METRICS_OVERVIEW_BLANK_COPY = {
  ytd: {
    title: 'No health data yet',
    lead: 'Health Metrics fills in as the foundation’s activity is recorded in LFX. Nothing has been recorded for it so far.',
    reasons: [
      'The foundation may be newly launched',
      'Its memberships, events and meetings may not be linked to it yet',
      'Your Program Manager can help connect its data',
    ],
  },
  past: {
    title: 'No health data for {Y}',
    lead: 'Nothing was recorded for the foundation in {Y}.',
    reasons: [
      'The foundation may not have launched yet',
      'Its activity may have been recorded under a parent foundation',
      'A later year may have data to compare',
    ],
  },
} as const satisfies Record<'ytd' | 'past', HealthMetricsOverviewBlankCopy>;

/** The blank card's icons, left to right: the outer tiles sit lower and tilt outward; the pulse sits centred, a size up. */
export const HEALTH_METRICS_OVERVIEW_BLANK_TILES: readonly HealthMetricsOverviewBlankTile[] = [
  { icon: 'fa-light fa-users', transform: 'translateY(22px) rotate(-14deg)', iconSizePx: 20 },
  { icon: 'fa-light fa-ticket', transform: 'translateY(6px) rotate(-7deg)', iconSizePx: 20 },
  { icon: 'fa-light fa-heart-pulse', transform: 'none', iconSizePx: 22 },
  { icon: 'fa-light fa-buildings', transform: 'translateY(6px) rotate(7deg)', iconSizePx: 20 },
  { icon: 'fa-light fa-graduation-cap', transform: 'translateY(22px) rotate(14deg)', iconSizePx: 20 },
];

/** Where the NPS card's empty state sends a writer to start a survey: the foundation's Surveys page. */
export const HEALTH_METRICS_OVERVIEW_CREATE_SURVEY_LINK: HealthMetricsOverviewExploreLink = {
  label: 'Create Survey',
  commands: ['/foundation/surveys'],
  queryParams: {},
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
  axis: lfxColors.gray[300],
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

/** How strongly the NPS gauge's inactive segments keep their color, mixed toward white. */
export const HEALTH_METRICS_OVERVIEW_GAUGE_TINT = 0.22;

/** The registration trend's window: days before the event at the chart's left edge. */
export const HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS = 180;

/** Board attendance at or above this share draws green; above zero amber, zero red. */
export const HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE = 0.67;
