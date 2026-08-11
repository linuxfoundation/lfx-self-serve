// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandReachPlatformType, DashboardDrawerType, MarketingActionType } from '../interfaces';
// By-file imports, not the '../utils' barrel — see constants/index.spec.ts for the invariant.
import { hexToRgba } from '../utils/color.utils';
import { formatCurrency, formatNumber } from '../utils/number.utils';
import { EMPTY_CHART_DATA, NO_TOOLTIP_CHART_OPTIONS } from './chart-options.constants';
import { lfxColors } from './colors.constants';

import type {
  BoardMeetingParticipationSummaryResponse,
  CodeContributionSummaryResponse,
  DashboardMetricCard,
  DualSignalRow,
  EdEvolutionData,
  EventsSummaryResponse,
  FilterPillOption,
  HealthMetricsRange,
  HealthMetricsSummaryCard,
  HealthMetricsYearOption,
  MembershipChurnPerTierSummaryResponse,
  NpsSummaryResponse,
  OutstandingBalanceSummaryResponse,
  ParticipatingOrgsSummaryResponse,
  RevenueImpactResponse,
  TrainingCertificationSummaryResponse,
} from '../interfaces';

// ============================================
// Health Metrics — Range Constants
// ============================================

export const HEALTH_METRICS_RANGES: readonly HealthMetricsRange[] = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];

/**
 * Runtime type guard that narrows an unknown value to `HealthMetricsRange`.
 * Returns true when `value` is a string present in `HEALTH_METRICS_RANGES`.
 */
export function isHealthMetricsRange(value: unknown): value is HealthMetricsRange {
  return typeof value === 'string' && (HEALTH_METRICS_RANGES as readonly string[]).includes(value);
}

/** Maps each HealthMetricsRange to its calendar year offset from the current year. */
const RANGE_YEAR_OFFSET: Record<HealthMetricsRange, number> = {
  YTD: 0,
  COMPLETED_YEAR: 1,
  COMPLETED_YEAR_2: 2,
  COMPLETED_YEAR_3: 3,
  COMPLETED_YEAR_4: 4,
};

/** Returns the calendar year for a given range. */
export function getYearForRange(range: HealthMetricsRange): number {
  return new Date().getFullYear() - (RANGE_YEAR_OFFSET[range] ?? 0);
}

/**
 * Builds the year-filter options for the Health Metrics page.
 * Derived from `HEALTH_METRICS_RANGES` + `RANGE_YEAR_OFFSET` so ordering
 * and offsets stay in sync with the canonical range list.
 */
export function buildHealthMetricsYearOptions(): HealthMetricsYearOption[] {
  const currentYear = new Date().getFullYear();
  return [...HEALTH_METRICS_RANGES].reverse().map((range) => {
    const year = currentYear - RANGE_YEAR_OFFSET[range];
    return {
      label: range === 'YTD' ? 'YTD' : `${year}`,
      range,
      year,
    };
  });
}

// ============================================
// Health Metrics Page (Summary Cards)
// ============================================

export const HEALTH_METRICS_SUMMARY_CARDS: readonly HealthMetricsSummaryCard[] = [
  {
    key: 'totalValue',
    title: 'Total Value',
    icon: 'fa-solid fa-chart-bar fa-rotate-270',
    iconBgClass: 'bg-blue-100',
    iconTextClass: 'text-blue-600',
    format: 'currency',
    testId: 'health-metrics-card-total-value',
  },
  {
    key: 'projects',
    title: 'Projects',
    icon: 'fa-solid fa-list-ul',
    iconBgClass: 'bg-emerald-50',
    iconTextClass: 'text-emerald-600',
    format: 'count',
    testId: 'health-metrics-card-projects',
  },
  {
    key: 'members',
    title: 'Members',
    icon: 'fa-solid fa-user-group',
    iconBgClass: 'bg-blue-100',
    iconTextClass: 'text-blue-500',
    format: 'count',
    testId: 'health-metrics-card-members',
  },
  {
    key: 'flywheel',
    title: 'Flywheel',
    icon: 'fa-light fa-arrows-spin',
    iconBgClass: 'bg-amber-50',
    iconTextClass: 'text-amber-500',
    format: 'percentage',
    testId: 'health-metrics-card-flywheel',
  },
];

export const HEALTH_METRICS_BODY_BLOCK_KEYS = [
  'participating-orgs',
  'nps',
  'membership-churn',
  'outstanding-balance',
  'events',
  'training-certification',
  'code-contribution',
  'flywheel-conversion',
  'board-meeting',
] as const;

export const HEALTH_METRICS_STATUS_COUNT = HEALTH_METRICS_BODY_BLOCK_KEYS.length;

// ============================================
// Board Meeting Card — Thresholds & Limits
// ============================================

export const HEALTH_METRICS_BOARD_MEETING_LOW_ATTENDANCE_THRESHOLD = 0.5;
export const HEALTH_METRICS_BOARD_MEETING_JOB_TITLE_MAX_LENGTH = 50;

export const HEALTH_METRICS_FLYWHEEL_CONVERSION_DECIMAL_PLACES = 2;

/**
 * Payload cap for the Event Growth drawer's current-year events list. The TLF
 * umbrella (no foundation filter) returns every foundation's events and the
 * drawer renders the list unvirtualized — the server query LIMITs to this and
 * the drawer discloses the cap when the list hits it.
 */
export const EVENT_GROWTH_TOP_EVENTS_LIMIT = 500;

// ============================================
// Marketing Action Icon Map
// ============================================

/**
 * Maps semantic action types to Font Awesome icon classes.
 * Keeps presentation out of data interfaces.
 */
