// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FlywheelConversionResponse,
  FoundationTotalMembersResponse,
  FoundationTotalProjectsResponse,
  FoundationValueConcentrationResponse,
} from './analytics-data.interface';
import type { HealthMetricsSummaryCard } from './dashboard-metric.interface';

export interface HealthMetricsData {
  totalValue: FoundationValueConcentrationResponse | null;
  totalProjects: FoundationTotalProjectsResponse | null;
  totalMembers: FoundationTotalMembersResponse | null;
  flywheel: FlywheelConversionResponse | null;
}

export interface DisplayCard {
  config: HealthMetricsSummaryCard;
  value: string;
  changePercentage?: string;
  trend?: 'up' | 'down';
}

export interface EngagementSegment {
  label: string;
  count: number;
  percent: number;
  color: string;
  dotColor: string;
}
