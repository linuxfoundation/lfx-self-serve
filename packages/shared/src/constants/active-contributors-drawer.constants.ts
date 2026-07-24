// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FoundationActiveContributorsMonthlyDistinctResponse,
  FoundationActiveContributorsMonthlyResponse,
  FoundationContributorsDistributionResponse,
} from '../interfaces';

export const DEFAULT_FOUNDATION_ACTIVE_CONTRIBUTORS_MONTHLY: FoundationActiveContributorsMonthlyResponse = { monthlyData: [], monthlyLabels: [] };

export const DEFAULT_FOUNDATION_ACTIVE_CONTRIBUTORS_MONTHLY_DISTINCT: FoundationActiveContributorsMonthlyDistinctResponse = {
  monthlyData: [],
  monthlyLabels: [],
};

export const DEFAULT_FOUNDATION_CONTRIBUTORS_DISTRIBUTION: FoundationContributorsDistributionResponse = { distribution: [] };
