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
export type MetricCategory = 'contributors' | 'projects' | 'events' | 'code' | 'projectHealth';

/**
 * Custom content type for specialized metric cards
 * @description Determines what type of custom content to render in the metric card
 */
export type CustomContentType = 'bar-chart' | 'top-projects' | 'bus-factor' | 'health-scores';

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

  // ============================================
  // Status & Metadata
  // ============================================

  /** Indicates if the metric is connected to live data */
  isConnected?: boolean;

  /** Optional tooltip text to display on hover */
  tooltipText?: string;

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
