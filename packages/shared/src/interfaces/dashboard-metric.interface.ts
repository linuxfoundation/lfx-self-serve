// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartData, ChartOptions, ChartType } from 'chart.js';

/**
 * Health score type for foundations
 * @description Indicates the overall health status of a foundation
 */
export type FoundationHealthScore = 'excellent' | 'healthy' | 'stable' | 'unsteady' | 'critical';

/**
 * Metric category type for dashboard filtering
 * @description Used to categorize and filter dashboard metrics
 */
export type MetricCategory =
  | 'contributors'
  | 'projects'
  | 'events'
  | 'code'
  | 'projectHealth'
  | 'marketing'
  | 'brand'
  | 'influence'
  // Reserved for future ED dashboard categories
  | 'memberships'
  | 'education'
  | 'projectOperations';

/**
 * Custom content type for specialized metric cards
 * @description Determines what type of custom content to render in the metric card
 */
export type CustomContentType = 'bar-chart' | 'top-projects' | 'bus-factor' | 'health-scores' | 'dual-signal' | 'funnel';

/**
 * Unified dashboard metric card interface
 * @description Single interface for all dashboard metric cards (progress, foundation health, organization involvement)
 * All properties are optional to support different use cases - components validate required fields
 */
export interface DashboardMetricCard {
  // ============================================
  // Core Display Properties
  // ============================================

  /** Metric title/label - primary identifier */
  title: string;

  /** Metric display value */
  value?: string;

  /** Metric subtitle/description */
  subtitle?: string;

  /** FontAwesome icon class (e.g., 'fa-light fa-shield') */
  icon?: string;

  /** Trend direction indicator */
  trend?: 'up' | 'down';

  /** Percentage change value (e.g., '+12.4%') */
  changePercentage?: string;

  // ============================================
  // Chart Configuration
  // ============================================

  /** Chart type - line or bar */
  chartType: ChartType;

  /** Chart.js data configuration */
  chartData?: ChartData<ChartType>;

  /** Chart.js options configuration */
  chartOptions?: ChartOptions<ChartType>;

  /** Color for bar chart */
  chartColor?: string;

  // ============================================
  // Filtering & Organization
  // ============================================

  /** Category for filtering metrics */
  category?: MetricCategory;

  /** Test ID for E2E testing */
  testId?: string;

  /** Custom content type for specialized cards */
  customContentType?: CustomContentType;

  /** Identifies which drill-down drawer to open when this card is clicked */
  drawerType?: DashboardDrawerType;

  // ============================================
  // Status & Metadata
  // ============================================

  /** Optional tooltip text to display on hover */
  tooltipText?: string;

  /** Loading state for the card - when true, shows skeleton UI */
  loading?: boolean;

  // ============================================
  // Dual-Signal Card (Brand Reach, Brand Health, Revenue Impact)
  // ============================================

  /** Two-signal rows for dual-signal cards (e.g., Brand Reach, Brand Health, Revenue Impact) */
  dualSignals?: DualSignalRow[];

  /** Caption text below dual-signal card (e.g., "$X attributed of $Y total (Z% match rate)") */
  caption?: string;

  // ============================================
  // Funnel Card (Flywheel Conversion)
  // ============================================

  /** Steps for the funnel card (e.g., Attendees → Newsletter → Community → WG) */
  funnelSteps?: FunnelStep[];

  // ============================================
  // Foundation Health Specific
  // ============================================

  /** Data for top projects list (foundation health) */
  topProjects?: TopProjectDisplay[];

  /** Data for company bus factor (foundation health) */
  busFactor?: CompanyBusFactor;

  /** Data for project health scores distribution (foundation health) */
  healthScores?: ProjectHealthDistribution;

  // ============================================
  // Organization Involvement Specific (Membership)
  // ============================================

  /** Membership tier value */
  tier?: string;

  /** Date when membership tier started */
  tierSince?: string;

  /** Next payment due date */
  nextDue?: string;

  /** Flag indicating this is a membership tier metric */
  isMembershipTier?: boolean;
}

/**
 * Project health score distribution
 * @description Breakdown of projects by health score category
 */
