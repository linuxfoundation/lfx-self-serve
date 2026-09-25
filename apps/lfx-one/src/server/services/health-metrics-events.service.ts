// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX } from '@lfx-one/shared/constants';

import { SnowflakeService } from './snowflake.service';

import type { HealthMetricsL2Range } from '@lfx-one/shared/interfaces';

/** True when the Events views carry columns for the range; for a controller to check before binding. */
export function isSupportedEventsRange(range: string): range is HealthMetricsL2Range {
  return Object.prototype.hasOwnProperty.call(HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, range);
}

/**
 * Holds the Snowflake instance for the Events tab's view reads. No section reads yet; each section's
 * issue adds its query (through `executeSnowflakeViewRead`) with its controller and route.
 */
export class HealthMetricsEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }
}
