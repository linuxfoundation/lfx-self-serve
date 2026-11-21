// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_COLUMN_CHART_MUTED_OPACITY, HEALTH_METRICS_COLUMN_CHART_QUARTER_STEPS } from '../constants/health-metrics-column-chart.constants';
import { healthMetricsQuarterCeiling } from './health-metrics-line-chart.utils';

import type {
  HealthMetricsColumnChartColumnView,
  HealthMetricsColumnChartInput,
  HealthMetricsColumnChartInputColumn,
  HealthMetricsColumnChartView,
} from '../interfaces/health-metrics-column-chart.interface';
import type { HealthMetricsChartTipRowView } from '../interfaces/health-metrics-l2.interface';

/**
 * The design's stacked columns: each series stacks bottom up, the total sits above the stack, and the y axis runs from 0
 * to the peak rounded up so each quarter is a clean step. Its popup lists each series, then a Total row with no swatch.
 */
export function buildHealthMetricsColumnChart(input: HealthMetricsColumnChartInput): HealthMetricsColumnChartView {
  const top = healthMetricsColumnChartCeiling(input.peak);

  return {
    heightPx: input.heightPx,
    barWidthPx: input.barWidthPx,
    yTicks: [1, 0.75, 0.5, 0.25, 0].map((share) => (input.formatTick ?? formatHealthMetricsChartCompact)(top * share)),
    columns: input.columns.map((column) => buildColumn(input, column, top)),
    series: input.series,
    ariaLabel: input.ariaLabel,
  };
}

/** A peak rounded up so each of the four quarters is a whole, clean step (1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten). */
export function healthMetricsColumnChartCeiling(peak: number): number {
  return healthMetricsQuarterCeiling(peak, HEALTH_METRICS_COLUMN_CHART_QUARTER_STEPS, true);
}

/** The design's chart label: `24K`, `1.6K` or `800`; one decimal under 100K, none above, and `1M` rather than `1000K`. */
export function formatHealthMetricsChartCompact(value: number): string {
  // The no-decimal K branch rounds 999,500 up to 1000K, so M starts there.
  if (value >= 999_500) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
}

function buildColumn(input: HealthMetricsColumnChartInput, column: HealthMetricsColumnChartInputColumn, top: number): HealthMetricsColumnChartColumnView {
  const values = column.values;
  const pct = (value: number) => (Math.max(0, value) / top) * 100;
  let stacked = 0;
  const segments = values
    ? input.series.map((series, index) => {
        const value = values[index] ?? 0;
        const segment = { key: series.key, color: series.color, bottomPct: pct(stacked), heightPct: pct(value), top: false };
        stacked += Math.max(0, value);
        return segment;
      })
    : [];
  // The design rounds the stack's top corners, which the highest drawn segment carries.
  const topmost = segments.map((segment) => segment.heightPct > 0).lastIndexOf(true);
  if (topmost >= 0) segments[topmost].top = true;
  const total = values ? column.total : null;
  const rows: HealthMetricsChartTipRowView[] =
    column.tipRows ??
    (values
      ? [
          ...input.series.map((series, index) => ({ label: series.label, value: formatValue(input, values[index]), color: series.color, separated: false })),
          { label: 'Total', value: formatValue(input, total), color: 'transparent', separated: false },
        ]
      : []);

  return {
    key: column.key,
    label: column.label,
    sub: column.sub,
    total: total === null ? '' : input.formatTotal(total),
    totalBottomPct: pct(stacked),
    opacity: column.muted ? HEALTH_METRICS_COLUMN_CHART_MUTED_OPACITY : 1,
    segments,
    tip: { title: column.tipTitle, rows },
    ariaLabel: [column.tipTitle, ...rows.map((row) => `${row.label} ${row.value}`)].join(', '),
  };
}

function formatValue(input: HealthMetricsColumnChartInput, value: number | null): string {
  return value === null ? '—' : input.formatValue(value);
}
