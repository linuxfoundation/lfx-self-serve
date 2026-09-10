// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
  HEALTH_METRICS_OVERVIEW_LINK_TARGETS,
} from '../constants/health-metrics-overview.constants';

/** Area key, fixed order per LFXV2-3365: Engagement, Events, Members, Non-Members, Training, Code. */
export type HealthMetricsOverviewArea = (typeof HEALTH_METRICS_OVERVIEW_AREAS)[number]['key'];

/** Urgency classification — never a category or a composite score, per the logic spec's hard constraints. */
export type HealthMetricsOverviewClassification = keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS;

/** A recognized `hm_findings.link_target` value — every PCC anchor key plus the one external Insights target. */
export type HealthMetricsOverviewLinkTarget = keyof typeof HEALTH_METRICS_OVERVIEW_LINK_TARGETS | typeof HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET;

/**
 * Mirrors the `hm_area_state` dbt table (LFXV2-3364) — always one row per area per foundation per
 * period. Fields are camelCase here; whatever service layer calls the LFXV2-3364 API is responsible
 * for mapping the table's snake_case columns (`stat_value`, `evaluated_at`, ...) onto this shape.
 */
export interface HealthMetricsAreaState {
  area: HealthMetricsOverviewArea;
  statValue: string;
  statLabel: string;
  statSource: string;
  classification: HealthMetricsOverviewClassification;
  evaluatedAt: string;
}

/**
 * Mirrors the `hm_findings` dbt table (LFXV2-3364) — one row per triggered rule per area/entity.
 * Fields are camelCase here; the mapping from the table's snake_case columns (`key_value`,
 * `link_target`, `sort_rank`, ...) is the responsibility of whatever service layer calls the API.
 * `sentence` is plain text with no markup; `emphasis`, when present, names the exact substring of
 * `sentence` the UI should render in bold — see `sentenceSegments` in the finding-item component.
 */
export interface HealthMetricsFinding {
  classification: HealthMetricsOverviewClassification;
  area: HealthMetricsOverviewArea;
  title: string;
  sentence: string;
  emphasis?: string;
  keyValue: string;
  keyLabel: string;
  linkTarget: HealthMetricsOverviewLinkTarget;
  sortRank: number;
  evaluatedAt: string;
  visual?: HealthMetricsFindingVisual;
}

/** Optional per-finding visual encoding (logic spec §8.7) — omitted for "good"/"none" classification findings. */
export type HealthMetricsFindingVisual =
  | { kind: 'dots'; groups: HealthMetricsFindingVisualDotGroup[] }
  | ({ kind: 'bar' } & HealthMetricsFindingVisualBar)
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

/** The `bar` member of {@link HealthMetricsFindingVisual}, named so the finding-item component can type its precomputed view model against it. */
export interface HealthMetricsFindingVisualBar {
  parts: HealthMetricsFindingVisualBarPart[];
  caption?: string;
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
  emphasis?: string;
  keyValue: string;
  keyLabel: string;
  /** Carried through from {@link HealthMetricsFinding.sortRank} — display order and, since it's unique per row, also this row's `@for` track key and `data-testid` suffix. */
  sortRank: number;
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

/** Raw-{@link HealthMetricsFinding} counterpart of {@link HealthMetricsOverviewFindingGroup}, returned by `groupHealthMetricsOverviewFindings` before per-finding view-model mapping (link resolution needs foundation context the pure grouping function doesn't have). */
export interface HealthMetricsOverviewFindingGroupRows {
  group: string;
  findings: HealthMetricsFinding[];
}

/** One segment of a finding's `sentence`, split around its optional `emphasis` substring — lets the template render bold text via interpolation instead of `[innerHTML]`. */
export interface HealthMetricsSentenceSegment {
  text: string;
  bold: boolean;
}

/** Precomputed dot-cluster group ready for iteration — `dots[i]` is `true` when that dot renders filled. Rendered dot count is capped and proportionally scaled; see `health-metrics-overview-finding-item.component.ts`. */
export interface HealthMetricsFindingVisualDotsGroupViewModel {
  label: string;
  dots: boolean[];
}

/** A {@link HealthMetricsFindingVisualBarPart} with its classification tone pre-resolved to a Tailwind color class, so the template never calls a method to look it up. */
export interface HealthMetricsFindingVisualBarPartViewModel extends HealthMetricsFindingVisualBarPart {
  toneClass: string;
}

/** Precomputed bar-visual view model for `lfx-health-metrics-overview-finding-item`. */
export interface HealthMetricsFindingVisualBarViewModel {
  parts: HealthMetricsFindingVisualBarPartViewModel[];
  caption?: string;
}
