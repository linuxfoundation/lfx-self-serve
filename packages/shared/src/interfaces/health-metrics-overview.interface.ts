// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_OVERVIEW_AREAS, HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '../constants/health-metrics-overview.constants';

/** Area key, fixed order per LFXV2-3365: Engagement, Events, Members, Non-Members, Training, Code. */
export type HealthMetricsOverviewArea = (typeof HEALTH_METRICS_OVERVIEW_AREAS)[number]['key'];

/** Urgency classification — never a category or a composite score, per the logic spec's hard constraints. */
export type HealthMetricsOverviewClassification = keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS;

/** Mirrors the `hm_area_state` dbt table (LFXV2-3364) — always one row per area per foundation per period. */
export interface HealthMetricsAreaState {
  area: HealthMetricsOverviewArea;
  statValue: string;
  statLabel: string;
  statSource: string;
  classification: HealthMetricsOverviewClassification;
  evaluatedAt: string;
}

/** Mirrors the `hm_findings` dbt table (LFXV2-3364) — one row per triggered rule per area/entity. */
export interface HealthMetricsFinding {
  classification: HealthMetricsOverviewClassification;
  area: HealthMetricsOverviewArea;
  title: string;
  sentence: string;
  keyValue: string;
  keyLabel: string;
  linkTarget: string;
  sortRank: number;
  evaluatedAt: string;
  visual?: HealthMetricsFindingVisual;
}

/** Optional per-finding visual encoding (logic spec §8.7) — omitted for "good"/"none" classification findings. */
export type HealthMetricsFindingVisual =
  | { kind: 'dots'; groups: HealthMetricsFindingVisualDotGroup[] }
  | { kind: 'bar'; parts: HealthMetricsFindingVisualBarPart[]; caption?: string }
  | { kind: 'band'; low: number; high: number; goal: number; caption?: string }
  | { kind: 'tags'; tags: string[] };

export interface HealthMetricsFindingVisualDotGroup {
  label: string;
  filled: number;
  total: number;
}

export interface HealthMetricsFindingVisualBarPart {
  label: string;
  value: number;
  tone: HealthMetricsOverviewClassification;
}

/** Container-computed view model for `lfx-health-metrics-overview-tile` — one per rendered tile. */
export interface HealthMetricsOverviewTileViewModel {
  area: HealthMetricsOverviewArea;
  name: string;
  icon: string;
  statValue: string;
  statLabel: string;
  classification: HealthMetricsOverviewClassification;
  evaluatedAt: string;
  /** Set only for the `code` area — tile renders an "LFX Insights" link instead of a status word. */
  insightsUrl?: string;
}

/** Container-computed view model for `lfx-health-metrics-overview-finding-item` — one per finding row. */
export interface HealthMetricsOverviewFindingViewModel {
  classification: HealthMetricsOverviewClassification;
  area: HealthMetricsOverviewArea;
  areaLabel: string;
  title: string;
  sentence: string;
  keyValue: string;
  keyLabel: string;
  evaluatedAt: string;
  linkHref?: string;
  linkIsExternal: boolean;
  visual?: HealthMetricsFindingVisual;
}

/** One fixed findings-list section (per {@link HEALTH_METRICS_OVERVIEW_GROUP_ORDER}); hidden when empty. */
export interface HealthMetricsOverviewFindingGroup {
  group: string;
  findings: HealthMetricsOverviewFindingViewModel[];
}
