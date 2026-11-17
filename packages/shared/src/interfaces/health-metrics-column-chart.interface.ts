// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsChartTipView } from './health-metrics-l2.interface';

/** One stacked series, bottom up: its legend and popup label and its colour. */
export interface HealthMetricsColumnChartSeries {
  key: string;
  label: string;
  /** A palette hex from `lfxColors`, drawn as the segment's and the popup dot's colour. */
  color: string;
}

/** One column before layout: a value per series, or `null` for a slot with no data at all. */
export interface HealthMetricsColumnChartInputColumn {
  key: string;
  label: string;
  /** A second line under the label, such as `partial`; empty for none. */
  sub: string;
  values: (number | null)[] | null;
  /** The total over the stack, as the source models it; `null` when unmeasured, which reads "—" rather than 0. */
  total: number | null;
  /** Drawn at the design's 35% so the current column stands out. */
  muted: boolean;
  tipTitle: string;
}

/** What `buildHealthMetricsColumnChart` needs: the series, the columns and how to label them. */
export interface HealthMetricsColumnChartInput {
  series: HealthMetricsColumnChartSeries[];
  columns: HealthMetricsColumnChartInputColumn[];
  /** The axis top before rounding; `buildHealthMetricsColumnChart` rounds it up to a clean step. */
  peak: number;
  heightPx: number;
  barWidthPx: number;
  formatTotal: (value: number) => string;
  formatValue: (value: number) => string;
  ariaLabel: string;
}

/** One stacked segment, as percentages of the plot's height. */
export interface HealthMetricsColumnChartSegmentView {
  key: string;
  color: string;
  bottomPct: number;
  heightPct: number;
  /** The highest drawn segment, which takes the stack's rounded top corners. */
  top: boolean;
}

/** One column, laid out: its segments, the total above it and its popup. */
export interface HealthMetricsColumnChartColumnView {
  key: string;
  label: string;
  sub: string;
  /** Empty for a slot with no data, which draws nothing. */
  total: string;
  /** Where the total sits: the top of the stack. */
  totalBottomPct: number;
  opacity: number;
  segments: HealthMetricsColumnChartSegmentView[];
  tip: HealthMetricsChartTipView;
  /** The column's accessible name: the popup's title and rows on one line. */
  ariaLabel: string;
}

/** A Health Metrics stacked column chart, ready to draw. */
export interface HealthMetricsColumnChartView {
  heightPx: number;
  barWidthPx: number;
  /** Top to bottom: the axis top, its quarters, and 0. */
  yTicks: string[];
  columns: HealthMetricsColumnChartColumnView[];
  series: HealthMetricsColumnChartSeries[];
  ariaLabel: string;
}