export interface ProjectHealthDistribution {
  /** Number of projects with excellent health */
  excellent: number;
  /** Number of projects with healthy status */
  healthy: number;
  /** Number of projects with stable status */
  stable: number;
  /** Number of projects with unsteady status */
  unsteady: number;
  /** Number of projects with critical status */
  critical: number;
}

/**
 * Company bus factor data
 * @description Metrics showing concentration risk from top contributing companies
 */
export interface CompanyBusFactor {
  /** Number of top companies accounting for >50% contributions */
  topCompaniesCount: number;
  /** Percentage of contributions from top companies */
  topCompaniesPercentage: number;
  /** Number of other contributing companies */
  otherCompaniesCount: number;
  /** Percentage of contributions from other companies */
  otherCompaniesPercentage: number;
}

/**
 * Top project display format
 * @description Formatted project data for display in foundation health cards
 */
export interface TopProjectDisplay {
  /** Project name */
  name: string;
  /** Formatted display value (e.g., "985M" or "2.8B") */
  formattedValue: string;
}

/**
 * Top project by software value
 * @description Individual project with estimated software value
 */
export interface TopProjectByValue {
  /** Project name */
  name: string;
  /** Estimated software value in millions of dollars */
  value: number;
}

// ============================================
// Total Projects Drawer
// ============================================

/** Identifies which drill-down drawer to open from a metric card */
export enum DashboardDrawerType {
  TotalValueOfProjects = 'total-value-of-projects',
  TotalProjects = 'total-projects',
  TotalMembers = 'total-members',
  ActiveContributors = 'active-contributors',
  Maintainers = 'maintainers',
  Events = 'events',
  ProjectHealthScores = 'project-health-scores',
  OrganizationDependency = 'organization-dependency',
  OrgActiveContributors = 'org-active-contributors',
  OrgMaintainers = 'org-maintainers',
  OrgEventAttendees = 'org-event-attendees',
  OrgEventSpeakers = 'org-event-speakers',
  OrgTrainingEnrollments = 'org-training-enrollments',
  OrgCertifiedEmployees = 'org-certified-employees',
  MarketingWebsiteVisits = 'marketing-website-visits',
  MarketingEmailCtr = 'marketing-email-ctr',
  MarketingPaidSocialReach = 'marketing-paid-social-reach',
  MarketingSocialMedia = 'marketing-social-media',
  NorthStarEngagedCommunity = 'north-star-engaged-community',
  NorthStarMemberAcquisition = 'north-star-member-acquisition',
  NorthStarMemberRetention = 'north-star-member-retention',
  NorthStarFlywheelConversion = 'north-star-flywheel-conversion',
  NorthStarEventGrowth = 'north-star-event-growth',
  BrandReach = 'brand-reach',
  BrandHealth = 'brand-health',
  RevenueImpact = 'revenue-impact',
}

/** Lifecycle stage of a foundation project */
export enum LifecycleStage {
  Graduated = 'Graduated',
  Incubating = 'Incubating',
  Sandbox = 'Sandbox',
}

/**
 * Project row for the total projects drill-down table
 * @description Represents a single project with key health and activity metrics
 */
export interface ProjectTableRow {
  id: string;
  projectName: string;
  projectSlug: string;
  lifecycleStage: LifecycleStage;
  activeContributors: number;
  commitsLast90Days: number;
  maintainers: number;
  stars: number;
  lastUpdated: string | null;
}

// ============================================
// Health Metrics Page (Summary Cards)
// ============================================

/** Format type for health metrics summary card values */
export type HealthMetricsFormat = 'currency' | 'count' | 'percentage';

/** Unique key for each summary card on the Health Metrics page */
export type HealthMetricsKey = 'totalValue' | 'projects' | 'members' | 'flywheel';

/**
 * Configuration for a summary metric card on the Health Metrics page
 * @description Defines layout and formatting for static summary cards
 */
