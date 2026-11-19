// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_SORT_DORMANT_VALUE } from '../constants/health-metrics-table.constants';
import {
  capHealthMetricsTableMinWidthPx,
  clampHealthMetricsPct,
  compareHealthMetricsSortValues,
  healthMetricsAriaSort,
  healthMetricsBarFillClass,
  healthMetricsColumnSortState,
  healthMetricsSortIcon,
  healthMetricsTierSortRank,
  nextHealthMetricsSort,
  parseHealthMetricsTableSort,
  shrinkHealthMetricsColumnPx,
  sortHealthMetricsRows,
} from './health-metrics-table.utils';

import type { HealthMetricsSortValue } from '../interfaces/health-metrics-table.interface';

describe('health metrics table utils', () => {
  it('shrinks a column minimum to 72%, rounded', () => {
    expect(shrinkHealthMetricsColumnPx(200)).toBe(144);
    expect(shrinkHealthMetricsColumnPx(130)).toBe(94);
  });

  it('caps a table minimum width at 700px', () => {
    expect(capHealthMetricsTableMinWidthPx(1000)).toBe(700);
    expect(capHealthMetricsTableMinWidthPx(640)).toBe(640);
  });

  it('fills a bar neutral at 0%, danger under 20%, warning under 50% and accent above', () => {
    expect(healthMetricsBarFillClass(0)).toBe('bg-gray-300');
    expect(healthMetricsBarFillClass(19)).toBe('bg-red-500');
    expect(healthMetricsBarFillClass(20)).toBe('bg-amber-500');
    expect(healthMetricsBarFillClass(49.9)).toBe('bg-amber-500');
    expect(healthMetricsBarFillClass(50)).toBe('bg-blue-500');
  });

  it('takes a widget’s own thresholds', () => {
    const rule = { zeroClass: 'bg-gray-300', thresholds: [{ below: 80, fillClass: 'bg-emerald-500' }], defaultClass: 'bg-blue-500' };

    expect(healthMetricsBarFillClass(60, rule)).toBe('bg-emerald-500');
    expect(healthMetricsBarFillClass(90, rule)).toBe('bg-blue-500');
  });

  it('clamps a share to 0–100 and reads a missing one as no data', () => {
    expect(clampHealthMetricsPct(140)).toBe(100);
    expect(clampHealthMetricsPct(-5)).toBe(0);
    expect(clampHealthMetricsPct(null)).toBeNull();
    expect(clampHealthMetricsPct(Number.NaN)).toBeNull();
  });

  it('shows the two-way arrow until a column is sorted, then its direction', () => {
    expect(healthMetricsSortIcon('none')).toBe('fa-light fa-arrow-up-arrow-down');
    expect(healthMetricsSortIcon('asc')).toBe('fa-solid fa-arrow-up');
    expect(healthMetricsSortIcon('desc')).toBe('fa-solid fa-arrow-down');
  });
});

