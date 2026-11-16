// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsChartTipView } from './health-metrics-l2.interface';

/** One line on a Health Metrics line chart. */
export interface HealthMetricsLineChartSeries {
  key: string;
  label: string;
  /** Stroke colour, from `HEALTH_METRICS_LINE_CHART_COLORS`. */
  color: string;
  /** One value per x position; `null` breaks the line there. */
  values: readonly (number | null)[];
  /** A soft fill under the line; only the first filled series gets one. */
  fill?: boolean;
  /** A dashed line with no dots, as the design draws a derived series. */
  dashed?: boolean;
}

/** What a Health Metrics line chart plots: one x position per label, on a 0 to `max` y axis in quarters. */
export interface HealthMetricsLineChartInput {
  xLabels: readonly string[];
  series: readonly HealthMetricsLineChartSeries[];
  max: number;
  formatTick: (value: number) => string;
  /** The popup for each x position. */
  tips: readonly HealthMetricsChartTipView[];
  ariaLabel: string;
  /** Plot height in px; the design's 200 when left out. */
  heightPx?: number;
}

/** One drawn line of the chart, in the SVG's 600-wide viewBox. */
export interface HealthMetricsLineChartPathView {
  key: string;
  d: string;
  color: string;
  dashed: boolean;
}

/** One 8px hollow dot, positioned in % of the plot. */
export interface HealthMetricsLineChartDotView {
  key: string;
  leftPct: number;
  topPct: number;
  color: string;
}

/** One x position's hover and focus target, centred on it and as wide as the spacing between positions. */
export interface HealthMetricsLineChartColumnView {
  key: string;
  leftPct: number;
  widthPct: number;
  tip: HealthMetricsChartTipView;
  /** The column's accessible name: the popup's title and rows on one line. */
  ariaLabel: string;
}

/** A Health Metrics line chart, ready to draw. */
export interface HealthMetricsLineChartView {
  heightPx: number;
  viewBox: string;
  /** Top to bottom: max, three quarters, half, a quarter, 0. */
  yTicks: string[];
  /** The light rules at the top and each quarter; the base rule is drawn darker. */
  gridYs: number[];
  baseY: number;
  area: { d: string; color: string } | null;
  paths: HealthMetricsLineChartPathView[];
  dots: HealthMetricsLineChartDotView[];
  columns: HealthMetricsLineChartColumnView[];
  xLabels: string[];
  ariaLabel: string;
}
