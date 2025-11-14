// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PrimaryInvolvementMetric } from '../interfaces/dashboard.interface';

/**
 * Helper function to generate trend data for spark line charts
 */
const generateTrendData = (months: number, baseValue: number): number[] => {
  return Array.from({ length: months }, (_, i) => {
    const trendValue = i * 2;
    return Math.max(0, baseValue + trendValue + (Math.random() * 10 - 5));
  });
};

/**
 * Chart.js configuration for sparkline charts (line charts showing trends)
 * Used for displaying small trend visualizations in metrics cards
 */
export const SPARKLINE_CHART_OPTIONS = {
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
 * Used for displaying bar chart visualizations in metrics cards
 */
export const BAR_CHART_OPTIONS = {
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
 * Primary metrics configuration for board member organization involvement
 * NOTE: This contains only UI configuration (icons, chart styling). All data values come from live API.
 * This serves as a configuration template matched by title to determine visual presentation.
 */
export const PRIMARY_INVOLVEMENT_METRICS: PrimaryInvolvementMetric[] = [
  {
    title: 'Membership Tier',
    icon: 'fa-light fa-dollar-sign',
    isMembershipTier: true,
    // All membership data (tier, dates, fees) comes from getBoardMemberDashboard API
  },
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-users',
    sparklineData: generateTrendData(12, 60), // TODO: Replace with API trend data
    sparklineColor: '#93c5fd',
    chartType: 'line' as const,
    // All contributor data comes from getOrganizationContributionsOverview API
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    sparklineData: generateTrendData(12, 60), // TODO: Replace with API trend data
    sparklineColor: '#93c5fd',
    chartType: 'line' as const,
    // All maintainer data comes from getOrganizationContributionsOverview API
  },
  {
    title: 'Event Attendees',
    icon: 'fa-light fa-user-group',
    sparklineData: generateTrendData(30, 150), // TODO: Replace with API trend data
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
    // All event attendee data comes from getOrganizationEventsOverview API
  },
  {
    title: 'Event Speakers',
    icon: 'fa-light fa-microphone',
    sparklineData: generateTrendData(30, 20), // TODO: Replace with API trend data
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
    // All event speaker data comes from getOrganizationEventsOverview API
  },
  {
    title: 'Certified Employees',
    icon: 'fa-light fa-certificate',
    sparklineData: generateTrendData(30, 45), // TODO: Replace with API trend data
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
    // All certified employee data comes from getBoardMemberDashboard API
  },
  {
    title: 'Training Enrollments',
    icon: 'fa-light fa-graduation-cap',
    sparklineData: generateTrendData(30, 80), // TODO: Replace with API trend data
    sparklineColor: '#D3D3D3',
    chartType: 'line' as const,
    // Training enrollment data will come from API
  },
];
