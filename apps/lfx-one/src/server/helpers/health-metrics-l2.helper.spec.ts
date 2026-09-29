// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { isHealthMetricsL2Range } from './health-metrics-l2.helper';

describe('isHealthMetricsL2Range', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isHealthMetricsL2Range)).toBe(true);
    expect(isHealthMetricsL2Range('COMPLETED_YEAR_4')).toBe(false);
    expect(isHealthMetricsL2Range('toString')).toBe(false);
  });
});
