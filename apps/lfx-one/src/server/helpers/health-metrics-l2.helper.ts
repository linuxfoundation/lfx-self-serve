// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX } from '@lfx-one/shared/constants';

import type { HealthMetricsL2Range } from '@lfx-one/shared/interfaces';

/** Completed-year periods, as years before the current one. */
const COMPLETED_YEARS_BACK: Readonly<Record<Exclude<HealthMetricsL2Range, 'YTD'>, number>> = {
  COMPLETED_YEAR: 1,
  COMPLETED_YEAR_2: 2,
  COMPLETED_YEAR_3: 3,
};

const YEAR_START = "DATE_TRUNC('YEAR', CURRENT_DATE())";

/** True when the Level 2 views carry columns for the range; own keys only, so `toString` is rejected. */
export function isHealthMetricsL2Range(range: string): range is HealthMetricsL2Range {
  return Object.prototype.hasOwnProperty.call(HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, range);
}

/**
 * Mirrors dbt's `health_metrics_period_filter` for a view with dates but no per-row period flags.
 * `column` is interpolated, so pass a trusted identifier only, never caller input.
 */
export function healthMetricsL2PeriodPredicate(column: string, range: HealthMetricsL2Range): string {
  if (range === 'YTD') return `${column} >= ${YEAR_START} AND ${healthMetricsL2PeriodEndPredicate(column, range)}`;
  return `${column} >= DATEADD(YEAR, -${COMPLETED_YEARS_BACK[range]}, ${YEAR_START}) AND ${healthMetricsL2PeriodEndPredicate(column, range)}`;
}

/** The period's upper bound alone, for a series that runs up to the end of the period rather than within it. */
export function healthMetricsL2PeriodEndPredicate(column: string, range: HealthMetricsL2Range): string {
  if (range === 'YTD') return `${column} < CURRENT_DATE()`;

  const yearsBack = COMPLETED_YEARS_BACK[range];
  const nextStart = yearsBack === 1 ? YEAR_START : `DATEADD(YEAR, -${yearsBack - 1}, ${YEAR_START})`;
  return `${column} < ${nextStart}`;
}
