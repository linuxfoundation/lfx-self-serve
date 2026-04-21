// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandReachPlatformType, DashboardDrawerType, MarketingActionType } from '../interfaces';
import { formatCurrency, formatNumber, hexToRgba } from '../utils';
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
  return [...HEALTH_METRICS_RANGES]
    .reverse()
    .map((range) => {
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
    chartType: 'line',
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
    customContentType: 'health-scores',
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
// Marketing Overview Metrics (Executive Director)
// ============================================

/**
 * Marketing overview metrics for executive director dashboard
 * UI configuration templates (icons, categories, drawer types). Data values are populated at runtime.
 */
export const MARKETING_OVERVIEW_METRICS: DashboardMetricCard[] = [
  {
    title: 'Website Visits',
    icon: 'fa-light fa-globe',
    chartType: 'line',
    category: 'marketing',
    testId: 'marketing-card-website-visits',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.MarketingWebsiteVisits,
  },
  {
    title: 'Email CTR',
    icon: 'fa-light fa-envelope',
    chartType: 'line',
    category: 'marketing',
    testId: 'marketing-card-email-ctr',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.MarketingEmailCtr,
  },
  {
    title: 'Paid Social Reach',
    icon: 'fa-light fa-share-nodes',
    chartType: 'line',
    category: 'marketing',
    testId: 'marketing-card-paid-social-reach',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.MarketingPaidSocialReach,
  },
  {
    title: 'Social Media',
    icon: 'fa-light fa-thumbs-up',
    chartType: 'line',
    category: 'marketing',
    testId: 'marketing-card-social-media',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.MarketingSocialMedia,
  },
];

// ============================================
// North Star Metrics (Executive Director)
// ============================================

/**
 * North Star KPI metrics for executive director dashboard
 * UI configuration templates (icons, categories, drawer types). Data values populated at runtime
 * until Snowflake tables for membership/financial data are available.
 */
export const NORTH_STAR_METRICS: DashboardMetricCard[] = [
  {
    title: 'Engaged Community',
    icon: 'fa-light fa-users',
    chartType: 'line',
    category: 'memberships',
    testId: 'north-star-card-engaged-community',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.NorthStarEngagedCommunity,
  },
  {
    title: 'Member Acq. Rate & CAC',
    icon: 'fa-light fa-user-plus',
    chartType: 'bar',
    category: 'memberships',
    testId: 'north-star-card-member-acquisition',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.NorthStarMemberAcquisition,
  },
  {
    title: 'Member Retention & NRR',
    icon: 'fa-light fa-arrow-rotate-right',
    chartType: 'line',
    category: 'memberships',
    testId: 'north-star-card-member-retention',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.NorthStarMemberRetention,
  },
  {
    title: 'Flywheel Re-engagement',
    icon: 'fa-light fa-rotate',
    chartType: 'line',
    category: 'memberships',
    testId: 'north-star-card-flywheel-conversion',
    chartData: EMPTY_CHART_DATA,
    chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    drawerType: DashboardDrawerType.NorthStarFlywheelConversion,
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
    value: '34',
    trend: 'up',
    subtitle: 'Combined activity last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-issues-resolved',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 5)),
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
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
    value: '8.5',
    trend: 'up',
    subtitle: 'Last 30 days',
    chartType: 'line',
    testId: 'core-dev-progress-card-learning-hours',
    chartData: {
      labels: Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 30 }, () => Math.floor(Math.random() * 3)),
          borderColor: lfxColors.blue[300],
          backgroundColor: hexToRgba(lfxColors.blue[300], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
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
    value: '19',
    trend: 'down',
    subtitle: 'Open critical security vulnerabilities',
    chartType: 'line',
    category: 'projectHealth',
    testId: 'maintainer-progress-card-critical-security-issues',
    chartData: {
      labels: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
      datasets: [
        {
          data: Array.from({ length: 12 }, (_, i) => {
            const base = 28 - i * 0.75;
            return Math.max(15, Math.floor(base + (Math.random() * 4 - 2)));
          }),
          borderColor: lfxColors.red[500],
          backgroundColor: hexToRgba(lfxColors.red[500], 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
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
// ED Dashboard Evolution Prototype (8 Cards)
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
  return {
    label,
    value,
    changePercentage: change,
    trend,
    chartData: data.length > 0 ? protoSparkline(data, color) : EMPTY_CHART_DATA,
    color,
  };
}

/**
 * Filter options for the ED Evolution prototype dashboard
 */
export const ED_EVOLUTION_FILTER_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'memberships', label: 'North Star' },
  { id: 'brand', label: 'Brand' },
  { id: 'influence', label: 'Influence' },
];

/** Round to 1 decimal place, normalizing JS negative zero to positive zero.
 *  e.g. -0.03 → "0.0" not "-0.0", so the displayed text matches neutral trend styling. */
function roundForDisplay(value: number): string {
  const rounded = Number(value.toFixed(1));
  // Object.is distinguishes -0 from 0 — normalise to positive zero
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

/** Format a MoM change as a display string */
function formatMomChange(change: number): string {
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}% MoM`;
}

/** Format a YoY change as a display string */
function formatYoyChange(change: number): string {
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}% YoY`;
}

/** Format a percentage-point MoM change as a display string */
function formatPpMomChange(change: number): string {
  const formatted = roundForDisplay(change);
  const sign = !formatted.startsWith('-') ? '+' : '';
  return `${sign}${formatted}pp MoM`;
}

/** Compute MoM change display from a paid media monthly trend series (last two months of spend) */
function paidMediaMomChange(trend: { spend: number }[]): string | undefined {
  if (trend.length < 2) return undefined;
  const prev = trend[trend.length - 2].spend;
  const curr = trend[trend.length - 1].spend;
  if (prev === 0) return undefined;
  return formatMomChange(((curr - prev) / prev) * 100);
}

/** Compute trend direction from a paid media monthly trend series.
 *  Uses the same MoM % formula as paidMediaMomChange so the color matches the displayed text. */
function paidMediaTrend(trend: { spend: number }[]): 'up' | 'down' | 'neutral' | undefined {
  if (trend.length < 2) return undefined;
  const prev = trend[trend.length - 2].spend;
  const curr = trend[trend.length - 1].spend;
  if (prev === 0) return undefined;
  return trendFromChange(((curr - prev) / prev) * 100);
}

/** Extract values from NorthStarMonthlyDataPoint[] */
function monthlyValues(data: { month: string; value: number }[]): number[] {
  return data.map((d) => d.value);
}

/** Roll up per-channel-per-month event-registration rows into a single monthly lastTouchRevenue series (chronological). */
function eventAttrMonthlyRevenueSeries(rows: { month: string; lastTouchRevenue: number }[]): number[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + (r.lastTouchRevenue ?? 0));
  }
  return Array.from(byMonth.keys())
    .sort()
    .map((m) => byMonth.get(m) ?? 0);
}

/** Compute MoM change display from event-attribution monthly revenue series */
function eventAttrMomChange(series: number[]): string | undefined {
  if (series.length < 2) return undefined;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0) return undefined;
  return formatMomChange(((curr - prev) / prev) * 100);
}