export interface HealthMetricsSummaryCard {
  /** Unique key identifying this card */
  key: HealthMetricsKey;
  /** Display label shown below the value */
  title: string;
  /** Font Awesome icon class */
  icon: string;
  /** Tailwind background class for the icon badge */
  iconBgClass: string;
  /** Tailwind text color class for the icon */
  iconTextClass: string;
  /** How to format the value for display */
  format: HealthMetricsFormat;
  /** E2E test selector */
  testId: string;
}

/**
 * Filter pill option for dashboard filter controls
 * @description Used by filter-pills component for category filtering
 */
export interface FilterPillOption {
  /** Unique filter identifier used for category filtering */
  id: string;
  /** Display label for the filter pill */
  label: string;
}

/**
 * A single signal row within a dual-signal metric card
 * @description Used for cards that show two independent metrics stacked vertically (e.g., Brand Reach, Revenue Impact)
 */
export interface DualSignalRow {
  /** Label for this signal (e.g., "Social Followers", "Monthly Sessions") */
  label: string;
  /** Display value (e.g., "474K", "$2.1M") */
  value: string;
  /** Change percentage display (e.g., "+8.2% MoM") */
  changePercentage?: string;
  /** Trend direction */
  trend?: 'up' | 'down';
  /** Sparkline chart data for this signal */
  chartData?: ChartData<ChartType>;
}

/**
 * A single step in a funnel visualization on a metric card
 * @description Used for the Flywheel Conversion card to show the step-down funnel
 */
export interface FunnelStep {
  /** Short label (e.g., "Attendees", "Newsletter") */
  label: string;
  /** Display value (e.g., "8.2K", "1.4K") */
  value: string;
}

/**
 * Metric card with category for filtering
 * @description Wraps a DashboardMetricCard with its category for filter logic
 */
export interface CategorizedMetricCard {
  /** The metric card data */
  card: DashboardMetricCard;
  /** Category used for filtering */
  category: string;
}

/**
 * Net Promoter Score summary response from BFF
 * @description NPS card data from Snowflake ANALYTICS.PLATINUM.SURVEY_RESPONSES.
 * Query semantics aligned with lfx-pcc SurveyQueriesService.surveyResponseMetrics (YTD).
 */
export interface NpsSummaryResponse {
  /** Snowflake PROJECT_ID used for PCC deep-link navigation */
  projectId: string;
  /** Headline NPS (−100…100) */
  npsScore: number;
  /** Count of promoter responses */
  promoters: number;
  /** Count of passive responses */
  passives: number;
  /** Count of detractor responses */
  detractors: number;
  /** Count of non-responses */
  nonResponses: number;
  /** Total: promoters + passives + detractors + nonResponses */
  responses: number;
  /** Human-readable reporting period for Last Updated (e.g. "Q4 2025" or "N/A") */
  lastUpdatedLabel: string;
  /** Optional period-over-period NPS change (omit from card UI in v1) */
  changeNpsScore?: number;
}

// ============================================
// Membership Churn Per Tier (Health Metrics Card)
// ============================================

/**
 * Period-level churn snapshot (current or previous year)
 * @description Contains headline churn rate, monetary loss, and member count for one reporting slice
 */
export interface MembershipChurnPeriodSummary {
  /** Project-level churn rate as a display-friendly percentage (e.g. 3.6 means 3.6%) */
  churnRatePct: number;
  /** Monetary loss for the period in whole dollars (before UI abbreviation) */
  valueLost: number;
  /** Count of churned accounts / members for the period */
  membersLost: number;
}

/**
 * Trend comparison between current and previous year
 * @description Derived from membersLost; null when comparison is not available
 */
export interface MembershipChurnTrendSummary {
  /** Visual direction for the trend indicator */
  direction: 'up' | 'down';
  /** Rounded multiplier vs previous year (e.g. 2.3) */
  multiplier: number;
  /** Documents which metric drives the multiplier */
  basis: 'membersLost';
}

/**
 * Consolidated Membership Churn Per Tier summary from BFF
 * @description Single-response contract for the Health Metrics churn card.
 * Query semantics aligned with lfx-pcc MembershipQueriesService (membershipTotalChurnRate + membershipChurnRate).
 * Source: ANALYTICS.PLATINUM.MEMBERSHIP_CHURN
 */
