// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SnowflakeService } from './snowflake.service';

import type { HealthMetricsEventsRange } from '@lfx-one/shared/interfaces';

/**
 * Column suffix per period. The views carry no `COMPLETED_YEAR_4` columns, so that range is
 * rejected at the controller rather than silently resolving to a different year.
 */
const RANGE_COLUMN_SUFFIX: Record<HealthMetricsEventsRange, string> = {
  YTD: 'ytd',
  COMPLETED_YEAR: 'last_completed_year',
  COMPLETED_YEAR_2: 'prev_completed_year',
  COMPLETED_YEAR_3: '3rd_last_completed_year',
};

/** True when this service can serve the range — the controller uses it to validate before binding. */
export function isSupportedEventsRange(range: string): range is HealthMetricsEventsRange {
  return Object.prototype.hasOwnProperty.call(RANGE_COLUMN_SUFFIX, range);
}

/** Reads the Events tab's views. Each section's issue adds its own read through `executeSnowflakeViewRead`. */
export class HealthMetricsEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }
}
