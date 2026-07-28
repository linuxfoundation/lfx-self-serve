// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationMaintainersDistributionResponse, FoundationMaintainersMonthlyResponse, FoundationMaintainersResponse } from '../interfaces';

export const DEFAULT_FOUNDATION_MAINTAINERS: FoundationMaintainersResponse = {
  currentMaintainers: 0,
  asOfDate: null,
  trendData: [],
  trendLabels: [],
};

export const DEFAULT_FOUNDATION_MAINTAINERS_MONTHLY: FoundationMaintainersMonthlyResponse = { monthlyData: [], monthlyLabels: [] };

export const DEFAULT_FOUNDATION_MAINTAINERS_DISTRIBUTION: FoundationMaintainersDistributionResponse = { distribution: [] };
