// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_SORT_TIER_ORDER,
  HEALTH_METRICS_TABLE_COLUMN_SCALE,
  HEALTH_METRICS_TABLE_DASH,
  HEALTH_METRICS_TABLE_MIN_WIDTH_CAP_PX,
  HEALTH_METRICS_VALUE_BAR_FILL,
} from '../constants/health-metrics-table.constants';

import type {
  HealthMetricsBarFillRule,
  HealthMetricsColumnSort,
  HealthMetricsSortColumn,
  HealthMetricsSortDirection,
  HealthMetricsSortValue,
  HealthMetricsTableSort,
} from '../interfaces/health-metrics-table.interface';

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

/** The sort after a header click: the sorted column flips; any other starts A to Z for text, highest or newest first otherwise. */
export function nextHealthMetricsSort<K extends string>(
  current: HealthMetricsTableSort<K> | null,
  column: HealthMetricsSortColumn<K>
): HealthMetricsTableSort<K> {
  if (current?.key === column.key) return { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key: column.key, direction: column.kind === 'text' ? 'asc' : 'desc' };
}

/** A column's header state under the table's sort. */
export function healthMetricsColumnSortState(sort: HealthMetricsTableSort | null, key: string): HealthMetricsColumnSort {
  return sort?.key === key ? sort.direction : 'none';
}

/** The `aria-sort` for a column's header state. */
export function healthMetricsAriaSort(state: HealthMetricsColumnSort): 'ascending' | 'descending' | 'none' {
  if (state === 'asc') return 'ascending';
  if (state === 'desc') return 'descending';
  return 'none';
}

/** Each ranked tier's normalised name and rank: Non-member 0, any other named tier 1, then up to Diamond. */
export function healthMetricsTierSortRanks(): { name: string; rank: number }[] {
  const nonMember = HEALTH_METRICS_SORT_TIER_ORDER.length - 1;
  return HEALTH_METRICS_SORT_TIER_ORDER.map((tier, index) => ({ name: normalizeTierName(tier), rank: index === nonMember ? 0 : nonMember - index + 1 }));
}

/** A membership tier's sort rank, highest for Diamond; `null` for no tier, which sorts last. */
export function healthMetricsTierSortRank(tier: string | null | undefined): number | null {
  const name = normalizeTierName(tier ?? '');
  if (!name) return null;
  return healthMetricsTierSortRanks().find((entry) => entry.name === name)?.rank ?? 1;
}

/**
 * Two cells' order: numbers by value, text alphabetically ignoring case and accents, as the server's `en-ci-ai`
 * collation sorts it; an empty cell ("—", blank or `null`) goes last in both directions.
 */
export function compareHealthMetricsSortValues(a: HealthMetricsSortValue, b: HealthMetricsSortValue, direction: HealthMetricsSortDirection): number {
  const aEmpty = isEmptySortValue(a);
  const bEmpty = isEmptySortValue(b);
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);

  const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
  return direction === 'asc' ? order : -order;
}

/**
 * The whole list in the sort's order, so a page shows its slice of it. Ties keep the given order, which is the table's
 * default; pinned rows, such as totals, stay last in theirs.
 */
export function sortHealthMetricsRows<T, K extends string>(
  rows: readonly T[],
  sort: HealthMetricsTableSort<K> | null,
  value: (row: T, key: K) => HealthMetricsSortValue,
  pinned: (row: T) => boolean = () => false
): T[] {
  if (!sort) return [...rows.filter((row) => !pinned(row)), ...rows.filter(pinned)];

  const sorted = rows
    .filter((row) => !pinned(row))
    .map((row, index) => ({ row, index, value: value(row, sort.key) }))
    .sort((a, b) => compareHealthMetricsSortValues(a.value, b.value, sort.direction) || a.index - b.index)
    .map((entry) => entry.row);
  return [...sorted, ...rows.filter(pinned)];
}

/** A request's sort, kept only for an allowed column and a known direction; anything else is the table's default order. */
export function parseHealthMetricsTableSort<K extends string>(key: unknown, direction: unknown, allowed: readonly K[]): HealthMetricsTableSort<K> | null {
  if (typeof key !== 'string' || !(allowed as readonly string[]).includes(key)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { key: key as K, direction };
}

function isEmptySortValue(value: HealthMetricsSortValue): boolean {
  if (value === null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  const text = value.trim();
  return text === '' || text === HEALTH_METRICS_TABLE_DASH;
}

/** "Non-Member" and "non member" both read `nonmember`. */
function normalizeTierName(tier: string): string {
  return tier.toLowerCase().replace(/[^a-z]/g, '');
}