export interface MembershipChurnPerTierSummaryResponse {
  /** Snowflake PROJECT_ID echoed for PCC deep-link navigation */
  projectId: string;
  /** Effective reporting range used by the query (e.g. 'YTD') */
  range: string;
  /** Whether the card should render Previous year row and trend */
  comparisonAvailable: boolean;
  /** Current-period headline metrics */
  currentPeriod: MembershipChurnPeriodSummary;
  /** Prior-year comparison values; null when comparisonAvailable is false */
  previousYear: MembershipChurnPeriodSummary | null;
  /** Trend direction and multiplier; null when comparison is unavailable or non-finite */
  trend: MembershipChurnTrendSummary | null;
}

/**
 * Participating Organizations summary response from BFF
 * @description Aggregated membership engagement data for a foundation (YTD scope).
 * Mapped from Snowflake ANALYTICS.PLATINUM tables to camelCase.
 */
export interface ParticipatingOrgsSummaryResponse {
  /** Snowflake PROJECT_ID (Salesforce ID) used for PCC URL navigation */
  projectId: string;
  /** Active member organizations in YTD period */
  totalActiveMembers: number;
  /** New members added during YTD period */
  totalNewMembers: number;
  /** Count of orgs with high engagement classification */
  highEngagement: number;
  /** Count of orgs with medium engagement classification */
  medEngagement: number;
  /** Count of orgs with low engagement classification */
  lowEngagement: number;
}

// ============================================
// Outstanding Balance (Health Metrics Card)
// ============================================

/**
 * Risk bucket for the Outstanding Balance overdue breakdown
 * @description Each bucket is a fixed pair: Medium ↔ 60-89, High ↔ 90+
 */
export interface OutstandingBalanceRiskBucket {
  riskLevel: 'Medium' | 'High';
  overdueRangeLabel: '60-89' | '90+';
  outstandingBalance: number;
  membersAtRisk: number;
}

/**
 * Normalized overdue breakdown with fixed medium and high buckets
 * @description Both buckets are always present; missing Snowflake rows are zero-filled
 */
export interface OutstandingBalanceOverdueBreakdown {
  medium: OutstandingBalanceRiskBucket;
  high: OutstandingBalanceRiskBucket;
}

/**
 * Outstanding Balance summary response from BFF
 * @description Single normalized card-ready payload from Snowflake ANALYTICS.PLATINUM.CHURN_RISK.
 * Two logical reads: overview row (churn_risk IS NULL) + breakdown rows (churn_risk IS NOT NULL).
 */
export interface OutstandingBalanceSummaryResponse {
  projectId: string;
  totalOutstandingBalance: number;
  totalMembersAtRisk: number;
  primaryRiskLevel: 'High' | 'Medium' | null;
  primaryRiskAmount: number;
  overdueBreakdown: OutstandingBalanceOverdueBreakdown;
}

// ============================================
// Events Summary (Health Metrics Card)
// ============================================

/**
 * Events summary response from BFF
 * @description Single normalized card-ready payload from Snowflake EVENT_OVERVIEW,
 * EVENT_SPONSORSHIPS, and ENGAGEMENT_SCORES tables.
 * Three logical reads: overview (total events + change), sponsorship SUM, and goal MAX.
 */
export interface EventsSummaryResponse {
  /** Snowflake PROJECT_ID echoed for PCC deep-link navigation */
  projectId: string;
  /** Total event count for YTD (EVENT_COUNT_YTD) */
  totalEvents: number;
  /** Upcoming events count (UPCOMING_EVENTS_YTD) */
  upcomingEvents: number;
  /** Past events count (PAST_EVENTS_YTD) */
  pastEvents: number;
  /** Period-over-period change ratio (e.g., -0.45 for 45% decrease); 0 when previous year is zero */
  eventChange: number;
  /** Absolute period-over-period count difference (current - previous); for "+N vs prev period" display */
  eventCountDiff: number;
  /** Aggregate sponsorship revenue for YTD in dollars */
  sponsorshipRevenue: number;
  /** Sponsorship goal proxy from ENGAGEMENT_SCORES; 0 when unavailable */
  sponsorshipGoal: number;
  /** Progress percentage: revenue/goal*100; 0 when goal is zero */
  sponsorshipProgressPct: number;
}

