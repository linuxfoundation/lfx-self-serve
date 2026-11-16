// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthMetricsLineChart, healthMetricsLineChartCountCeiling } from './health-metrics-line-chart.utils';

import type { HealthMetricsLineChartInput } from '../interfaces/health-metrics-line-chart.interface';

function input(overrides: Partial<HealthMetricsLineChartInput> = {}): HealthMetricsLineChartInput {
  return {
    xLabels: ['Jan', 'Feb', 'Mar'],
    series: [
      { key: 'open', label: 'Open rate', color: '#009AFF', values: [40, 50, 20], fill: true },
      { key: 'cto', label: 'Click-to-open rate', color: '#00BC7D', values: [10, null, 5], dashed: true },
    ],
    max: 100,
    formatTick: (value) => `${Math.round(value)}%`,
    tips: [
      { title: 'One · Jan 4, 2026', rows: [{ label: 'Open rate', value: '40%', color: '#009AFF', separated: false, inline: true }] },
      { title: 'Two · Feb 4, 2026', rows: [] },
      { title: 'Three · Mar 4, 2026', rows: [] },
    ],
    ariaLabel: 'Open rate by newsletter',
    ...overrides,
  };
}

describe('buildHealthMetricsLineChart', () => {
  it('draws straight segments across the 600-wide box, the first point at the left edge and the last at the right', () => {
    const chart = buildHealthMetricsLineChart(input());

    expect(chart.viewBox).toBe('0 0 600 200');
    expect(chart.paths[0]).toEqual({ key: 'open', d: 'M0.0 120.0 L300.0 100.0 L600.0 160.0', color: '#009AFF', dashed: false });
  });

  it('breaks a line at a missing value, and dashes a derived series', () => {
    expect(buildHealthMetricsLineChart(input()).paths[1]).toEqual({ key: 'cto', d: 'M0.0 180.0 M600.0 190.0', color: '#00BC7D', dashed: true });
  });

  it('fills under the first filled series down to the base', () => {
    expect(buildHealthMetricsLineChart(input()).area).toEqual({ d: 'M0.0 120.0 L300.0 100.0 L600.0 160.0 L600.0 200 L0.0 200 Z', color: '#009AFF' });
    expect(buildHealthMetricsLineChart(input({ series: [{ key: 'a', label: 'A', color: '#000', values: [1, 2, 3] }] })).area).toBeNull();
  });

  // The design draws no dots on a dashed series.
  it('dots every value of a solid series only', () => {
    const dots = buildHealthMetricsLineChart(input()).dots;

    expect(dots.map((dot) => dot.key)).toEqual(['open-0', 'open-1', 'open-2']);
    expect(dots[1]).toMatchObject({ leftPct: 50, topPct: 50, color: '#009AFF' });
  });

  it('labels the y axis top to bottom in quarters, and rules the top and each quarter', () => {
    const chart = buildHealthMetricsLineChart(input());

    expect(chart.yTicks).toEqual(['100%', '75%', '50%', '25%', '0%']);
    expect(chart.gridYs).toEqual([0, 50, 100, 150]);
    expect(chart.baseY).toBe(200);
  });

  it('gives each x position a centred column with its popup and an accessible name', () => {
    const columns = buildHealthMetricsLineChart(input()).columns;

    expect(columns.map((column) => [column.leftPct, column.widthPct])).toEqual([
      [0, 100 / 3],
      [50, 100 / 3],
      [100, 100 / 3],
    ]);
    expect(columns[0].tip.title).toBe('One · Jan 4, 2026');
    expect(columns[0].ariaLabel).toBe('One · Jan 4, 2026, Open rate 40%');
  });

  it('centres a lone point, and clamps a value past the axis', () => {
    const chart = buildHealthMetricsLineChart(input({ xLabels: ['Jan'], series: [{ key: 'a', label: 'A', color: '#000', values: [150] }], tips: [] }));

    expect(chart.paths[0].d).toBe('M300.0 0.0');
    expect(chart.columns[0]).toMatchObject({ leftPct: 50, widthPct: 100, tip: { title: 'Jan', rows: [] } });
  });
});

describe('healthMetricsLineChartCountCeiling', () => {
  it.each([
    [1458, 1600],
    [380, 400],
    [101, 160],
    [10, 10],
    [3, 4],
    [0, 4],
    [Number.NaN, 4],
  ])('rounds a peak of %s up to %s, so each quarter is a round step', (peak, ceiling) => {
    expect(healthMetricsLineChartCountCeiling(peak)).toBe(ceiling);
  });
});
