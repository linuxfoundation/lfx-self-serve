// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_LINE_CHART_HEIGHT_PX,
  HEALTH_METRICS_LINE_CHART_QUARTER_STEPS,
  HEALTH_METRICS_LINE_CHART_VIEW_WIDTH,
} from '../constants/health-metrics-line-chart.constants';

import type { HealthMetricsChartTipView } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsLineChartInput,
  HealthMetricsLineChartTickView,
  HealthMetricsLineChartView,
} from '../interfaces/health-metrics-line-chart.interface';

/**
 * The design's `line2` chart: straight segments between the points, a soft fill under the first filled series, 8px
 * hollow dots on every solid series, and one hover column per x position. A `null` value breaks its line.
 */
export function buildHealthMetricsLineChart(input: HealthMetricsLineChartInput): HealthMetricsLineChartView {
  const width = HEALTH_METRICS_LINE_CHART_VIEW_WIDTH;
  const height = input.heightPx ?? HEALTH_METRICS_LINE_CHART_HEIGHT_PX;
  const count = input.xLabels.length;
  const max = input.max > 0 ? input.max : 1;
  const x = (index: number): number => (count > 1 ? (index / (count - 1)) * width : width / 2);
  const y = (value: number): number => height - (Math.max(0, Math.min(max, value)) / max) * height;
  const path = (values: readonly (number | null)[]): string => {
    let d = '';
    let penDown = false;
    values.forEach((value, index) => {
      if (value === null) {
        penDown = false;
        return;
      }
      d += `${penDown ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
      penDown = true;
    });
    return d.trim();
  };

  const ticks = input.xLabels.map((label, index) => ({
    key: String(index),
    label,
    leftPct: (x(index) / width) * 100,
    align: lineChartTickAlign(index, count),
  }));
  const filled = input.series.find((series) => series.fill);
  const filledIndexes = filled ? filled.values.flatMap((value, index) => (value === null ? [] : [index])) : [];
  const first = filledIndexes[0];
  const last = filledIndexes[filledIndexes.length - 1];

  return {
    heightPx: height,
    viewBox: `0 0 ${width} ${height}`,
    yTicks: [1, 0.75, 0.5, 0.25, 0].map((share) => input.formatTick(max * share)),
    gridYs: [0, 0.25, 0.5, 0.75].map((share) => share * height),
    baseY: height,
    area:
      filled && first !== undefined && last !== undefined
        ? { d: `${path(filled.values)} L${x(last).toFixed(1)} ${height} L${x(first).toFixed(1)} ${height} Z`, color: filled.color }
        : null,
    paths: input.series.map((series) => ({ key: series.key, d: path(series.values), color: series.color, dashed: !!series.dashed })),
    // The design leaves a dashed series without dots, so it reads as derived from the solid ones.
    dots: input.series
      .filter((series) => !series.dashed)
      .flatMap((series) =>
        series.values.flatMap((value, index) =>
          value === null ? [] : [{ key: `${series.key}-${index}`, leftPct: (x(index) / width) * 100, topPct: (y(value) / height) * 100, color: series.color }]
        )
      ),
    columns: input.xLabels.map((label, index) => {
      const tip = input.tips[index] ?? { title: label, rows: [] };
      // Cut off at the plot's edges, so an end column never covers the y labels or the card beside the chart.
      const centre = (x(index) / width) * 100;
      const half = 50 / Math.max(count, 1);
      const left = Math.max(0, centre - half);
      const columnWidth = Math.min(100, centre + half) - left;
      return {
        key: String(index),
        leftPct: left,
        widthPct: columnWidth,
        pointOffsetPct: ((centre - left) / columnWidth) * 100,
        tip,
        ariaLabel: lineChartTipLabel(tip),
      };
    }),
    ticks,
    monthTicks: ticks.filter((tick, index) => index === 0 || tick.label !== ticks[index - 1].label),
    ariaLabel: input.ariaLabel,
  };
}

/**
 * A y-axis top for counts: the peak rounded up so each quarter of the axis is a round step (1, 2, 2.5, 4, 5 or 10
 * times a power of ten). A chart with nothing above zero still gets an axis of 4.
 */
export function healthMetricsLineChartCountCeiling(peak: number): number {
  // Never below 4, so a tiny peak still labels its quarters with whole, distinct numbers.
  if (!Number.isFinite(peak) || peak <= 4) return 4;

  const quarter = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(quarter));
  const step = HEALTH_METRICS_LINE_CHART_QUARTER_STEPS.find((candidate) => candidate * magnitude >= quarter) ?? 10;
  return step * magnitude * 4;
}

/** A spread row's alignment: the first label starts at the left edge, the last ends at the right, the rest centre on their point. */
function lineChartTickAlign(index: number, count: number): HealthMetricsLineChartTickView['align'] {
  if (count === 1) return 'center';
  if (index === 0) return 'start';
  return index === count - 1 ? 'end' : 'center';
}

/** "Title, Label value, Label value": the popup as one line, for the column's accessible name. */
function lineChartTipLabel(tip: HealthMetricsChartTipView): string {
  return [tip.title, ...tip.rows.map((row) => `${row.label} ${row.value}`)].join(', ');
}
