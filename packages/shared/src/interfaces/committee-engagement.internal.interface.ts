// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Snowflake row shape for the (not-yet-deployed) committee-member meeting-attendance warehouse
 * model (LFXV2-1705) — server-side only. Column names are a placeholder pending the real dbt
 * model; the BFF maps rows onto `CommitteeMemberEngagement` and degrades to an empty response via
 * `SnowflakeService`'s `expectMissingObject` until the table exists.
 *
 * Grain: `(COMMITTEE_UID, MEMBER_EMAIL, TIME_RANGE_TYPE)`.
 */
export interface CommitteeEngagementWarehouseRow {
  MEMBER_EMAIL: string;
  ATTENDED_COUNT: number;
  INVITED_COUNT: number;
  COMPUTED_AT: string | Date | null;
}

/** Result of the engagement-rows query, distinguishing a real (possibly empty) result set from the table-not-deployed-yet degrade. */
export interface CommitteeEngagementQueryResult {
  rows: CommitteeEngagementWarehouseRow[];
  /** `false` when the warehouse table doesn't exist yet — distinct from a real query returning zero rows. */
  dataAvailable: boolean;
}
