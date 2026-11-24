// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_BAR_CHART_LABEL_CLASSES } from '../constants/health-metrics-bar-chart.constants';
import { healthMetricsChartTipLabel } from './health-metrics-line-chart.utils';

import type {
  HealthMetricsBarChartBarView,
  HealthMetricsBarChartInput,
  HealthMetricsBarChartInputBar,
  HealthMetricsBarChartLineView,
  HealthMetricsBarChartView,
} from '../interfaces/health-metrics-bar-chart.interface';

/**
 * The design's single-series bar chart: one bar per point with its value above it, each in its own colour and opacity,
 * and an optional dashed line with dots over the bars on their axis or its own right-hand one.
 */
export function buildHealthMetricsBarChart(input: HealthMetricsBarChartInput): HealthMetricsBarChartView {
  return {
    heightPx: input.heightPx,
    barWidthPx: input.barWidthPx,
    yTicks: input.ticks,
    rightTicks: input.line?.ticks ?? [],
    bars: input.bars.map((bar) => buildBar(bar, input.max)),
    line: input.line ? buildLine(input.bars, input.line.color, input.line.max) : null,
    legend: input.legend,
    ariaLabel: input.ariaLabel,
  };
}

function buildBar(bar: HealthMetricsBarChartInputBar, max: number): HealthMetricsBarChartBarView {
  return {
    key: bar.key,
    label: bar.label,
    heightPct: bar.value === null ? 0 : shareOf(bar.value, max),
    color: bar.color,
    opacity: bar.opacity,
    valueLabel: bar.value === null ? '' : bar.valueLabel,
    valueLabelClass: HEALTH_METRICS_BAR_CHART_LABEL_CLASSES[bar.labelTone],
    tip: bar.tip,
    ariaLabel: healthMetricsChartTipLabel(bar.tip),
  };
}

/** Each point sits over its bar's centre; a missing point breaks the line rather than dropping to 0. */
function buildLine(bars: HealthMetricsBarChartInputBar[], color: string, max: number): HealthMetricsBarChartLineView {
  const dots = bars.flatMap((bar, index) =>
    bar.lineValue === null ? [] : [{ key: bar.key, index, xPct: ((index + 0.5) / bars.length) * 100, yPct: 100 - shareOf(bar.lineValue, max) }]
  );
  const path = dots.map((dot, at) => `${at > 0 && dots[at - 1].index === dot.index - 1 ? 'L' : 'M'}${round2(dot.xPct)} ${round2(dot.yPct)}`).join(' ');
  return { color, path, dots: dots.map(({ key, xPct, yPct }) => ({ key, xPct, yPct })) };
}

/** A value's height as a share of the axis, held to the plot. */
function shareOf(value: number, max: number): number {
  return max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