export const MARKETING_ACTION_ICON_MAP: Record<MarketingActionType, string> = {
  decline: 'fa-light fa-chart-line-down',
  growth: 'fa-light fa-chart-line-up',
  target: 'fa-light fa-bullseye-arrow',
  revenue: 'fa-light fa-money-bill-trend-up',
  engagement: 'fa-light fa-user-group',
  conversion: 'fa-light fa-arrow-progress',
  content: 'fa-light fa-envelope-open-text',
  diversify: 'fa-light fa-arrows-split-up-and-left',
  optimize: 'fa-light fa-bullseye-pointer',
  investigate: 'fa-light fa-magnifying-glass-chart',
  monitor: 'fa-light fa-circle-info',
};

/**
 * Maps social platform types to Font Awesome icon + Tailwind color classes.
 * Keeps presentation out of Brand Reach data interfaces.
 */
export const MARKETING_SOCIAL_PLATFORM_MAP: Record<BrandReachPlatformType, { icon: string; colorClass: string }> = {
  linkedin: { icon: 'fa-brands fa-linkedin', colorClass: 'text-blue-700' },
  twitter: { icon: 'fa-brands fa-x-twitter', colorClass: 'text-gray-900' },
  youtube: { icon: 'fa-brands fa-youtube', colorClass: 'text-red-600' },
  facebook: { icon: 'fa-brands fa-facebook', colorClass: 'text-blue-600' },
  mastodon: { icon: 'fa-brands fa-mastodon', colorClass: 'text-purple-600' },
  bluesky: { icon: 'fa-brands fa-bluesky', colorClass: 'text-sky-500' },
  other: { icon: 'fa-light fa-hashtag', colorClass: 'text-gray-500' },
};

// ============================================
// Foundation Health Metrics
// ============================================

/**
 * Primary foundation health metrics configuration
 * NOTE: This contains only UI configuration (icons, categories, test IDs). Data values come from APIs or fallback to mock data.
 * This serves as a configuration template for building metric cards with consistent structure.
 */
export const PRIMARY_FOUNDATION_HEALTH_METRICS: DashboardMetricCard[] = [
  {
    title: 'Total Value of Projects',
    icon: 'fa-light fa-chart-column',
    chartType: 'bar',
    category: 'projects',
    testId: 'foundation-health-card-total-value',
    drawerType: DashboardDrawerType.TotalValueOfProjects,
  },
  {
    title: 'Total Projects',
    icon: 'fa-light fa-chart-bar',
    chartType: 'line',
    category: 'projects',
    testId: 'foundation-health-card-total-projects',
    drawerType: DashboardDrawerType.TotalProjects,
  },
  {
    title: 'Total Members',
    icon: 'fa-light fa-user-group',
    chartType: 'line',
    category: 'projects',
    testId: 'foundation-health-card-total-members',
    drawerType: DashboardDrawerType.TotalMembers,
  },
  {
    title: 'Organization Dependency',
    icon: 'fa-light fa-shield',
    chartType: 'line',
    category: 'contributors',
    testId: 'foundation-health-card-org-dependency',
    customContentType: 'bus-factor',
    drawerType: DashboardDrawerType.OrganizationDependency,
  },
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-code',
    chartType: 'line',
    category: 'contributors',
    testId: 'foundation-health-card-active-contributors',
    drawerType: DashboardDrawerType.ActiveContributors,
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    chartType: 'line',
    category: 'contributors',
    testId: 'foundation-health-card-maintainers',
    drawerType: DashboardDrawerType.Maintainers,
  },
  {
    title: 'Events',
    icon: 'fa-light fa-calendar',
    chartType: 'bar',
    category: 'events',
    testId: 'foundation-health-card-events',
    customContentType: 'bar-chart',
    chartColor: lfxColors.blue[500],
    drawerType: DashboardDrawerType.Events,
  },
  {
    title: 'Project Health Scores',
    icon: 'fa-light fa-chart-bar',
    chartType: 'bar',
    category: 'projects',
    testId: 'foundation-health-card-project-health-scores',
    customContentType: 'bar-chart',
    drawerType: DashboardDrawerType.ProjectHealthScores,
  },
];

// ============================================
// Organization Involvement Metrics
// ============================================

/**
 * Primary metrics configuration for board member organization involvement
 * NOTE: This contains only UI configuration (icons, chart styling). All data values come from live API.
 * This serves as a configuration template matched by title to determine visual presentation.
 */
export const PRIMARY_INVOLVEMENT_METRICS: DashboardMetricCard[] = [
  {
    title: 'Membership Tier',
    icon: 'fa-light fa-dollar-sign',
    chartType: 'line',
    isMembershipTier: true,
    testId: 'org-involvement-card-membership-tier',
  },
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-code',
    chartType: 'bar',
    testId: 'org-involvement-card-active-contributors',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgActiveContributors,
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    chartType: 'bar',
    testId: 'org-involvement-card-maintainers',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgMaintainers,
  },
  {
    title: 'Event Attendees',
    icon: 'fa-light fa-user-group',
    chartType: 'line',
    testId: 'org-involvement-card-event-attendees',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgEventAttendees,
  },
  {
    title: 'Event Speakers',
    icon: 'fa-light fa-award-simple',
    chartType: 'line',
    testId: 'org-involvement-card-event-speakers',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgEventSpeakers,
  },
  {
    title: 'Certified Employees',
    icon: 'fa-light fa-graduation-cap',
    chartType: 'line',
    testId: 'org-involvement-card-certified-employees',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgCertifiedEmployees,
  },
  {
    title: 'Training Enrollments',
    icon: 'fa-light fa-graduation-cap',
    chartType: 'line',
    testId: 'org-involvement-card-training-enrollments',
    chartData: EMPTY_CHART_DATA,
    drawerType: DashboardDrawerType.OrgTrainingEnrollments,
  },
];

