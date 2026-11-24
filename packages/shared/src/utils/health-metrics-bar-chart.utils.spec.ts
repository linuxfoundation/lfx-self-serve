// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthMetricsBarChart } from './health-metrics-bar-chart.utils';

import type { HealthMetricsBarChartInput, HealthMetricsBarChartInputBar } from '../interfaces/health-metrics-bar-chart.interface';

function bar(
  key: string,
  value: number | null,
  lineValue: number | null,
  overrides: Partial<HealthMetricsBarChartInputBar> = {}
): HealthMetricsBarChartInputBar {
  return {
    key,
    label: key,
    value,
    valueLabel: value === null ? '—' : `${value}%`,
    labelTone: 'muted',
    color: '#FB2C36',
    opacity: 0.3,
    lineValue,
    tip: { title: key, rows: [{ label: 'Rate', value: value === null ? '—' : `${value}%`, color: '#FB2C36', separated: false }] },
    ...overrides,
  };
}

function input(overrides: Partial<HealthMetricsBarChartInput> = {}): HealthMetricsBarChartInput {
  return {
    bars: [bar('2024', 4, 8), bar('2025', 8, 4), bar('2026', 16, 12, { labelTone: 'strong', opacity: 1 })],
    heightPx: 180,
    barWidthPx: 40,
    max: 16,
    ticks: ['16%', '12%', '8%', '4%', '0%'],
    line: { color: '#009AFF', max: 16, ticks: [] },
    legend: [{ key: 'rate', label: 'Rate', color: '#FB2C36', kind: 'bar' }],
    ariaLabel: 'Rates by year',
    ...overrides,
  };
}

describe('buildHealthMetricsBarChart', () => {
  it('sizes each bar against the axis top, toning its value label', () => {
    const chart = buildHealthMetricsBarChart(input());

    expect(chart.bars.map((item) => [item.heightPct, item.opacity, item.valueLabel, item.valueLabelClass])).toEqual([
      [25, 0.3, '4%', 'text-gray-500'],
      [50, 0.3, '8%', 'text-gray-500'],
      [100, 1, '16%', 'text-gray-900'],
    ]);
    expect(chart.bars[2].ariaLabel).toBe('2026, Rate 16%');
    expect(chart.yTicks).toEqual(['16%', '12%', '8%', '4%', '0%']);
    expect(chart.rightTicks).toEqual([]);
  });

  it('draws the line through each bar centre, breaking it at a missing point', () => {
    const chart = buildHealthMetricsBarChart(input({ bars: [bar('a', 4, 8), bar('b', 8, null), bar('c', 16, 12), bar('d', 8, 4)] }));

    expect(chart.line?.dots).toEqual([
      { key: 'a', xPct: 12.5, yPct: 50 },
      { key: 'c', xPct: 62.5, yPct: 25 },
      { key: 'd', xPct: 87.5, yPct: 75 },
    ]);
    expect(chart.line?.path).toBe('M12.5 50 M62.5 25 L87.5 75');
  });

  it('draws no bar for a missing value, holds bars to the plot, and carries a right-hand axis', () => {
    const chart = buildHealthMetricsBarChart(
      input({ bars: [bar('a', null, null), bar('b', 40, 2), bar('c', -3, 5)], line: { color: '#009AFF', max: 4, ticks: ['4', '2', '0'] } })
    );

    expect(chart.bars.map((item) => [item.heightPct, item.valueLabel])).toEqual([
      [0, ''],
      [100, '40%'],
      [0, '-3%'],
    ]);
    expect(chart.line?.dots.map((dot) => dot.yPct)).toEqual([50, 0]);
    expect(chart.rightTicks).toEqual(['4', '2', '0']);
  });

  it('draws nothing above a zero axis and leaves the line out when there is none', () => {
    const chart = buildHealthMetricsBarChart(input({ max: 0, line: null }));

    expect(chart.bars.every((item) => item.heightPct === 0)).toBe(true);
    expect(chart.line).toBeNull();
  });
});
