// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { healthMetricsL2PeriodEndPredicate, healthMetricsL2PeriodPredicate, isHealthMetricsL2Range } from './health-metrics-l2.helper';

describe('isHealthMetricsL2Range', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isHealthMetricsL2Range)).toBe(true);
    expect(isHealthMetricsL2Range('COMPLETED_YEAR_4')).toBe(false);
    expect(isHealthMetricsL2Range('toString')).toBe(false);
  });
});

describe('healthMetricsL2PeriodPredicate', () => {
  it('bounds the year to date before today, as dbt does', () => {
    expect(healthMetricsL2PeriodPredicate('meeting_date', 'YTD')).toBe("meeting_date >= DATE_TRUNC('YEAR', CURRENT_DATE()) AND meeting_date < CURRENT_DATE()");
  });

  it('bounds each completed year from its own start to the next one', () => {
    expect(healthMetricsL2PeriodPredicate('meeting_date', 'COMPLETED_YEAR')).toBe(
      "meeting_date >= DATEADD(YEAR, -1, DATE_TRUNC('YEAR', CURRENT_DATE())) AND meeting_date < DATE_TRUNC('YEAR', CURRENT_DATE())"
    );
    expect(healthMetricsL2PeriodPredicate('meeting_date', 'COMPLETED_YEAR_3')).toBe(
      "meeting_date >= DATEADD(YEAR, -3, DATE_TRUNC('YEAR', CURRENT_DATE())) AND meeting_date < DATEADD(YEAR, -2, DATE_TRUNC('YEAR', CURRENT_DATE()))"
    );
  });
});

describe('healthMetricsL2PeriodEndPredicate', () => {
  it('bounds a series by the end of the period only', () => {
    expect(healthMetricsL2PeriodEndPredicate('quarter_start_date', 'YTD')).toBe('quarter_start_date < CURRENT_DATE()');
    expect(healthMetricsL2PeriodEndPredicate('quarter_start_date', 'COMPLETED_YEAR')).toBe("quarter_start_date < DATE_TRUNC('YEAR', CURRENT_DATE())");
    expect(healthMetricsL2PeriodEndPredicate('quarter_start_date', 'COMPLETED_YEAR_2')).toBe(
      "quarter_start_date < DATEADD(YEAR, -1, DATE_TRUNC('YEAR', CURRENT_DATE()))"
    );
  });
});