// ============================================
// Training & Certification (Health Metrics Card)
// ============================================

/**
 * Shared reporting range type used by all Health Metrics cards.
 * Maps to range-specific Snowflake columns or year predicates.
 */
export type HealthMetricsRange = 'YTD' | 'COMPLETED_YEAR' | 'COMPLETED_YEAR_2' | 'COMPLETED_YEAR_3' | 'COMPLETED_YEAR_4';

/**
 * Year filter option for the Health Metrics page year-range selector.
 */
export interface HealthMetricsYearOption {
  label: string;
  range: HealthMetricsRange;
  year: number;
}

/**
 * Allowed reporting windows for the Training & Certification card.
 * Maps to range-specific columns in ANALYTICS.PLATINUM.ENROLLMENTS / COURSE_PURCHASES.
 */
export type TrainingCertificationRange = HealthMetricsRange;

/**
 * Enrollment-mode category values for the Training & Certification card.
 * Four visible categories: Instructor Led, eLearning, Cert Exams, edX.
 */
export interface TrainingCertificationEnrollmentSummary {
  instructorLed: number;
  eLearning: number;
  certExams: number;
  edx: number;
}

/**
 * Revenue-mode category values for the Training & Certification card.
 * Three visible categories: Instructor Led, eLearning, Cert Exams. edX intentionally omitted.
 */
export interface TrainingCertificationRevenueSummary {
  instructorLed: number;
  eLearning: number;
  certExams: number;
}

/**
 * Training & Certification summary response from BFF
 * @description Single normalized card-ready payload from Snowflake ANALYTICS.PLATINUM.ENROLLMENTS
 * and ANALYTICS.PLATINUM.COURSE_PURCHASES. Two logical reads combined into one response
 * containing both Enrollment and Revenue values for local UI toggling.
 */
export interface TrainingCertificationSummaryResponse {
  /** Snowflake PROJECT_ID echoed for PCC deep-link navigation */
  projectId: string;
  /** Effective reporting window used by the summary query */
  range: TrainingCertificationRange;
  /** Enrollment-mode values for the selected project and range */
  enrollment: TrainingCertificationEnrollmentSummary;
  /** Revenue-mode values for the selected project and range */
  revenue: TrainingCertificationRevenueSummary;
}

// ============================================
// Code Contribution Summary (Health Metrics Card)
// ============================================

/**
 * Allowed reporting windows for the Code Contribution card.
 * Maps to range-specific columns in ANALYTICS.PLATINUM.CODE_CONTRIBUTIONS.
 */
export type CodeContributionRange = HealthMetricsRange;

/**
 * Code Contribution summary response from BFF.
 * Single normalized card-ready payload from Snowflake ANALYTICS.PLATINUM.CODE_CONTRIBUTIONS.
 * One logical read with dynamic column interpolation; all-time role counts are always fixed.
 */
export interface CodeContributionSummaryResponse {
  /** true when CODE_CONTRIBUTIONS returned rows for the project; false triggers "No Contribution Data Available" */
  dataAvailable: boolean;
  /** Snowflake PROJECT_ID echoed for context; empty string when dataAvailable is false */
  projectId: string;
  /** Foundation/project slug echoed for Insights URL construction */
  projectSlug: string;
  /** Effective reporting range used by the summary query */
  range: CodeContributionRange;
  /** Distinct contributors for the selected range */
  totalContributors: number;
  /** Period-over-period change ratio for total contributors (e.g., 0.14 = 14% increase); raw dbt value */
  totalContributorsChange: number;
  /** New contributors for the selected range */
  newContributors: number;
  /** Period-over-period change ratio for new contributors; raw dbt value */
  newContributorsChange: number;
  /** All-time committer count (fixed regardless of range) */
  committers: number;
  /** All-time maintainer count (fixed regardless of range) */
  maintainers: number;
  /** All-time reviewer count (fixed regardless of range) */
  reviewers: number;
}