// ============================================
// Org Overview Involvement Metrics (cross-foundation, non-clickable)
// ============================================

/**
 * Engagement card configuration for the /org/overview involvement section.
 * 6 cards aggregated across all LF foundations. Cards are NOT clickable — no drawerType.
 */
export const ORG_INVOLVEMENT_METRICS: DashboardMetricCard[] = [
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-code',
    chartType: 'bar',
    category: 'contributors',
    testId: 'org-overview-involvement-card-active-contributors',
    chartData: EMPTY_CHART_DATA,
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    chartType: 'bar',
    category: 'contributors',
    testId: 'org-overview-involvement-card-maintainers',
    chartData: EMPTY_CHART_DATA,
  },
  {
    title: 'Event Attendees',
    icon: 'fa-light fa-user-group',
    chartType: 'line',
    category: 'events',
    testId: 'org-overview-involvement-card-event-attendees',
    chartData: EMPTY_CHART_DATA,
  },
  {
    title: 'Event Speakers',
    icon: 'fa-light fa-award-simple',
    chartType: 'line',
    category: 'events',
    testId: 'org-overview-involvement-card-event-speakers',
    chartData: EMPTY_CHART_DATA,
  },
  {
    title: 'Certified Employees',
    icon: 'fa-light fa-graduation-cap',
    chartType: 'line',
    category: 'education',
    testId: 'org-overview-involvement-card-certified-employees',
    chartData: EMPTY_CHART_DATA,
  },
  {
    title: 'Training Enrollments',
    icon: 'fa-light fa-graduation-cap',
    chartType: 'line',
    category: 'education',
    testId: 'org-overview-involvement-card-training-enrollments',
    chartData: EMPTY_CHART_DATA,
  },
];

// ============================================
// Progress Metrics (Core Developer & Maintainer)
// ============================================

/**
 * Core Developer progress metrics
 * NOTE: Metrics with live API data use empty chartData - populated dynamically by transform functions
 */
