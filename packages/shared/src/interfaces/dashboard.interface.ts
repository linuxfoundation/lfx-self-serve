// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Generic table row data for dashboard tables
 * @description Standard structure for tabular data display in dashboard components
 */
export interface TableData {
  /** Unique identifier for the row */
  id: string | number;
  /** Display title for the item */
  title: string;
  /** URL to view item details */
  url: string;
  /** Current status of the item */
  status: string;
  /** Date associated with the item (null if not applicable) */
  date: string | null;
}

/**
 * Project statistics for dashboard overview
 * @description Key metrics about project membership, committees, and meetings
 */
export interface ProjectStats {
  /** Total number of project members across all committees */
  totalMembers: number;
  /** Total number of committees in the project */
  totalCommittees: number;
  /** Total number of meetings (past and future) */
  totalMeetings: number;
  /** Number of upcoming scheduled meetings */
  upcomingMeetings: number;
  /** Number of public meetings */
  publicMeetings: number;
  /** Number of private meetings */
  privateMeetings: number;
}

/**
 * Project health metrics for dashboard insights
 * @description Calculated metrics to assess project activity and engagement levels
 */
export interface ProjectHealth {
  /** Overall activity score (0-100 scale) */
  activityScore: number;
  /** Average number of members per committee */
  avgMembersPerCommittee: number;
  /** Meeting frequency (meetings per month) */
  meetingFrequency: number;
  /** Committee utilization percentage (active vs total) */
  committeeUtilization: number;
  /** Number of recent committee updates */
  recentCommitteeUpdates: number;
  /** Number of recent meetings held */
  recentMeetings: number;
}

/**
 * Primary involvement metric configuration
 * @description Configuration template for organization involvement primary metrics.
 * Contains UI configuration (icons, chart styling). Data values are provided by API transform functions.
 */
export interface PrimaryInvolvementMetric {
  /** Metric title (used for matching to transform functions) */
  title: string;
  /** Metric display value (optional - provided by API in transform functions) */
  value?: string;
  /** Metric subtitle (optional - provided by API in transform functions) */
  subtitle?: string;
  /** Icon class for the metric (optional for membership tier) */
  icon?: string;
  /** Sparkline data points for chart (optional for membership tier) */
  sparklineData?: number[];
  /** Color for sparkline chart (optional for membership tier) */
  sparklineColor?: string;
  /** Chart type - bar or line (optional for membership tier) */
  chartType?: 'bar' | 'line';
  /** Membership tier value (only for membership tier metrics) */
  tier?: string;
  /** Date when membership tier started (only for membership tier metrics) */
  tierSince?: string;
  /** Next payment due date (only for membership tier metrics) */
  nextDue?: string;
  /** Flag indicating this is a membership tier metric */
  isMembershipTier?: boolean;
}

/**
 * Contribution metric for list display
 * @description Metric data for organization contributions displayed in list format
 */
export interface ContributionMetric {
  /** Metric title */
  title: string;
  /** Descriptive value (e.g., "#3 of 45 members", "8 representatives") */
  descriptiveValue: string;
  /** Tooltip text explaining the metric */
  tooltip: string;
  /** Whether the metric is connected to live API data (true) or using placeholder data (false) */
  isConnected?: boolean;
}

/**
 * Impact metric for list display
 * @description Metric data for organization impact displayed in list format
 */
export interface ImpactMetric {
  /** Metric title */
  title: string;
  /** Descriptive value (e.g., "2 projects", "156 employees") */
  descriptiveValue: string;
  /** Tooltip text explaining the metric */
  tooltip: string;
  /** Whether the metric is connected to live API data (true) or using placeholder data (false) */
  isConnected?: boolean;
}

/**
 * Organization involvement metric with chart data
 * @description Processed metric with Chart.js data for display in organization involvement component
 */
export interface OrganizationInvolvementMetricWithChart {
  /** Metric title */
  title: string;
  /** Metric display value */
  value: string;
  /** Metric subtitle */
  subtitle: string;
  /** Icon class for the metric */
  icon: string;
  /** Chart.js data configuration (optional for membership tier) */
  chartData?: {
    /** Data labels */
    labels: string[];
    /** Chart datasets */
    datasets: {
      /** Data points */
      data: number[];
      /** Border color */
      borderColor: string;
      /** Background color */
      backgroundColor: string;
      /** Whether to fill area under line */
      fill: boolean;
      /** Line tension (smoothness) */
      tension: number;
      /** Border width */
      borderWidth: number;
      /** Point radius */
      pointRadius: number;
    }[];
  };
  /** Membership tier value (only for membership tier metrics) */
  tier?: string;
  /** Date when membership tier started (only for membership tier metrics) */
  tierSince?: string;
  /** Next payment due date (only for membership tier metrics) */
  nextDue?: string;
  /** Flag indicating this is a membership tier metric */
  isMembershipTier?: boolean;
  /** Whether the metric is connected to live API data (true) or using placeholder data (false) */
  isConnected?: boolean;
}

/**
 * Health score type for foundations
 * @description Indicates the overall health status of a foundation
 */
export type FoundationHealthScore = 'excellent' | 'healthy' | 'stable' | 'unsteady' | 'critical';

/**
 * Organization dependency risk level
 * @description Risk level based on concentration of contributions from top organizations
 */
export type OrgDependencyRiskLevel = 'low' | 'moderate' | 'high';

/**
 * Project breakdown for foundations
 * @description Number of projects at each stage (CNCF specific)
 */
export interface ProjectBreakdown {
  /** Number of sandbox projects */
  sandbox?: number;
  /** Number of incubating projects */
  incubating?: number;
  /** Number of graduated projects */
  graduated?: number;
}

/**
 * Member breakdown by tier
 * @description Number of member organizations at each membership tier
 */
export interface MemberBreakdown {
  /** Number of platinum tier members */
  platinum: number;
  /** Number of gold tier members */
  gold: number;
  /** Number of silver tier members */
  silver: number;
}

/**
 * Organization dependency metrics
 * @description Tracks concentration risk from top contributing organizations
 */
export interface OrgDependency {
  /** Number of top contributing organizations */
  topOrgsCount: number;
  /** Percentage of contributions from top organizations */
  topOrgsPercentage: number;
  /** Number of other contributing organizations */
  otherOrgsCount: number;
  /** Percentage of contributions from other organizations */
  otherOrgsPercentage: number;
  /** Risk level assessment */
  riskLevel: OrgDependencyRiskLevel;
}

/**
 * Foundation data for health tracking
 * @description Comprehensive foundation metrics for board member dashboard
 */
export interface Foundation {
  /** Unique foundation identifier */
  id: string;
  /** Foundation display name */
  name: string;
  /** URL to foundation logo */
  logo: string;
  /** Total number of projects (for non-CNCF foundations) */
  projectCount?: number;
  /** Project breakdown by stage (for CNCF foundation) */
  projectBreakdown?: ProjectBreakdown;
  /** Total number of member organizations */
  totalMembers: number;
  /** Breakdown of members by tier */
  memberBreakdown: MemberBreakdown;
  /** Estimated software value in millions of dollars */
  softwareValue: number;
  /** Daily active contributor counts for the past year (365 data points) */
  activeContributors: number[];
  /** Daily maintainer counts for the past year (365 data points) */
  maintainers: number[];
  /** Monthly event counts for the current year (12 data points) */
  eventsMonthly: number[];
  /** Number of upcoming scheduled events */
  upcomingEvents: number;
  /** Organization dependency risk metrics */
  orgDependency: OrgDependency;
  /** Overall foundation health score */
  healthScore: FoundationHealthScore;
}
