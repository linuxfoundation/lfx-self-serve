// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_COLUMN_CHART_MUTED_OPACITY, HEALTH_METRICS_COLUMN_CHART_QUARTER_STEPS } from '../constants/health-metrics-column-chart.constants';

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
    yTicks: [1, 0.75, 0.5, 0.25, 0].map((share) => formatHealthMetricsChartCompact(top * share)),
    columns: input.columns.map((column) => buildColumn(input, column, top)),
    series: input.series,
    ariaLabel: input.ariaLabel,
  };
}

/** A peak rounded up so each of the four quarters is a clean step (1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten); never below 4. */
export function healthMetricsColumnChartCeiling(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 4) return 4;

  const quarter = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(quarter));
  const step = HEALTH_METRICS_COLUMN_CHART_QUARTER_STEPS.find((candidate) => candidate * magnitude >= quarter) ?? 10;
  return step * magnitude * 4;
}

/** The design's chart label: `24K`, `1.6K` or `800`; one decimal under 100K, none above. */
export function formatHealthMetricsChartCompact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
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
        const segment = { key: series.key, color: series.color, bottomPct: pct(stacked), heightPct: pct(value) };
        stacked += Math.max(0, value);
        return segment;
      })
    : [];
  const total = values ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const rows: HealthMetricsChartTipRowView[] = values
    ? [
        ...input.series.map((series, index) => ({ label: series.label, value: formatValue(input, values[index]), color: series.color, separated: false })),
        { label: 'Total', value: formatValue(input, total), color: 'transparent', separated: false },
      ]
    : [];

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