export const CORE_DEVELOPER_PROGRESS_METRICS: DashboardMetricCard[] = [
  {
    title: 'Code Commits',
    value: '0',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-code-commits',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Pull Requests Merged',
    value: '0',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-pull-requests-merged',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Issues Resolved & Comments Added',
    value: '0',
    trend: 'up',
    subtitle: 'Combined activity last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-issues-resolved',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Active Weeks Streak',
    value: '0',
    trend: 'up',
    subtitle: 'Current streak',
    chartType: 'bar',
    testId: 'core-dev-progress-card-active-weeks-streak',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Learning Hours',
    value: '0',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-learning-hours',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
];

/**
 * Maintainer progress metrics
 * NOTE: Metrics with live API data use empty chartData - populated dynamically by transform functions
 */
export const MAINTAINER_PROGRESS_METRICS: DashboardMetricCard[] = [
  {
    title: 'Critical Security Issues',
    icon: 'fa-light fa-shield',
    value: '0',
    trend: 'down',
    subtitle: 'Open critical security vulnerabilities',
    chartType: 'line',
    category: 'projectHealth',
    testId: 'maintainer-progress-card-critical-security-issues',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'PR Review & Merge Velocity',
    icon: 'fa-light fa-code-pull-request',
    value: '0',
    subtitle: 'Avg days to merge',
    chartType: 'bar',
    category: 'code',
    testId: 'maintainer-progress-card-pr-review-merge-velocity',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Open vs Closed Issues Trend',
    icon: 'fa-light fa-wave-pulse',
    value: '0%',
    subtitle: 'Issue resolution rate',
    chartType: 'line',
    category: 'code',
    testId: 'maintainer-progress-card-open-vs-closed-issues',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Contributors Mentored',
    icon: 'fa-light fa-user-group',
    value: '0',
    subtitle: 'Total contributors mentored',
    chartType: 'line',
    category: 'projectHealth',
    testId: 'maintainer-progress-card-contributors-mentored',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Unique Contributors per Week',
    icon: 'fa-light fa-user-group',
    value: '0',
    subtitle: 'Active contributors',
    chartType: 'bar',
    category: 'code',
    testId: 'maintainer-progress-card-unique-contributors',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Health Score',
    icon: 'fa-light fa-arrow-trend-up',
    value: '0',
    subtitle: 'Avg health score',
    chartType: 'line',
    category: 'projectHealth',
    testId: 'maintainer-progress-card-health-score',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
  {
    title: 'Code Commits',
    icon: 'fa-light fa-code-commit',
    value: '0',
    subtitle: 'Total commits',
    chartType: 'line',
    category: 'code',
    testId: 'maintainer-progress-card-code-commits',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
  },
];

// ============================================
// Health Metrics — default summary constants
// ============================================

export const HEALTH_METRICS_CODE_CONTRIBUTION_DEFAULT_SUMMARY: CodeContributionSummaryResponse = {
  dataAvailable: false,
  projectId: '',
  projectSlug: '',
  range: 'YTD',
  totalContributors: 0,
  totalContributorsChange: 0,
  newContributors: 0,
  newContributorsChange: 0,
  committers: 0,
  maintainers: 0,
  reviewers: 0,
};

export const HEALTH_METRICS_BOARD_MEETING_DEFAULT_SUMMARY: BoardMeetingParticipationSummaryResponse = {
  dataAvailable: false,
  projectId: '',
  projectSlug: '',
  range: 'YTD',
  totalMeetings: 0,
  totalMeetingsChange: null,
  avgMeetingAttendance: 0,
  avgMeetingAttendanceChange: null,
  invitees: [],
};

export const HEALTH_METRICS_EVENTS_DEFAULT_SUMMARY: EventsSummaryResponse = {
  projectId: '',
  totalEvents: 0,
  upcomingEvents: 0,
  pastEvents: 0,
  eventChange: 0,
  eventCountDiff: 0,
  sponsorshipRevenue: 0,
  sponsorshipGoal: 0,
  sponsorshipProgressPct: 0,
};

export const HEALTH_METRICS_MEMBERSHIP_CHURN_DEFAULT_SUMMARY: MembershipChurnPerTierSummaryResponse = {
  projectId: '',
  range: 'YTD',
  comparisonAvailable: false,
  currentPeriod: { churnRatePct: 0, valueLost: 0, membersLost: 0 },
  previousYear: null,
  trend: null,
  tiers: [],
};

export const HEALTH_METRICS_NPS_DEFAULT_SUMMARY: NpsSummaryResponse = {
  projectId: '',
  npsScore: 0,
  promoters: 0,
  passives: 0,
  detractors: 0,
  nonResponses: 0,
  responses: 0,
  lastUpdatedLabel: 'N/A',
  range: 'YTD',
  periodLabel: '',
};

export const HEALTH_METRICS_OUTSTANDING_BALANCE_DEFAULT_SUMMARY: OutstandingBalanceSummaryResponse = {
  projectId: '',
  totalOutstandingBalance: 0,
  totalMembersAtRisk: 0,
  primaryRiskLevel: null,
  primaryRiskAmount: 0,
  overdueBreakdown: {
    medium: { riskLevel: 'Medium', overdueRangeLabel: '60-89', outstandingBalance: 0, membersAtRisk: 0 },
    high: { riskLevel: 'High', overdueRangeLabel: '90+', outstandingBalance: 0, membersAtRisk: 0 },
  },
};

export const HEALTH_METRICS_PARTICIPATING_ORGS_DEFAULT_SUMMARY: ParticipatingOrgsSummaryResponse = {
  projectId: '',
  totalActiveMembers: 0,
  totalNewMembers: 0,
  highEngagement: 0,
  medEngagement: 0,
  lowEngagement: 0,
};

export const HEALTH_METRICS_TRAINING_CERTIFICATION_DEFAULT_SUMMARY: TrainingCertificationSummaryResponse = {
  projectId: '',
  range: 'YTD',
  enrollment: { instructorLed: 0, eLearning: 0, certExams: 0, edx: 0 },
  revenue: { instructorLed: 0, eLearning: 0, certExams: 0 },
};

// ============================================
// ED Dashboard Evolution Prototype (7 Cards)
// ============================================

/** Helper to build a prototype sparkline dataset */
function protoSparkline(data: number[], color: string) {
  return {
    labels: data.map((_, i) => `M${i + 1}`),
    datasets: [
      {
        data,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.1),
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
      },
    ],
  };
}

/** Build a flat sparkline that Chart.js can actually render visibly.
 *  A constant array makes min===max, collapsing the Y range to zero and hiding the line.
 *  Adding ±2% variation (floor 0.1) gives Chart.js a real range while looking nearly flat.
 *  Lower bound is clamped to 0 so non-negative metrics never dip below zero. */
function flatSparklineData(value: number): number[] {
  const nudge = Math.max(Math.abs(value) * 0.02, 0.1);
  return [Math.max(value - nudge, 0), value, value, value, value, value + nudge];
}

/** Build a "Last N months" label from a caller-supplied month count. Formats
 *  exactly the number it is given (no cap — capping at 6 mislabeled the
 *  12-month member growth series); callers estimating the count from other
 *  granularities (e.g. weeks) own the accuracy of the estimate. */
function trendWindow(monthCount: number): string {
  if (monthCount <= 0) return '';
  return `Last ${monthCount} month${monthCount === 1 ? '' : 's'}`;
}

/** Normalize a server-provided trend: treat zero change as neutral instead of up.
 *  Uses Number(toFixed(1)) to match roundForDisplay() — both helpers agree on the
 *  same rounding path so the trend color never diverges from the displayed label. */
function normalizeTrend(change: number, serverTrend: 'up' | 'down'): 'up' | 'down' | 'neutral' {
  if (Number(change.toFixed(1)) === 0) return 'neutral';
  return serverTrend;
}

/** Derive trend direction from a numeric change value.
 *  Uses Number(toFixed(1)) — same rounding path as normalizeTrend and
 *  roundForDisplay() so the direction matches the formatted display string. */
function trendFromChange(change: number): 'up' | 'down' | 'neutral' {
  if (Number(change.toFixed(1)) === 0) return 'neutral';
  return change > 0 ? 'up' : 'down';
}

/** Helper to build a dual-signal row with sparkline */
function protoDualSignal(label: string, value: string, data: number[], color: string, change?: string, trend?: 'up' | 'down' | 'neutral'): DualSignalRow {
  // Suppress the MoM pill when change rounds to 0 — showing "0.0%" is misleading.
  const showChange = trend && trend !== 'neutral';
  return {
    label,
    value,
    changePercentage: showChange ? change : undefined,
    trend: showChange ? trend : undefined,
    chartData: data.length > 0 ? protoSparkline(data, color) : EMPTY_CHART_DATA,
    color,
  };
}

/** Caption shown on a card whose request failed, alongside em-dash signal values. */
const DATA_UNAVAILABLE_CAPTION = 'Data unavailable — could not be loaded';

/**
 * Caption for a card whose request is still in flight.
 *
 * Kept separate from DATA_UNAVAILABLE_CAPTION so the initial loading window does not
 * announce a failure that has not happened. Both render em-dash values, but only the
 * unavailable state asserts that the fetch was attempted and failed.
 */
const DATA_LOADING_CAPTION = 'Loading…';

/**
 * A dual-signal row for a card whose data could not be fetched.
 *
 * Renders an em-dash instead of a number, with no sparkline and no trend pill, so a
 * failed request is visually distinguishable from a measured zero. Deliberately keeps
 * the label and legend dot so the card holds its shape in the carousel — suppressing
 * the card entirely would read as a layout bug rather than a data problem.
 */
function unavailableDualSignal(label: string, color: string): DualSignalRow {
  return {
    label,
    value: '—',
    color,
  };
}

/** Attribution card caption — omits the channel count when no channels are attributed. */
function attributionCaption(revenueImpact: RevenueImpactResponse): string {
  const conversion = `${revenueImpact.matchRate.toFixed(0)}% deal conversion`;
  return revenueImpact.attributionChannels.length > 0 ? `${revenueImpact.attributionChannels.length} channels · ${conversion}` : conversion;
}

/**
 * Overrides a single-value or dual-signal card's value-bearing fields with the same
 * em-dash placeholder used by unavailableDualSignal, while pending is true.
 *
 * Only Paid Media and Attribution carry an `undefined` sentinel for a failed/pending
 * request — every other card's source field is a non-optional zero-filled object, so
 * without this the pending window renders each of their real-looking values (member
 * counts, session totals, mention counts, etc.) as if they were measured zeros for the
 * newly-selected foundation, the exact defect this PR exists to remove elsewhere.
 */
function withPendingPlaceholder(card: DashboardMetricCard, pending: boolean): DashboardMetricCard {
  if (!pending) return card;
  if (card.customContentType === 'dual-signal') {
    return {
      ...card,
      dualSignals: card.dualSignals?.map((row) => unavailableDualSignal(row.label, row.color ?? '')),
      caption: DATA_LOADING_CAPTION,
    };
  }
  return {
    ...card,
    value: '—',
    changePercentage: undefined,
    trend: undefined,
    chartData: EMPTY_CHART_DATA,
    subtitle: DATA_LOADING_CAPTION,
  };
}

/**
 * Filter options for the ED Evolution prototype dashboard
 */
export const ED_EVOLUTION_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'memberships', label: 'North Star' },
  { id: 'brand', label: 'Brand' },
];

