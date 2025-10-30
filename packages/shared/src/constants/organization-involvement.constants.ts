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
 * Primary metrics for board member organization involvement
 * Matches the React implementation for CNCF Overview page
 */
export const PRIMARY_INVOLVEMENT_METRICS: PrimaryInvolvementMetric[] = [
  {
    // NOTE: All membership tier values are placeholders - replaced with real Snowflake data in component
    title: 'Membership Tier',
    value: 'Silver',
    subtitle: 'since January 2024',
    tier: 'Silver',
    tierSince: 'January 2024',
    annualFee: '$0',
    nextDue: 'January 1, 2025',
    isMembershipTier: true,
  },
  {
    title: 'Event Sponsorship',
    value: '$250K',
    subtitle: '8 events sponsored this year',
    icon: 'fa-light fa-dollar-sign',
    sparklineData: generateTrendData(12, 250000),
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
  },
  {
    title: 'Active Contributors',
    value: '847',
    subtitle: 'Contributors from our organization',
    icon: 'fa-light fa-users',
    sparklineData: [645, 678, 702, 725, 748, 771, 794, 812, 829, 835, 842, 847],
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
  },
  {
    // NOTE: Value and subtitle are placeholder - replaced with real Snowflake data in component
    title: 'Maintainers',
    value: '60',
    subtitle: 'Across multiple projects',
    icon: 'fa-light fa-user-check',
    sparklineData: generateTrendData(12, 60),
    sparklineColor: '#0094FF',
    chartType: 'line' as const,
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
