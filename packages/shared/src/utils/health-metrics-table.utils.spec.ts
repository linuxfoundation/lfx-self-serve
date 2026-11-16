// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  capHealthMetricsTableMinWidthPx,
  clampHealthMetricsPct,
  healthMetricsBarFillClass,
  healthMetricsSortIcon,
  shrinkHealthMetricsColumnPx,
} from './health-metrics-table.utils';

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
