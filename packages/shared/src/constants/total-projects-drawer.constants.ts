// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationProjectsDetailResponse, FoundationProjectsLifecycleDistributionResponse, FoundationTotalProjectsResponse } from '../interfaces';

export const DEFAULT_FOUNDATION_TOTAL_PROJECTS: FoundationTotalProjectsResponse = { totalProjects: 0, monthlyData: [], monthlyLabels: [] };

export const DEFAULT_FOUNDATION_PROJECTS_DETAIL: FoundationProjectsDetailResponse = { projects: [], totalCount: 0 };

export const DEFAULT_FOUNDATION_PROJECTS_LIFECYCLE: FoundationProjectsLifecycleDistributionResponse = { distribution: [] };

export const TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE = 10;
