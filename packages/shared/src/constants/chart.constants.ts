// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartOptions } from 'chart.js';
import { lfxColors } from './colors.constants';

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
