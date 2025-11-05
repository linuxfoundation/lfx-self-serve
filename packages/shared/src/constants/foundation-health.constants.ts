// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Foundation } from '../interfaces/dashboard.interface';

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
 * Matches the React implementation with mock data for 5 major foundations
 */
export const FOUNDATION_HEALTH_DATA: Foundation[] = [
  {
    id: 'cncf',
    name: 'CNCF',
    logo: 'https://www.cncf.io/wp-content/uploads/2023/04/cncf-color.svg',
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
    softwareValue: 2800, // $2.8B
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
  },
];
