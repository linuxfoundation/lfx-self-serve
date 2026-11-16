// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_TABLE_COLUMN_SCALE,
  HEALTH_METRICS_TABLE_MIN_WIDTH_CAP_PX,
  HEALTH_METRICS_VALUE_BAR_FILL,
} from '../constants/health-metrics-table.constants';

import type { HealthMetricsBarFillRule, HealthMetricsColumnSort } from '../interfaces/health-metrics-table.interface';

/** A column's minimum width under the redesign: 72% of its old pixel value, rounded. */
export function shrinkHealthMetricsColumnPx(px: number): number {
  return Math.round(px * HEALTH_METRICS_TABLE_COLUMN_SCALE);
}

/** A table's minimum width, capped at 700px so wider content scrolls inside its card. */
export function capHealthMetricsTableMinWidthPx(px: number): number {
  return Math.min(px, HEALTH_METRICS_TABLE_MIN_WIDTH_CAP_PX);
}

/** A bar's fill class for a 0–100 share: the 0% fill, else the first threshold it is under, else the default. */
export function healthMetricsBarFillClass(pct: number, rule: HealthMetricsBarFillRule = HEALTH_METRICS_VALUE_BAR_FILL): string {
  if (pct <= 0) return rule.zeroClass;
  return rule.thresholds.find((threshold) => pct < threshold.below)?.fillClass ?? rule.defaultClass;
}

/** A 0–100 share clamped for a bar's width; `null` when there is no data. */
export function clampHealthMetricsPct(pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return Math.min(Math.max(pct, 0), 100);
}

/** The header icon for a column's sort state: the two-way arrow until sorted, then the sorted direction. */
export function healthMetricsSortIcon(sort: HealthMetricsColumnSort): string {
  if (sort === 'asc') return 'fa-solid fa-arrow-up';
  if (sort === 'desc') return 'fa-solid fa-arrow-down';
  return 'fa-light fa-arrow-up-arrow-down';
}
