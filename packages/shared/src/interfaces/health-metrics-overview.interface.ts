// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_OVERVIEW_AREAS,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET,
  HEALTH_METRICS_OVERVIEW_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS,
} from '../constants/health-metrics-overview.constants';

/** Area key, fixed order per LFXV2-3365: Engagement, Events, Members, Non-Members, Training, Code. */
export type HealthMetricsOverviewArea = (typeof HEALTH_METRICS_OVERVIEW_AREAS)[number]['key'];

/** Urgency classification — never a category or a composite score, per the logic spec's hard constraints. */
export type HealthMetricsOverviewClassification = keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS;

/** A rail revenue-stream key — fixed 3-stream set per `railHTML()`'s legend. */
export type HealthMetricsOverviewRevenueStreamKey = keyof typeof HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS;

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
 * `sentence` is plain text with no markup. `emphasis`, when present, names a substring of `sentence`
 * of potential future interest to callers — the finding-item component renders `sentence` as plain
 * text (matching the design) and does not use this field.
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

/**
 * Optional per-finding visual encoding (logic spec §8.7) — omitted for "good"/"none" classification
 * findings. `band`'s `pred` is the point-prediction fill (design's `fband-pred`, painted over the
 * `low`–`high` predicted-range band) — all four values are percentages (0-100) on the same axis.
 */
export type HealthMetricsFindingVisual =
  | { kind: 'dots'; groups: HealthMetricsFindingVisualDotGroup[]; caption?: string }
  | ({ kind: 'bar' } & HealthMetricsFindingVisualBar)
  | { kind: 'band'; low: number; high: number; goal: number; pred: number; caption?: string }
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
  /** The section's classification key — a stable lookup key for its tone/icon, independent of the display-string `group` label. */
  classification: HealthMetricsOverviewClassification;
  /** The section's classification tone, as a Tailwind text-color class — colors the group heading. */
  groupTextClass: string;
  /** The section's classification icon (design's `TTONE`/group-header icon set) — same icon as the matching tile's status row. */
  groupIcon: string;
  findings: HealthMetricsOverviewFindingViewModel[];
}

/** Raw-{@link HealthMetricsFinding} counterpart of {@link HealthMetricsOverviewFindingGroup}, returned by `groupHealthMetricsOverviewFindings` before per-finding view-model mapping (link resolution needs foundation context the pure grouping function doesn't have). */
export interface HealthMetricsOverviewFindingGroupRows {
  group: string;
  classification: HealthMetricsOverviewClassification;
  findings: HealthMetricsFinding[];
}

/**
 * Precomputed dots-visual view model for `lfx-health-metrics-overview-finding-item`. Per the
 * design's `fviz()`, all of a finding's dot groups render as ONE flat row (not one row per group) —
 * `dots[i]` is `true` when that dot renders filled; `caption` is the first group's label, shown
 * below the row like the design's universal `fvs` sub-caption. Rendered dot count is capped and
 * proportionally scaled; see `health-metrics-overview-finding-item.component.ts`.
 */
export interface HealthMetricsFindingVisualDotsViewModel {
  dots: boolean[];
  caption?: string;
}

/**
 * Precomputed bar-visual view model for `lfx-health-metrics-overview-finding-item`. Per the
 * design's `fviz()`, a bar renders as a SINGLE fill sized to the sum of the authored parts'
 * `value`s (clamped to 100) in the finding's own classification tone — `parts[].tone` is authored
 * data (kept for a future per-segment rendering) but never individually rendered today.
 */
export interface HealthMetricsFindingVisualBarViewModel {
  fillPercent: number;
  toneClass: string;
  caption?: string;
}

/** Rail "Foundation Revenue" raw data (LFXV2-3364 stand-in) — mirrors the design's `d.revenue`. */
export interface HealthMetricsOverviewRevenue {
  total: number;
  streams: { key: HealthMetricsOverviewRevenueStreamKey; value: number }[];
}

/** Rail "Foundation" block raw data (LFXV2-3364 stand-in) — mirrors the design's `RAIL[CUR]` plus `d.code.projects`. */
export interface HealthMetricsOverviewFoundationSummary {
  size: string;
  projects: number;
  tiers: string;
  board: string;
  nextRenewals: string;
}

/** Precomputed "Foundation Revenue" legend row for `lfx-health-metrics-overview-rail`. */
export interface HealthMetricsOverviewRevenueStreamViewModel {
  label: string;
  dotClass: string;
  percent: number;
  valueLabel: string;
}