describe('health metrics table sorting', () => {
  it('starts text A to Z and every other kind highest first, then flips the sorted column', () => {
    expect(nextHealthMetricsSort(null, { key: 'name', kind: 'text' })).toEqual({ key: 'name', direction: 'asc' });
    expect(nextHealthMetricsSort(null, { key: 'amount', kind: 'number' })).toEqual({ key: 'amount', direction: 'desc' });
    expect(nextHealthMetricsSort({ key: 'name', direction: 'asc' }, { key: 'last', kind: 'date' })).toEqual({ key: 'last', direction: 'desc' });
    expect(nextHealthMetricsSort({ key: 'tier', direction: 'asc' }, { key: 'name', kind: 'text' })).toEqual({ key: 'name', direction: 'asc' });
  });

  it("reverses a column's default direction on its first click", () => {
    expect(nextHealthMetricsSort({ key: 'att', direction: 'asc' }, { key: 'att', kind: 'number' })).toEqual({ key: 'att', direction: 'desc' });
    expect(nextHealthMetricsSort({ key: 'name', direction: 'desc' }, { key: 'name', kind: 'text' })).toEqual({ key: 'name', direction: 'asc' });
  });

  it('gives each header its state and aria-sort, with no arrow state when the table follows no column', () => {
    const sort = { key: 'att', direction: 'desc' } as const;
    expect([healthMetricsColumnSortState(sort, 'att'), healthMetricsColumnSortState(sort, 'name'), healthMetricsColumnSortState(null, 'att')]).toEqual([
      'desc',
      'none',
      'none',
    ]);
    expect([healthMetricsAriaSort('asc'), healthMetricsAriaSort('desc'), healthMetricsAriaSort('none')]).toEqual(['ascending', 'descending', 'none']);
  });

  it('ranks tiers Diamond down to Non-member, any other named tier just above Non-member, and no tier as empty', () => {
    const tiers = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Associate', 'End User Supporter', 'Premier', 'Non-Member'];
    expect(tiers.map(healthMetricsTierSortRank)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(healthMetricsTierSortRank('\u00a0—\u00a0')).toBeNull();
    expect([healthMetricsTierSortRank('non member'), healthMetricsTierSortRank(''), healthMetricsTierSortRank(' — '), healthMetricsTierSortRank(null)]).toEqual(
      [0, null, null, null]
    );
  });

  it('ranks the warehouse\'s "Membership" and "Member" forms as their tier, and a non-Latin name as an unknown tier', () => {
    expect(['Gold Membership', 'Platinum Member', 'Silver (100 - 499)', '会员', '24/7'].map(healthMetricsTierSortRank)).toEqual([5, 6, 4, 1, 1]);
  });

  it('compares numbers by value and text ignoring case, with empty values last in both directions', () => {
    const order = (values: HealthMetricsSortValue[], direction: 'asc' | 'desc'): HealthMetricsSortValue[] =>
      [...values].sort((a, b) => compareHealthMetricsSortValues(a, b, direction));

    expect(order([3, null, 10, 1], 'asc')).toEqual([1, 3, 10, null]);
    expect(order([3, null, 10, 1], 'desc')).toEqual([10, 3, 1, null]);
    expect(order(['beta', '—', 'Alpha', ' ', 'alpha 2'], 'asc')).toEqual(['Alpha', 'alpha 2', 'beta', '—', ' ']);
    expect(order(['2026-01-05', '2025-12-31'], 'desc')).toEqual(['2026-01-05', '2025-12-31']);
    expect(order(['Item 2', 'item 10', 'Éclair', 'Eagle'], 'asc')).toEqual(['Eagle', 'Éclair', 'item 10', 'Item 2']);
    expect(order(['  Zebra', 'Alpha\t'], 'asc')).toEqual(['Alpha\t', '  Zebra']);
    expect(order(['\u00a0', 'Beta', '\u00a0—\u00a0'], 'desc')).toEqual(['Beta', '\u00a0', '\u00a0—\u00a0']);
    expect(order([0, HEALTH_METRICS_SORT_DORMANT_VALUE, 12], 'asc')).toEqual([HEALTH_METRICS_SORT_DORMANT_VALUE, 0, 12]);
  });

  it('sorts the whole list, keeps the given order for ties and keeps pinned rows last, sorted or not', () => {
    const rows = [
      { key: 'a', value: 2 },
      { key: 'b', value: 1 },
      { key: 'total', value: 99 },
      { key: 'c', value: 2 },
      { key: 'd', value: null },
    ];
    const sorted = (direction: 'asc' | 'desc'): string[] =>
      sortHealthMetricsRows(
        rows,
        { key: 'value', direction },
        (row) => row.value,
        (row) => row.key === 'total'
      ).map((row) => row.key);

    expect(sorted('desc')).toEqual(['a', 'c', 'b', 'd', 'total']);
    expect(sorted('asc')).toEqual(['b', 'a', 'c', 'd', 'total']);
    expect(
      sortHealthMetricsRows(
        rows,
        null,
        (row) => row.value,
        (row) => row.key === 'total'
      ).map((row) => row.key)
    ).toEqual(['a', 'b', 'c', 'd', 'total']);
  });

  it("keeps a request's sort only for an allowed column and a known direction", () => {
    const allowed = ['registrations', 'company'] as const;
    expect(parseHealthMetricsTableSort('company', 'asc', allowed)).toEqual({ key: 'company', direction: 'asc' });
    expect(parseHealthMetricsTableSort('company; DROP', 'asc', allowed)).toBeNull();
    expect(parseHealthMetricsTableSort('company', 'sideways', allowed)).toBeNull();
    expect(parseHealthMetricsTableSort(['company'], 'asc', allowed)).toBeNull();
    expect(parseHealthMetricsTableSort(undefined, undefined, allowed)).toBeNull();
  });
});
