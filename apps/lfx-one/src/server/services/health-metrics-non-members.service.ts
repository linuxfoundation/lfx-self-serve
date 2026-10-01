// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { SnowflakeService } from './snowflake.service';

import type { HealthMetricsL2Range } from '@lfx-one/shared/interfaces';

/** True when the Non-Members views carry columns for the range; for a controller to check before binding. */
export function isSupportedNonMembersRange(range: string): range is HealthMetricsL2Range {
  return isHealthMetricsL2Range(range);
}

/**
 * Holds the Snowflake instance for the Non-Members tab's view reads. No section reads yet; each section's
 * issue adds its query (through `executeSnowflakeViewRead`) with its controller and route.
 */
export class HealthMetricsNonMembersService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }
}
