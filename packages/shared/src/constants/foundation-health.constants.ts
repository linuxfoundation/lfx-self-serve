// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Foundation, AggregateFoundationMetrics, ProjectHealthDistribution, CompanyBusFactor, TopProjectByValue } from '../interfaces';

/**
 * Generate smooth trend data for sparkline charts
 * @param days Number of data points to generate
 * @param baseValue Starting value
 * @param variation Maximum variation from base value
 * @returns Array of smoothly varying data points
 */
const generateSmoothData = (days: number, baseValue: number, variation: number): number[] => {
  const data: number[] = [];
  let currentValue = baseValue;

  for (let i = 0; i < days; i++) {
    // Small incremental changes instead of random jumps
    const change = (Math.random() - 0.5) * variation * 0.3;
    currentValue = Math.max(baseValue - variation, Math.min(baseValue + variation, currentValue + change));
    data.push(Math.round(currentValue));
  }

  return data;
};

/**
 * Foundation health data for board member dashboard
 * Mock aggregate data across all foundations
 */
export const FOUNDATION_HEALTH_DATA: Foundation = {
  id: 'aggregate',
  name: 'All Foundations',
  logo: '',
  projectBreakdown: {
    sandbox: 45,
    incubating: 28,
    graduated: 18,
  },
  totalMembers: 485,
  memberBreakdown: {
    platinum: 100,
    gold: 150,
    silver: 235,
  },
  softwareValue: 2800,
  activeContributors: generateSmoothData(365, 3000, 200),
  maintainers: generateSmoothData(365, 415, 35),
  eventsMonthly: [2, 1, 2, 3, 2, 1, 2, 3, 2, 1, 3, 2],
  upcomingEvents: 10,
  orgDependency: {
    topOrgsCount: 28,
    topOrgsPercentage: 52,
    otherOrgsCount: 497,
    otherOrgsPercentage: 48,
    riskLevel: 'low',
  },
  healthScore: 'excellent',
};

/**
 * Chart.js configuration for sparkline charts (line charts showing trends)
 * Used for displaying small trend visualizations in foundation health metrics
 */
export const FOUNDATION_SPARKLINE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { display: false },
    y: { display: false },
  },
};

/**
 * Chart.js configuration for bar charts
 * Used for displaying bar chart visualizations in foundation health metrics
 */
export const FOUNDATION_BAR_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { display: false },
    y: { display: false },
  },
  datasets: {
    bar: {
      barPercentage: 0.9,
      categoryPercentage: 0.95,
      borderRadius: 4,
      borderSkipped: false,
    },
  },
};

/**
 * Calculate average from array of numbers
 */
const calculateAverage = (data: number[]): number => {
  return Math.round(data.reduce((sum, val) => sum + val, 0) / data.length);
};

/**
 * Calculate total from array of numbers
 */
const calculateTotal = (data: number[]): number => {
  return data.reduce((sum, val) => sum + val, 0);
};

/**
 * Project health score distribution for all foundations
 * Mock data showing distribution of projects across health categories
 */
export const PROJECT_HEALTH_DISTRIBUTION: ProjectHealthDistribution = {
  excellent: 350,
  healthy: 438,
  stable: 238,
  unsteady: 88,
  critical: 25,
};

/**
 * Company bus factor data
 * Shows concentration risk from top contributing companies
 */
export const COMPANY_BUS_FACTOR: CompanyBusFactor = {
  topCompaniesCount: 28,
  topCompaniesPercentage: 52,
  otherCompaniesCount: 142,
  otherCompaniesPercentage: 48,
};

/**
 * Top projects by software value
 * Highest value projects across all foundations
 */
export const TOP_PROJECTS_BY_VALUE: TopProjectByValue[] = [
  { name: 'Kubernetes', value: 985 },
  { name: 'Linux Kernel', value: 847 },
  { name: 'Envoy', value: 623 },
];

/**
 * Aggregate foundation metrics across all foundations
 * Mock data for demonstration purposes
 */
export const AGGREGATE_FOUNDATION_METRICS: AggregateFoundationMetrics = {
  totalProjects: Object.values(PROJECT_HEALTH_DISTRIBUTION).reduce((sum, val) => sum + val, 0),
  totalProjectsData: generateSmoothData(365, 1139, 50),
  totalMembers: 485,
  totalMembersData: generateSmoothData(365, 485, 25),
  softwareValue: 2800,
  softwareValueData: generateSmoothData(365, 2800, 150),
  topProjectsByValue: TOP_PROJECTS_BY_VALUE,
  companyBusFactor: COMPANY_BUS_FACTOR,
  avgActiveContributors: calculateAverage(FOUNDATION_HEALTH_DATA.activeContributors),
  activeContributorsData: FOUNDATION_HEALTH_DATA.activeContributors,
  avgMaintainers: calculateAverage(FOUNDATION_HEALTH_DATA.maintainers),
  maintainersData: FOUNDATION_HEALTH_DATA.maintainers,
  totalEvents: calculateTotal(FOUNDATION_HEALTH_DATA.eventsMonthly),
  eventsMonthlyData: FOUNDATION_HEALTH_DATA.eventsMonthly,
  projectHealthDistribution: PROJECT_HEALTH_DISTRIBUTION,
};
