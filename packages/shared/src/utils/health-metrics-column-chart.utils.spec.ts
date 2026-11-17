// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthMetricsColumnChart, formatHealthMetricsChartCompact, healthMetricsColumnChartCeiling } from './health-metrics-column-chart.utils';

import type { HealthMetricsColumnChartInput } from '../interfaces/health-metrics-column-chart.interface';

function input(overrides: Partial<HealthMetricsColumnChartInput> = {}): HealthMetricsColumnChartInput {
  return {
    series: [
      { key: 'accepted', label: 'Accepted', color: '#009AFF' },
      { key: 'declined', label: 'Declined', color: '#FB2C36' },
    ],
    columns: [
      { key: '2025', label: '2025', sub: '', values: [250, 855], total: 1105, muted: true, tipTitle: '2025' },
      { key: '2026', label: '2026', sub: 'partial', values: [286, null], total: 286, muted: false, tipTitle: '2026 · partial year' },
    ],
    peak: 1240,
    heightPx: 200,
    barWidthPx: 40,
    formatTotal: (value) => value.toLocaleString('en-US'),
    formatValue: (value) => value.toLocaleString('en-US'),
    ariaLabel: 'Proposals by year',
    ...overrides,
  };
}

describe('buildHealthMetricsColumnChart', () => {
  it('stacks each series bottom up as a share of the rounded axis, with the total on top', () => {
    const [first] = buildHealthMetricsColumnChart(input()).columns;

    const round = (value: number) => Math.round(value * 1000) / 1000;
    expect(first.segments.map((segment) => [segment.key, round(segment.bottomPct), round(segment.heightPct)])).toEqual([
      ['accepted', 0, 15.625],
      ['declined', 15.625, 53.438],
    ]);
    expect([first.total, round(first.totalBottomPct), first.opacity]).toEqual(['1,105', 69.063, 0.35]);
  });

  it('rounds the top of the highest drawn segment only, so the stack keeps its rounded corners', () => {
    const [first, second] = buildHealthMetricsColumnChart(input()).columns;

    expect(first.segments.map((segment) => segment.top)).toEqual([false, true]);
    expect(second.segments.map((segment) => segment.top)).toEqual([true, false]);
  });

  it('labels the y axis top down in quarters', () => {
    expect(buildHealthMetricsColumnChart(input()).yTicks).toEqual(['1.6K', '1.2K', '800', '400', '0']);
  });

  it('lists each series in the popup, then a Total row with no swatch, and names the column for screen readers', () => {
    const [, second] = buildHealthMetricsColumnChart(input()).columns;

    expect(second.tip).toEqual({
      title: '2026 · partial year',
      rows: [
        { label: 'Accepted', value: '286', color: '#009AFF', separated: false },
        { label: 'Declined', value: '—', color: '#FB2C36', separated: false },
        { label: 'Total', value: '286', color: 'transparent', separated: false },
      ],
    });
    expect(second.ariaLabel).toBe('2026 · partial year, Accepted 286, Declined —, Total 286');
    expect(second.opacity).toBe(1);
  });

  it('reads an unmeasured total as "—", never as 0, with no label above the stack', () => {
    const view = buildHealthMetricsColumnChart(
      input({ columns: [{ key: '2026', label: '2026', sub: '', values: [null, null], total: null, muted: false, tipTitle: '2026' }] })
    );

    expect(view.columns[0].total).toBe('');
    expect(view.columns[0].tip.rows.at(-1)).toEqual({ label: 'Total', value: '—', color: 'transparent', separated: false });
  });

  it('keeps an empty slot for a column with no data', () => {
    const view = buildHealthMetricsColumnChart(
      input({ columns: [{ key: 'gap', label: '2024', sub: '', values: null, total: null, muted: true, tipTitle: '2024 · no events recorded' }] })
    );

    expect(view.columns[0]).toMatchObject({ total: '', segments: [], tip: { title: '2024 · no events recorded', rows: [] } });
  });
});

describe('healthMetricsColumnChartCeiling', () => {
  it.each([
    [20274, 24000],
    [1240, 1600],
    [380, 400],
    [9, 12],
    [5, 8],
    [3, 4],
    [Number.NaN, 4],
  ])('rounds a peak of %s up to %s, so each quarter is a clean step', (peak, ceiling) => {
    expect(healthMetricsColumnChartCeiling(peak)).toBe(ceiling);
  });
});

describe('formatHealthMetricsChartCompact', () => {
  it.each([
    [24000, '24K'],
    [10797, '10.8K'],
    [150300, '150K'],
    [1600, '1.6K'],
    [800, '800'],
    [1500000, '1.5M'],
    [999960, '1M'],
    [999600, '1M'],
  ])('writes %s as %s, as the design does', (value, label) => {
    expect(formatHealthMetricsChartCompact(value)).toBe(label);
  });
});
