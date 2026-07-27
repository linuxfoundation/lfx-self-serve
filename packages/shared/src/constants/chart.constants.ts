// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Chart } from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { lfxColors } from './colors.constants';

/**
 * Chart.js plugin: draws a 4px gray stub on the baseline for zero-value bars on
 * datasets that opt in via `zeroStub: true`. Chart.js renders zero-height bars
 * invisibly, which makes sparse quarterly charts read as "broken" rather than "zero".
 * The `afterDatasetsDraw` hook no-ops for every dataset that doesn't opt in.
 * Pure JS (no canvas access at import), so SSR-safe.
 */
export const ZERO_BAR_STUB_PLUGIN = {
  id: 'lfxZeroBarStub',
  afterDatasetsDraw(chart: Chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = lfxColors.gray[300];
    const datasets = chart.data.datasets ?? [];
    datasets.forEach((ds, datasetIndex) => {
      const flagged = ds as typeof ds & { zeroStub?: boolean };
      if (!flagged?.zeroStub) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta?.type !== 'bar') return;
      const vScale = (meta as { vScale?: { getPixelForValue: (v: number) => number } }).vScale;
      if (!vScale) return;
      const values = (ds.data ?? []) as number[];
      values.forEach((value, valueIndex) => {
        if (value !== 0) return;
        const bar = meta.data[valueIndex] as unknown as { x: number; width: number };
        if (!bar) return;
        const halfWidth = (bar.width || 4) / 2;
        const base = vScale.getPixelForValue(0);
        const stubHeight = 4;
        ctx.beginPath();
        ctx.roundRect(bar.x - halfWidth, base - stubHeight, halfWidth * 2, stubHeight, [2, 2, 0, 0]);
        ctx.fill();
      });
    });
    ctx.restore();
  },
};

/** Deep merge two objects, recursively merging nested objects instead of replacing them */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) && targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
      result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>) as T[keyof T];
    } else {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/** Standard tooltip config shared across all dashboard drawer charts */
export const DASHBOARD_TOOLTIP_CONFIG = {
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  titleColor: lfxColors.gray[900],
  bodyColor: lfxColors.gray[600],
  borderColor: lfxColors.gray[200],
  borderWidth: 1,
  padding: 10,
  cornerRadius: 6,
} as const;

/** Standard axis defaults for dashboard drawer charts */
export const DASHBOARD_AXIS_DEFAULTS = {
  grid: { color: lfxColors.gray[200] },
  ticks: { color: lfxColors.gray[500], font: { size: 11 } },
} as const;

/** Create bar chart options with standard dashboard styling */
export function createBarChartOptions(overrides?: Partial<ChartOptions<'bar'>>): ChartOptions<'bar'> {
  const defaults: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { ...DASHBOARD_TOOLTIP_CONFIG },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { ...DASHBOARD_AXIS_DEFAULTS.ticks },
      },
      y: {
        display: true,
        grid: { ...DASHBOARD_AXIS_DEFAULTS.grid, lineWidth: 1 },
        border: { display: false },
        ticks: { ...DASHBOARD_AXIS_DEFAULTS.ticks },
      },
    },
  };
  return overrides ? (deepMerge(defaults, overrides as Record<string, unknown>) as ChartOptions<'bar'>) : defaults;
}

/** Create line chart options with standard dashboard styling */
export function createLineChartOptions(overrides?: Partial<ChartOptions<'line'>>): ChartOptions<'line'> {
  const defaults: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { ...DASHBOARD_TOOLTIP_CONFIG },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { ...DASHBOARD_AXIS_DEFAULTS.ticks },
      },
      y: {
        display: true,
        grid: { ...DASHBOARD_AXIS_DEFAULTS.grid, lineWidth: 1 },
        border: { display: false },
        ticks: { ...DASHBOARD_AXIS_DEFAULTS.ticks },
      },
    },
  };
  return overrides ? (deepMerge(defaults, overrides as Record<string, unknown>) as ChartOptions<'line'>) : defaults;
}

/** Create horizontal bar chart options with standard dashboard styling */
export function createHorizontalBarChartOptions(overrides?: Partial<ChartOptions<'bar'>>): ChartOptions<'bar'> {
  const defaults: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    plugins: {
      legend: { display: false },
      tooltip: { ...DASHBOARD_TOOLTIP_CONFIG },
    },
    scales: {
      x: {
        display: true,
        grid: { ...DASHBOARD_AXIS_DEFAULTS.grid, lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { ...DASHBOARD_AXIS_DEFAULTS.ticks },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[600], font: { size: 12 } },
      },
    },
    datasets: {
      bar: { barPercentage: 0.8, categoryPercentage: 1.0 },
    },
  };
  return overrides ? (deepMerge(defaults, overrides as Record<string, unknown>) as ChartOptions<'bar'>) : defaults;
}
