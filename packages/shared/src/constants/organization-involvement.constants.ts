// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ContributionMetric, ImpactMetric, PrimaryInvolvementMetric } from '../interfaces/dashboard.interface';

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
 * Primary metrics configuration for board member organization involvement
 * NOTE: This contains only UI configuration (icons, chart styling). All data values come from live API.
 * This serves as a configuration template matched by title to determine visual presentation.
 */
export const PRIMARY_INVOLVEMENT_METRICS: PrimaryInvolvementMetric[] = [
  {
    title: 'Membership Tier',
    icon: 'fa-light fa-badge-check',
    isMembershipTier: true,
    // All membership data (tier, dates, fees) comes from getBoardMemberDashboard API
  },
  {
    title: 'Event Sponsorship',
    icon: 'fa-light fa-dollar-sign',
    sparklineData: generateTrendData(12, 60), // TODO: Replace with API trend data
    sparklineColor: '#0094FF', // TODO: Replace with API color
    chartType: 'line' as const,
    // All event data (amounts, counts) comes from getOrganizationEventsOverview API
  },
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-users',
    sparklineData: generateTrendData(12, 60), // TODO: Replace with API trend data
    sparklineColor: '#0094FF', // TODO: Replace with API color
    chartType: 'line' as const,
    // All contributor data comes from getOrganizationContributionsOverview API
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    sparklineData: generateTrendData(12, 60), // TODO: Replace with API trend data
    sparklineColor: '#0094FF', // TODO: Replace with API color
    chartType: 'line' as const,
    // All maintainer data comes from getOrganizationContributionsOverview API
  },
];

/**
 * Contributions metrics for board member organization involvement
 * These are displayed in a list format without charts
 */
export const CONTRIBUTIONS_METRICS: ContributionMetric[] = [
  {
    title: 'Contribution Rank',
    descriptiveValue: '#3 of 45 members',
    tooltip: 'Rank among member organizations based on contribution volume',
  },
  {
    title: 'TOC/TSC/TAG Participation',
    descriptiveValue: '8 representatives',
    tooltip: 'Number of Technical Oversight Committee, Technical Steering Committee, and Technical Advisory Group representatives',
  },
  {
    title: 'Board Meetings Participation',
    descriptiveValue: '95% attendance',
    tooltip: 'Percentage of board meetings attended by our representatives',
  },
  {
    title: 'Total Commits',
    descriptiveValue: '1,247',
    tooltip: 'Total code commits to CNCF projects this year',
  },
];

/**
 * Impact metrics for board member organization involvement
 * These are displayed in a list format without charts
 */
export const IMPACT_METRICS: ImpactMetric[] = [
  {
    title: 'Projects Participating',
    descriptiveValue: '2 projects',
    tooltip: 'Number of CNCF projects with active contributions from our organization',
  },
  {
    title: 'Event Attendees',
    descriptiveValue: '156 employees',
    tooltip: 'Total employees attending CNCF events this year',
  },
  {
    title: 'Event Speakers',
    descriptiveValue: '23 speakers',
    tooltip: 'Employee speakers presenting at CNCF events',
  },
  {
    title: 'Certified Employees',
    descriptiveValue: '47 certifications',
    tooltip: 'Employees with CNCF certifications',
  },
];
