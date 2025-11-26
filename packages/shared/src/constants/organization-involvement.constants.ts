// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PrimaryInvolvementMetric } from '../interfaces/dashboard.interface';
import { lfxColors } from './colors.constants';

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
    icon: 'fa-light fa-dollar-sign',
    isMembershipTier: true,
  },
  {
    title: 'Active Contributors',
    icon: 'fa-light fa-users',
    sparklineData: generateTrendData(12, 60),
    sparklineColor: lfxColors.blue[300],
    chartType: 'line' as const,
  },
  {
    title: 'Maintainers',
    icon: 'fa-light fa-user-check',
    sparklineData: generateTrendData(12, 60),
    sparklineColor: lfxColors.blue[300],
    chartType: 'line' as const,
  },
  {
    title: 'Event Attendees',
    icon: 'fa-light fa-user-group',
    sparklineData: generateTrendData(30, 150),
    sparklineColor: lfxColors.violet[500],
    chartType: 'line' as const,
  },
  {
    title: 'Event Speakers',
    icon: 'fa-light fa-microphone',
    sparklineData: generateTrendData(30, 20),
    sparklineColor: lfxColors.emerald[500],
    chartType: 'line' as const,
  },
  {
    title: 'Certified Employees',
    icon: 'fa-light fa-certificate',
    sparklineData: generateTrendData(30, 45),
    sparklineColor: lfxColors.amber[500],
    chartType: 'line' as const,
  },
  {
    title: 'Training Enrollments',
    icon: 'fa-light fa-graduation-cap',
    sparklineData: generateTrendData(30, 80),
    sparklineColor: lfxColors.gray[300],
    chartType: 'line' as const,
  },
];