/** Round to 1 decimal place, normalizing JS negative zero to positive zero.
 *  e.g. -0.03 → "0.0" not "-0.0", so the displayed text matches neutral trend styling. */
function roundForDisplay(value: number): string {
  const rounded = Number(value.toFixed(1));
  // Object.is distinguishes -0 from 0 — normalise to positive zero
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

/** Format a MoM change as a display string. Returns undefined when change rounds to 0. */
function formatMomChange(change: number): string | undefined {
  if (Number(change.toFixed(1)) === 0) return undefined;
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}% MoM`;
}

/** Format a YoY change as a display string. Returns undefined when change rounds to 0. */
function formatYoyChange(change: number): string | undefined {
  if (Number(change.toFixed(1)) === 0) return undefined;
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}% YoY`;
}

/** Format a percentage-point MoM change as a display string. Returns undefined when change rounds to 0. */
function formatPpMomChange(change: number): string | undefined {
  if (Number(change.toFixed(1)) === 0) return undefined;
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}pp MoM`;
}

/** Extract values from NorthStarMonthlyDataPoint[] */
function monthlyValues(data: { month: string; value: number }[]): number[] {
  return data.map((d) => d.value);
}

/** Compute MoM change display from a monthly numeric series (last vs second-to-last).
 *  The feeding series are calendar zero-filled, so months with no underlying
 *  activity must not read as measured zeros. By default the series is its own
 *  activity signal; callers whose series can carry a legitimate zero in an
 *  active month (e.g. opens in a month that HAD sends) pass the aligned
 *  activity series separately so real -100% observations still display. */
function seriesMomChange(series: number[], activity: number[] = series): string | undefined {
  if (series.length < 2 || activity.length !== series.length) return undefined;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0 || activity[activity.length - 1] === 0 || activity[activity.length - 2] === 0) return undefined;
  return formatMomChange(((curr - prev) / prev) * 100);
}

/** Compute trend direction from a monthly numeric series.
 *  Uses the same MoM % formula and activity guards as seriesMomChange so the
 *  color never diverges from the displayed text. */
function seriesTrendDirection(series: number[], activity: number[] = series): 'up' | 'down' | 'neutral' | undefined {
  if (series.length < 2 || activity.length !== series.length) return undefined;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0 || activity[activity.length - 1] === 0 || activity[activity.length - 2] === 0) return undefined;
  return trendFromChange(((curr - prev) / prev) * 100);
}

/**
 * Build ED Evolution dashboard cards from live API data.
 * 6 North Star (Events, Members, Adoption, Email, Paid Media, Attribution)
 * + 3 Brand (Social, Web, Sentiment) + Flywheel.
 * Member Retention is merged into the Members drawer.
 *
 * Sparkline color semantics:
 *  - Blue  (lfxColors.blue[500])   — volume/reach metric (primary signal on every card)
 *  - Violet (lfxColors.violet[500]) — secondary dimension on dual-signal cards (spend, sessions, sentiment)
 * Emerald/red are reserved for delta indicators (up/down), never sparkline stroke.
 */
export function buildEdEvolutionMetrics(data: EdEvolutionData): DashboardMetricCard[] {
  const { flywheel, memberAcquisition, memberRetention, engagedCommunity, eventGrowth, brandReach, brandHealth, emailCtr, paidCampaign, revenueImpact } = data;
  const { pending } = data;

  // Paid Media and Attribution render em-dashes both while loading and after a failed
  // request, but only the latter may claim the data "could not be loaded". Anything
  // else reports a failure during the initial in-flight window.
  const placeholderCaption = data.pending ? DATA_LOADING_CAPTION : DATA_UNAVAILABLE_CAPTION;

  // Pre-compute email open rate for the Campaign Performance card
  const emailTotalSends = emailCtr.monthlySends.reduce((sum, v) => sum + v, 0);
  const emailTotalOpens = emailCtr.monthlyOpens.reduce((sum, v) => sum + v, 0);
  const emailOpenRate = emailTotalSends > 0 ? (emailTotalOpens / emailTotalSends) * 100 : 0;

  // Per-month open RATE, not send volume. Charting sends here would report an
  // improving trend whenever sends grow faster than opens — the opposite of the
  // truth. Months with no sends contribute 0 and are suppressed by the sends
  // activity guard passed alongside.
  const emailMonthlyOpenRate = emailCtr.monthlyOpens.map((opens, i) => {
    const sends = emailCtr.monthlySends[i] ?? 0;
    return sends > 0 ? (opens / sends) * 100 : 0;
  });

  // Paid month activity: spend OR impressions (a spend-only month is active).
  // Empty when paidCampaign is undefined; the Paid Media card renders its
  // unavailable state in that case and never reads this.
  const paidActivity = paidCampaign ? paidCampaign.monthlyData.map((v, i) => v + (paidCampaign.monthlySpend?.[i] ?? 0)) : [];

  // Paid Media and Attribution already carry their own undefined-sentinel pending
  // handling above (paidCampaign/revenueImpact), so they're excluded here to avoid
  // double-applying the placeholder — everything else has no such sentinel and would
  // otherwise render its zero-filled PENDING_ED_EVOLUTION_DATA fields as measured data.
  const selfGuardedDrawerTypes = new Set([DashboardDrawerType.MarketingPaidSocialReach, DashboardDrawerType.RevenueImpact]);

  return [
    // Card order is the display order in the Marketing Overview carousel, and the
    // filter pills preserve it within each category — so this array is the single
    // source of truth for sequence: Events → Members → Adoption → Social → Web →
    // Email → Paid Media → Attribution → Sentiment → Flywheel. Note the display
    // order interleaves categories — Social and Web (Brand) sit between the North
    // Star cards and Email/Paid Media/Attribution, and Sentiment (Brand) trails
    // them — so this is not a category-grouped list.
    // === North Star ===
    {
      title: 'Events',
      icon: 'fa-light fa-calendar-star',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-event-growth',
      description: 'Year-to-date event count, attendees, and net revenue with YoY comparison.',
      value: formatNumber(eventGrowth.totalRegistrants),
      changePercentage: formatYoyChange(eventGrowth.registrantYoyChange),
      trend: trendFromChange(eventGrowth.registrantYoyChange),
      subtitle:
        eventGrowth.monthlyData.length > 0
          ? `${formatNumber(eventGrowth.totalEvents)} event${eventGrowth.totalEvents === 1 ? '' : 's'} · YTD · Trend: quarterly, 3 yrs + upcoming`
          : `${formatNumber(eventGrowth.totalEvents)} event${eventGrowth.totalEvents === 1 ? '' : 's'} · YTD`,
      chartData: protoSparkline(
        eventGrowth.monthlyData.length > 0 ? monthlyValues(eventGrowth.monthlyData) : flatSparklineData(eventGrowth.totalRegistrants),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Year-to-date event registrants and YoY change.',
      drawerType: DashboardDrawerType.NorthStarEventGrowth,
    } as DashboardMetricCard,
    {
      title: 'Members',
      icon: 'fa-light fa-user-group',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-member-growth',
      description: 'Total paying corporate members with quarterly net new count and associated revenue.',
      value: formatNumber(memberAcquisition.totalMembers),
      changePercentage: formatMomChange(memberAcquisition.changePercentage),
      trend: normalizeTrend(memberAcquisition.changePercentage, memberAcquisition.trend),
      subtitle:
        memberAcquisition.totalMembersMonthlyData.length > 0
          ? `${memberRetention.renewalRate.toFixed(1)}% retention · NRR ${memberRetention.netRevenueRetention.toFixed(1)}% · Last 12 months`
          : `${memberRetention.renewalRate.toFixed(1)}% retention · NRR ${memberRetention.netRevenueRetention.toFixed(1)}%`,
      chartData: protoSparkline(
        memberAcquisition.totalMembersMonthlyData.length > 0 ? memberAcquisition.totalMembersMonthlyData : flatSparklineData(memberAcquisition.totalMembers),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Total paying corporate members with monthly net new over the last 12 months.',
      drawerType: DashboardDrawerType.NorthStarMemberAcquisition,
    } as DashboardMetricCard,
    {
      title: 'Adoption',
      icon: 'fa-light fa-people-group',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-engaged-community',
      description:
        'Unique individuals active across 7 channels — community, working groups, newsletter, training, code, web, and certified — in the last 90 days.',
      value: formatNumber(engagedCommunity.totalMembers),
      changePercentage: formatMomChange(engagedCommunity.changePercentage),
      trend: normalizeTrend(engagedCommunity.changePercentage, engagedCommunity.trend),
      subtitle: trendWindow(engagedCommunity.monthlyData.length),
      chartData: protoSparkline(
        engagedCommunity.monthlyData.length > 0 ? monthlyValues(engagedCommunity.monthlyData) : flatSparklineData(engagedCommunity.totalMembers),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Unique individuals active across community, working groups, newsletter, training, code, web, and certified in the last 90 days.',
      drawerType: DashboardDrawerType.NorthStarEngagedCommunity,
    } as DashboardMetricCard,

    // === Brand ===
    {
      title: 'Social',
      icon: 'fa-light fa-signal-bars',
      chartType: 'line',
      category: 'brand',
      testId: 'ed-evo-brand-reach',
      description: 'Social followers across all platforms.',
      value: formatNumber(brandReach.totalSocialFollowers),
      changePercentage: formatMomChange(brandReach.changePercentage),
      trend: normalizeTrend(brandReach.changePercentage, brandReach.trend),
      subtitle: `${brandReach.activePlatforms} platform${brandReach.activePlatforms === 1 ? '' : 's'}`,
      // No historical follower series available. flatSparklineData renders a nearly
      // flat line at the current total (a constant array collapses Chart.js's Y range
      // and hides the line entirely) — it is a placeholder, not a trend. Website
      // sessions are deliberately not reused here: different metric, different card.
      chartData: protoSparkline(flatSparklineData(brandReach.totalSocialFollowers), lfxColors.blue[500]),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Social followers across all platforms, with month-over-month change.',
      drawerType: DashboardDrawerType.BrandReach,
    } as DashboardMetricCard,

    // === Web ===
    // Website sessions were previously the second dual-signal on the Social card.
    // Split out so followers (a stock) and sessions (a flow) each get their own card
    // rather than sharing one, and so web activity gets a dedicated drill-down.
    {
      title: 'Web',
      icon: 'fa-light fa-globe',
      chartType: 'line',
      category: 'brand',
      testId: 'ed-evo-web-sessions',
      description: 'Rolling 30-day sessions across foundation web properties.',
      value: formatNumber(brandReach.totalMonthlySessions),
      changePercentage: formatMomChange(brandReach.sessionMomChangePct),
      trend: normalizeTrend(brandReach.sessionMomChangePct, brandReach.sessionMomChangePct >= 0 ? 'up' : 'down'),
      // The value is a rolling 30-day total; the sparkline is a separate weekly series
      // over a fixed six-month range. Label them separately so the 30-day figure is not
      // read as a six-month number. weeklyTrend only holds weeks WITH rows, so its
      // length is not the reporting window and the window is labeled directly.
      // When weeklyTrend is empty, flatSparklineData renders a placeholder at the
      // current total (see the Social card above), not a trend.
      subtitle: brandReach.weeklyTrend.length > 0 ? 'Sessions (30d) · Trend: last 6 months' : 'Sessions (30d)',
      chartData: protoSparkline(
        brandReach.weeklyTrend.length > 0 ? brandReach.weeklyTrend.map((d) => d.sessions) : flatSparklineData(brandReach.totalMonthlySessions),
        lfxColors.violet[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Rolling 30-day website sessions across foundation web properties, with month-over-month change.',
      drawerType: DashboardDrawerType.MarketingWebsiteVisits,
    } as DashboardMetricCard,

    // === Email ===
    // Categorised as 'memberships' (North Star) intentionally — owned channels
    // directly drive member acquisition and retention, so Email, Paid Media and
    // Attribution sit alongside Members rather than under Brand.
    {
      title: 'Email',
      icon: 'fa-light fa-envelope',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-campaign-performance',
      description: 'Email opens with click-through and open rate, and MoM trend.',
      customContentType: 'dual-signal',
      dualSignals: [
        protoDualSignal(
          // withPendingPlaceholder overrides value/color while pending, but the label
          // is built here — embedding the live CTR unconditionally would leave a
          // fabricated "0.0% CTR" on screen next to an em-dash value.
          pending ? 'Opens' : `Opens · ${emailCtr.currentCtr.toFixed(1)}% CTR`,
          formatNumber(emailTotalOpens) + ' opens',
          emailCtr.monthlyOpens,
          lfxColors.blue[500],
          seriesMomChange(emailCtr.monthlyOpens, emailCtr.monthlySends),
          seriesTrendDirection(emailCtr.monthlyOpens, emailCtr.monthlySends)
        ),
        protoDualSignal(
          `Open rate · 6 mo`,
          `${emailOpenRate.toFixed(0)}%`,
          emailMonthlyOpenRate,
          lfxColors.violet[500],
          // Guard on sends, not on the rate itself: a zero-send month has a 0% rate
          // that would otherwise read as a real collapse.
          seriesMomChange(emailMonthlyOpenRate, emailCtr.monthlySends),
          seriesTrendDirection(emailMonthlyOpenRate, emailCtr.monthlySends)
        ),
      ],
      caption: trendWindow(emailCtr.monthlyOpens.length),
      tooltipText: 'Email opens with click-through rate, plus sends and the six-month open rate.',
      drawerType: DashboardDrawerType.MarketingEmailCtr,
    } as DashboardMetricCard,

    // === Paid Media ===
    {
      title: 'Paid Media',
      icon: 'fa-light fa-rectangle-ad',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-paid-media',
      description: 'Paid campaign impressions and spend with return on ad spend.',
      customContentType: 'dual-signal',
      // undefined means the request failed, not that the foundation spent nothing.
      // Zero spend and 0.0x ROAS are legitimate measurements, so falling back to
      // them here would report a failure as a factual figure.
      dualSignals: paidCampaign
        ? [
            protoDualSignal(
              `Impressions · ${formatCurrency(paidCampaign.totalSpend)} spend`,
              formatNumber(paidCampaign.totalReach) + ' impressions',
              paidCampaign.monthlyData,
              lfxColors.blue[500],
              // Activity = spend OR impressions per month: an active month that
              // delivered zero impressions keeps its real MoM, while zero-filled
              // no-campaign months stay suppressed.
              seriesMomChange(paidCampaign.monthlyData, paidActivity),
              seriesTrendDirection(paidCampaign.monthlyData, paidActivity)
            ),
            protoDualSignal(
              'ROAS',
              `${paidCampaign.roas.toFixed(1)}x`,
              // Guard on paidActivity, not monthlyRoas itself: a no-campaign month
              // reports 0 ROAS, which would otherwise read as a real decline.
              paidCampaign.monthlyRoas.length > 0 ? paidCampaign.monthlyRoas : [],
              lfxColors.violet[500],
              seriesMomChange(paidCampaign.monthlyRoas, paidActivity),
              seriesTrendDirection(paidCampaign.monthlyRoas, paidActivity)
            ),
          ]
        : [unavailableDualSignal('Impressions · spend', lfxColors.blue[500]), unavailableDualSignal('ROAS', lfxColors.violet[500])],
      caption: paidCampaign ? trendWindow(paidCampaign.monthlyData.length) : placeholderCaption,
      tooltipText: 'Paid campaign impressions with total spend, and return on ad spend over the same window.',
      drawerType: DashboardDrawerType.MarketingPaidSocialReach,
    } as DashboardMetricCard,

    // === Attribution ===
    // Reads revenueImpact, which already carries the multi-touch attribution
    // models and channel breakdown. That data was fetched but had no card
    // surfacing it — only the drawer, which was unreachable from the carousel.
    {
      title: 'Attribution',
      icon: 'fa-light fa-diagram-project',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-attribution',
      description: 'Won revenue year-to-date, with paid-ads linear-attributed revenue alongside.',
      customContentType: 'dual-signal',
      // undefined means the request failed, not that the foundation won nothing.
      // $0 attributed revenue is a legitimate measurement, so a zero fallback here
      // would be indistinguishable from real data.
      dualSignals: revenueImpact
        ? [
            protoDualSignal(
              'Won revenue · YTD',
              formatCurrency(revenueImpact.revenueAttributed),
              // No monthly series is exposed for attributed revenue — leave the
              // sparkline empty rather than borrow an unrelated curve.
              [],
              lfxColors.blue[500],
              // YoY, not MoM: revenueImpact.changePercentage is WON_REVENUE_YOY_CHANGE_PCT.
              formatYoyChange(revenueImpact.changePercentage),
              normalizeTrend(revenueImpact.changePercentage, revenueImpact.trend)
            ),
            protoDualSignal('Paid ads · linear', formatCurrency(revenueImpact.attributionModels.linear), [], lfxColors.violet[500]),
          ]
        : [unavailableDualSignal('Won revenue · YTD', lfxColors.blue[500]), unavailableDualSignal('Paid ads · linear', lfxColors.violet[500])],
      caption: revenueImpact ? attributionCaption(revenueImpact) : placeholderCaption,
      tooltipText:
        "Won revenue year-to-date (WON_REVENUE_YTD) with paid-ads linear-attributed revenue alongside. Deal conversion is the YTD close rate. These are pipeline figures — the drawer's multi-touch models cover a separate six-month window.",
      drawerType: DashboardDrawerType.RevenueImpact,
    } as DashboardMetricCard,

    // === Sentiment ===
    {
      title: 'Sentiment',
      icon: 'fa-light fa-heart-pulse',
      chartType: 'line',
      category: 'brand',
      testId: 'ed-evo-brand-health',
      description: 'Total brand mentions with sentiment breakdown.',
      customContentType: 'dual-signal',
      dualSignals: [
        protoDualSignal(
          'Mentions',
          formatNumber(brandHealth.totalMentions),
          brandHealth.monthlyMentions.length > 0 ? monthlyValues(brandHealth.monthlyMentions) : [],
          lfxColors.blue[500],
          // null (no genuine MoM available) renders the same as a flat month:
          // hidden delta, neutral trend.
          formatMomChange(brandHealth.mentionMomChangePct ?? 0),
          normalizeTrend(brandHealth.mentionMomChangePct ?? 0, brandHealth.trend)
        ),
        protoDualSignal('Positive Sentiment', `${brandHealth.sentiment.positive.toFixed(1)}%`, [], lfxColors.violet[500]),
      ],
      // monthlyMentions only holds months WITH rows, so its length is not the
      // reporting window — the ED caller always requests last-6, so the trend
      // window is labeled directly rather than derived from row count.
      caption:
        brandHealth.monthlyMentions.length > 0
          ? `${formatNumber(brandHealth.totalMentions)} mentions (30d) · trend last 6 months`
          : `${formatNumber(brandHealth.totalMentions)} mentions (30d)`,
      tooltipText: 'Total brand mentions across social and web with sentiment breakdown.',
      drawerType: DashboardDrawerType.BrandHealth,
    } as DashboardMetricCard,

    // === Flywheel (retention is merged into the Members drawer) ===
    {
      title: 'Flywheel',
      icon: 'fa-light fa-arrows-spin',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-flywheel-conversion',
      description: 'Event attendees who engage via newsletter, community, working groups, training, code, or web within 90 days.',
      value: `${flywheel.reengagement.reengagementRate.toFixed(1)}%`,
      changePercentage: formatPpMomChange(flywheel.reengagement.reengagementMomChange),
      trend: trendFromChange(flywheel.reengagement.reengagementMomChange),
      subtitle: flywheel.monthlyData.length > 0 ? `MoM · ${trendWindow(flywheel.monthlyData.length)}` : 'MoM',
      chartData: protoSparkline(
        flywheel.monthlyData.length > 0 ? monthlyValues(flywheel.monthlyData) : flatSparklineData(flywheel.reengagement.reengagementRate),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText:
        'Percentage of event attendees who re-engage via newsletter, community, working groups, training, code, or web within 90 days post-event. Change shown in percentage points (pp) MoM.',
      drawerType: DashboardDrawerType.NorthStarFlywheelConversion,
    } as DashboardMetricCard,
  ].map((card) => (card.drawerType && selfGuardedDrawerTypes.has(card.drawerType) ? card : withPendingPlaceholder(card, pending ?? false)));
}
