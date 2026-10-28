// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * One raw `PLATINUM_LFX_ONE.ENGAGEMENT_ATTENDANCE_MONTHLY` row as the Snowflake driver returns it —
 * server-only. Decimals arrive as strings; the service maps it onto `HealthMetricsEngagementAttendanceMonth`.
 */
export interface HealthMetricsEngagementAttendanceMonthRow {
  MONTH_START_DATE: Date | string | null;
  MEETINGS_HELD_COUNT: number | null;
  INVITED_COUNT: number | null;
  ATTENDED_COUNT: number | null;
  ATTENDANCE_PCT: number | string | null;
  ATTENDANCE_PCT_CHANGE_PP: number | string | null;
}
