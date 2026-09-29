// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX } from '@lfx-one/shared/constants';

import type { HealthMetricsL2Range } from '@lfx-one/shared/interfaces';

/** True when the Level 2 views carry columns for the range; own keys only, so `toString` is rejected. */
export function isHealthMetricsL2Range(range: string): range is HealthMetricsL2Range {
  return Object.prototype.hasOwnProperty.call(HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, range);
}
