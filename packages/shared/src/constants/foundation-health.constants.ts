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
  {
    id: 'hyperledger',
    name: 'Hyperledger',
    logo: 'https://www.hyperledger.org/wp-content/uploads/2018/03/Hyperledger_Logo.png',
    projectCount: 16,
    totalMembers: 250,
    memberBreakdown: {
      platinum: 50,
      gold: 100,
      silver: 100,
    },
    softwareValue: 1200, // $1.2B
    activeContributors: generateSmoothData(365, 975, 125),
    maintainers: generateSmoothData(365, 180, 20),
    eventsMonthly: [1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2],
    upcomingEvents: 7,
    orgDependency: {
      topOrgsCount: 9,
      topOrgsPercentage: 68,
      otherOrgsCount: 215,
      otherOrgsPercentage: 32,
      riskLevel: 'moderate',
    },
    healthScore: 'healthy',
  },
  {
    id: 'lf-ai-data',
    name: 'LF AI & Data',
    logo: 'https://lfaidata.foundation/wp-content/uploads/sites/4/2020/03/lfai-color.svg',
    projectCount: 12,
    totalMembers: 165,
    memberBreakdown: {
      platinum: 30,
      gold: 50,
      silver: 85,
    },
    softwareValue: 750, // $750M
    activeContributors: generateSmoothData(365, 765, 85),
    maintainers: generateSmoothData(365, 127, 18),
    eventsMonthly: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
    upcomingEvents: 6,
    orgDependency: {
      topOrgsCount: 11,
      topOrgsPercentage: 61,
      otherOrgsCount: 146,
      otherOrgsPercentage: 39,
      riskLevel: 'moderate',
    },
    healthScore: 'stable',
  },
  {
    id: 'lf-energy',
    name: 'LF Energy',
    logo: 'https://www.lfenergy.org/wp-content/uploads/sites/4/2019/01/lf-energy-color.svg',
    projectCount: 8,
    totalMembers: 100,
    memberBreakdown: {
      platinum: 20,
      gold: 30,
      silver: 50,
    },
    softwareValue: 450, // $450M
    activeContributors: generateSmoothData(365, 370, 50),
    maintainers: generateSmoothData(365, 75, 10),
    eventsMonthly: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1],
    upcomingEvents: 5,
    orgDependency: {
      topOrgsCount: 5,
      topOrgsPercentage: 74,
      otherOrgsCount: 83,
      otherOrgsPercentage: 26,
      riskLevel: 'high',
    },
    healthScore: 'unsteady',
  },
  {
    id: 'openssf',
    name: 'OpenSSF',
    logo: 'https://openssf.org/wp-content/uploads/sites/132/2022/10/openssf-horizontal-color.svg',
    projectCount: 14,
    totalMembers: 185,
    memberBreakdown: {
      platinum: 40,
      gold: 60,
      silver: 85,
    },
    softwareValue: 1500, // $1.5B
    activeContributors: generateSmoothData(365, 600, 80),
    maintainers: generateSmoothData(365, 110, 15),
    eventsMonthly: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
    upcomingEvents: 5,
    orgDependency: {
      topOrgsCount: 22,
      topOrgsPercentage: 55,
      otherOrgsCount: 157,
      otherOrgsPercentage: 45,
      riskLevel: 'low',
    },
    healthScore: 'critical',
  },
];