/** Compute trend direction from event-attribution monthly revenue series.
 *  Uses the same MoM % formula as eventAttrMomChange so the color matches the displayed text. */
function eventAttrTrendDirection(series: number[]): 'up' | 'down' | 'neutral' | undefined {
  if (series.length < 2) return undefined;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0) return undefined;
  return trendFromChange(((curr - prev) / prev) * 100);
}

/**
 * Build ED Evolution dashboard cards from live API data.
 * 4 North Star + 2 Brand + 1 Influence.
 * Member Retention is merged into the Member Growth drawer.
 *
 * Sparkline color semantics:
 *  - Blue  (lfxColors.blue[500])   — volume/reach metric (primary signal on every card)
 *  - Violet (lfxColors.violet[500]) — secondary dimension on dual-signal cards (spend, sessions, sentiment)
 * Emerald/red are reserved for delta indicators (up/down), never sparkline stroke.
 */
export function buildEdEvolutionMetrics(data: EdEvolutionData): DashboardMetricCard[] {
  const { flywheel, memberAcquisition, memberRetention, engagedCommunity, eventGrowth, brandReach, brandHealth, revenueImpact } = data;

  return [
    // === North Star (4 cards — retention merged into Member Growth drawer) ===
    {
      title: 'Flywheel Re-engagement',
      icon: 'fa-light fa-arrows-spin',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-flywheel-conversion',
      description: 'Event attendees who engage via newsletter, community, working groups, training, code, or web within 90 days.',
      value: `${flywheel.reengagement.reengagementRate.toFixed(1)}%`,
      changePercentage: formatPpMomChange(flywheel.reengagement.reengagementMomChange),
      trend: trendFromChange(flywheel.reengagement.reengagementMomChange),
      subtitle: 'MoM · Last 6 months',
      chartData: protoSparkline(
        flywheel.monthlyData.length > 0 ? monthlyValues(flywheel.monthlyData) : flatSparklineData(flywheel.reengagement.reengagementRate),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText:
        'Percentage of event attendees who re-engage via newsletter, community, working groups, training, code, or web within 90 days post-event. Change shown in percentage points (pp) MoM.',
      drawerType: DashboardDrawerType.NorthStarFlywheelConversion,
    } as DashboardMetricCard,
    {
      title: 'Member Growth',
      icon: 'fa-light fa-user-group',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-member-growth',
      description: 'Total paying corporate members with quarterly net new count and associated revenue.',
      value: formatNumber(memberAcquisition.totalMembers),
      changePercentage: formatMomChange(memberAcquisition.changePercentage),
      trend: normalizeTrend(memberAcquisition.changePercentage, memberAcquisition.trend),
      subtitle: `${memberRetention.renewalRate.toFixed(1)}% retention · NRR ${memberRetention.netRevenueRetention.toFixed(1)}% · Last 6 months`,
      chartData: protoSparkline(
        memberAcquisition.totalMembersMonthlyData.length > 0 ? memberAcquisition.totalMembersMonthlyData : flatSparklineData(memberAcquisition.totalMembers),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Total paying corporate members with monthly net new over the last 6 months.',
      drawerType: DashboardDrawerType.NorthStarMemberAcquisition,
    } as DashboardMetricCard,
    {
      title: 'Engaged Community',
      icon: 'fa-light fa-people-group',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-engaged-community',
      description: 'Unique individuals active across 7 channels — Slack, Discord, GitHub, mailing lists, training, web, and code — in the last 90 days.',
      value: formatNumber(engagedCommunity.totalMembers),
      changePercentage: formatMomChange(engagedCommunity.changePercentage),
      trend: normalizeTrend(engagedCommunity.changePercentage, engagedCommunity.trend),
      subtitle: 'Last 6 months',
      chartData: protoSparkline(
        engagedCommunity.monthlyData.length > 0 ? monthlyValues(engagedCommunity.monthlyData) : flatSparklineData(engagedCommunity.totalMembers),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Unique individuals active across Slack, Discord, GitHub, mailing lists, training, web, and code in the last 90 days.',
      drawerType: DashboardDrawerType.NorthStarEngagedCommunity,
    } as DashboardMetricCard,
    {
      title: 'Event Growth',
      icon: 'fa-light fa-calendar-star',
      chartType: 'line',
      category: 'memberships',
      testId: 'ed-evo-event-growth',
      description: 'Year-to-date event count, attendees, and net revenue with YoY comparison.',
      value: formatNumber(eventGrowth.totalRegistrants),
      changePercentage: formatYoyChange(eventGrowth.registrantYoyChange),
      trend: trendFromChange(eventGrowth.registrantYoyChange),
      subtitle: `${formatNumber(eventGrowth.totalEvents)} event${eventGrowth.totalEvents === 1 ? '' : 's'} · YTD`,
      chartData: protoSparkline(
        eventGrowth.monthlyData.length > 0 ? monthlyValues(eventGrowth.monthlyData) : flatSparklineData(eventGrowth.totalRegistrants),
        lfxColors.blue[500]
      ),
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
      tooltipText: 'Year-to-date event registrants and YoY change.',
      drawerType: DashboardDrawerType.NorthStarEventGrowth,
    } as DashboardMetricCard,

    // === Brand (2 dual-signal cards) ===
    {
      title: 'Brand Reach',
      icon: 'fa-light fa-signal-bars',
      chartType: 'line',
      category: 'brand',
      testId: 'ed-evo-brand-reach',
      description: 'Social followers across all platforms and monthly website sessions.',
      customContentType: 'dual-signal',
      dualSignals: [
        protoDualSignal(
          'Social Followers',
          formatNumber(brandReach.totalSocialFollowers),
          // No historical follower series available — leave the sparkline empty rather than reuse
          // website-session data (they are different metrics).
          [],
          lfxColors.blue[500],
          formatMomChange(brandReach.changePercentage),
          normalizeTrend(brandReach.changePercentage, brandReach.trend)
        ),
        protoDualSignal(
          'Monthly Sessions',
          formatNumber(brandReach.totalMonthlySessions),
          brandReach.weeklyTrend.length > 0 ? brandReach.weeklyTrend.map((d) => d.sessions) : [],
          lfxColors.violet[500]
        ),
      ],
      caption: `${brandReach.activePlatforms} platforms · Last 6 months`,
      tooltipText: 'Social followers across all platforms (stock) and monthly website sessions (flow). Shown separately — these are different metric types.',
      drawerType: DashboardDrawerType.BrandReach,
    } as DashboardMetricCard,
    {
      title: 'Brand Health',
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
          lfxColors.blue[500]
        ),
        protoDualSignal(
          'Positive Sentiment',
          `${brandHealth.sentiment.positive.toFixed(1)}%`,
          [],
          lfxColors.violet[500],
          formatPpMomChange(brandHealth.sentimentMomChangePp),
          trendFromChange(brandHealth.sentimentMomChangePp)
        ),
      ],
      caption: `${formatNumber(brandHealth.totalMentions)} mentions · Last 6 months`,
      tooltipText: 'Total brand mentions across social and web with sentiment breakdown.',
      drawerType: DashboardDrawerType.BrandHealth,
    } as DashboardMetricCard,

    // === Influence (1 dual-signal card) ===
    {
      title: 'Attribution',
      icon: 'fa-light fa-money-bill-trend-up',
      chartType: 'line',
      category: 'influence',
      testId: 'ed-evo-revenue-impact',
      description: 'Revenue attributed to marketing touchpoints (last-touch model) alongside paid media spend.',
      customContentType: 'dual-signal',
      caption: 'Last 6 months',
      dualSignals: [
        (() => {
          const eventAttrSeries = eventAttrMonthlyRevenueSeries(revenueImpact.eventRegistrationAttribution.monthlyTrend);
          const eventAttrTotal = revenueImpact.eventRegistrationAttribution.channelBreakdown.reduce((sum, c) => sum + (c.lastTouchRevenue ?? 0), 0);
          return protoDualSignal(
            'Marketing Attribution',
            formatCurrency(eventAttrTotal),
            eventAttrSeries,
            lfxColors.blue[500],
            eventAttrMomChange(eventAttrSeries),
            eventAttrTrendDirection(eventAttrSeries)
          );
        })(),
        protoDualSignal(
          'Paid Media',
          formatCurrency(revenueImpact.paidMedia.adSpend),
          revenueImpact.paidMedia.monthlyTrend.map((r) => r.spend),
          lfxColors.violet[500],
          paidMediaMomChange(revenueImpact.paidMedia.monthlyTrend),
          paidMediaTrend(revenueImpact.paidMedia.monthlyTrend)
        ),
      ],
      tooltipText:
        'Revenue attributed to marketing touchpoints (last-touch model) alongside paid media spend. Sales pipeline is shown on the Member Growth card.',
      drawerType: DashboardDrawerType.RevenueImpact,
    } as DashboardMetricCard,
  ];
}
