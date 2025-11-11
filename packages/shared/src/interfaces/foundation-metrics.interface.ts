// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Metric category type for foundation health filtering
 * @description Used to categorize and filter foundation health metrics
 */
export type MetricCategory = 'contributors' | 'projects' | 'events';

/**
 * Foundation metric card configuration
 * @description Configuration for individual metric cards in the foundation health carousel
 */
export interface FoundationMetricCard {
  /** Icon name for the metric */
  icon: string;
  /** Metric title */
  title: string;
  /** Metric display value */
  value: string;
  /** Metric subtitle description */
  subtitle: string;
  /** Category for filtering */
  category: MetricCategory;
  /** Test ID for E2E testing */
  testId: string;
  /** Custom content type for the card */
  customContentType?: 'sparkline' | 'bar-chart' | 'top-projects' | 'bus-factor' | 'health-scores';
  /** Chart.js data for sparkline or bar chart */
  chartData?: {
    labels: string[];
    datasets: {
      data: number[];
      borderColor?: string;
      backgroundColor?: string;
      fill?: boolean;
      tension?: number;
      borderWidth?: number;
      pointRadius?: number;
    }[];
  };
  /** Data for top projects list */
  topProjects?: TopProjectDisplay[];
  /** Data for company bus factor */
  busFactor?: CompanyBusFactor;
  /** Data for project health scores distribution */
  healthScores?: ProjectHealthDistribution;
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
 * Top project by software value
 * @description Individual project with estimated software value
 */
export interface TopProjectByValue {
  /** Project name */
  name: string;
  /** Estimated software value in millions of dollars */
  value: number;
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
 * Aggregate foundation metrics
 * @description Summary metrics across all foundations
 */
export interface AggregateFoundationMetrics {
  /** Total number of projects across all foundations */
  totalProjects: number;
  /** Historical data for total projects (365 days) */
  totalProjectsData: number[];
  /** Total number of member organizations */
  totalMembers: number;
  /** Historical data for total members (365 days) */
  totalMembersData: number[];
  /** Total estimated software value in millions */
  softwareValue: number;
  /** Historical data for software value (365 days) */
  softwareValueData: number[];
  /** Top 3 projects by software value */
  topProjectsByValue: TopProjectByValue[];
  /** Company bus factor metrics */
  companyBusFactor: CompanyBusFactor;
  /** Average active contributors across foundations */
  avgActiveContributors: number;
  /** Historical data for active contributors (365 days) */
  activeContributorsData: number[];
  /** Average maintainers across foundations */
  avgMaintainers: number;
  /** Historical data for maintainers (365 days) */
  maintainersData: number[];
  /** Total events across all foundations (past year) */
  totalEvents: number;
  /** Monthly event counts (12 months) */
  eventsMonthlyData: number[];
  /** Project health score distribution */
  projectHealthDistribution: ProjectHealthDistribution;
}
