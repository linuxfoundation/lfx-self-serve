// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_BAR_CHART_LABEL_CLASSES } from '../constants/health-metrics-bar-chart.constants';
import type { HealthMetricsChartTipView } from './health-metrics-l2.interface';

/** How a bar's value label reads: the latest bar's ink or an earlier bar's muted ink. */
export type HealthMetricsBarChartLabelTone = keyof typeof HEALTH_METRICS_BAR_CHART_LABEL_CLASSES;

/** One bar before layout. */
export interface HealthMetricsBarChartInputBar {
  key: string;
  /** The x label under the bar. */
  label: string;
  /** `null` draws no bar and no label. */
  value: number | null;
  /** The label above the bar, e.g. `12%`. */
  valueLabel: string;
  labelTone: HealthMetricsBarChartLabelTone;
  /** A palette hex from `lfxColors`. */
  color: string;
  /** 1 for the bar that stands out, lower for the bars behind it. */
  opacity: number;
  /** The line's point over this bar; `null` breaks the line. */
  lineValue: number | null;
  tip: HealthMetricsChartTipView;
}

/** A dashed line over the bars, on the bars' axis or its own right-hand one. */
export interface HealthMetricsBarChartInputLine {
  color: string;
  /** Its axis top; the bars' when it shares their axis. */
  max: number;
  /** Labels for a right-hand axis, top to bottom; empty when the line shares the bars' axis. */
  ticks: string[];
}

/** A legend entry: a square swatch for the bars, a dashed stroke for the line. */
export interface HealthMetricsBarChartLegendItem {
  key: string;
  label: string;
  color: string;
  kind: 'bar' | 'line';
}

/** What `buildHealthMetricsBarChart` needs. */
export interface HealthMetricsBarChartInput {
  bars: HealthMetricsBarChartInputBar[];
  heightPx: number;
  barWidthPx: number;
  /** The bars' axis top. */
  max: number;
  /** The bars' axis labels, top to bottom, one per quarter rule. */
  ticks: string[];
  line: HealthMetricsBarChartInputLine | null;
  legend: HealthMetricsBarChartLegendItem[];
  ariaLabel: string;
}

/** One bar, laid out as percentages of the plot's height. */
export interface HealthMetricsBarChartBarView {
  key: string;
  label: string;
  heightPct: number;
  color: string;
  opacity: number;
  valueLabel: string;
  valueLabelClass: string;
  tip: HealthMetricsChartTipView;
  /** The bar's accessible name: the popup's title and rows on one line. */
  ariaLabel: string;
}

/** The dashed line: an SVG path in a 100 × 100 box, and its dots as percentages of the plot. */
export interface HealthMetricsBarChartLineView {
  color: string;
  path: string;
  dots: { key: string; xPct: number; yPct: number }[];
}

/** A Health Metrics bar chart, ready to draw. */
export interface HealthMetricsBarChartView {
  heightPx: number;
  barWidthPx: number;
  yTicks: string[];
  /** Empty without a right-hand axis. */
  rightTicks: string[];
  bars: HealthMetricsBarChartBarView[];
  line: HealthMetricsBarChartLineView | null;
  legend: HealthMetricsBarChartLegendItem[];
  ariaLabel: string;
}
