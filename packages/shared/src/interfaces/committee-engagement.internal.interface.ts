// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Row shape for the committee-member meeting-attendance rollup (LFXV2-1705), mirroring the
 * finalized `platinum_lfx_one_committee_meeting_attendance` dbt model (`lf-dbt#2694`) — server-only.
 * One row per `(committee_id, member_user_id)`, roster-anchored: every current roster member gets a
 * row, including zero-activity ones. All three windows are columns on the same row rather than a
 * `WHERE TIME_RANGE_TYPE = ?` filter, since the model computes all three at once.
 *
 * `INVITED_COUNT_*`/`ATTENDED_COUNT_*` are personal — meetings this specific member was invited to
 * / attended, not the committee's meeting total. `COMMITTEE_MEETINGS_*` is the committee-wide total
 * regardless of who was invited — an "invitation rate" secondary signal only
 * (`INVITED_COUNT_* / COMMITTEE_MEETINGS_*`), never the rate denominator (that's always
 * `ATTENDED_COUNT_* / INVITED_COUNT_*` — see `committee-engagement-classifier.utils.ts`).
 *
 * No `COMPUTED_AT` — the real model doesn't expose one yet (pipeline-freshness is a separate
 * follow-up); the BFF always returns `computed_at: null` until that lands.
 *
 * The live Snowflake read for this shape doesn't exist yet (the table isn't deployed, and the read
 * surface — query-service vs. direct Snowflake — is still an open question); today only the mock
 * generator (`committee-engagement-mock.helper.ts`) produces rows in this shape.
 */
export interface CommitteeEngagementWarehouseRow {
  /** `CommitteeMember.uid` this row corresponds to. */
  MEMBER_USER_ID: string;
  /** When the member joined the committee roster — used for tenure clipping (see the classifier). */
  MEMBER_JOINED_AT: string | Date | null;
  /** e.g. `'Chair'`, `'Vice Chair'`, `'None'` — passthrough, informational. */
  MEMBER_ROLE: string;
  /** e.g. `'Voting Rep'`, `'Observer'`, `'Emeritus'` — `'Emeritus'` short-circuits classification. */
  MEMBER_VOTING_STATUS: string;
  INVITED_COUNT_30D: number;
  ATTENDED_COUNT_30D: number;
  COMMITTEE_MEETINGS_30D: number;
  INVITED_COUNT_90D: number;
  ATTENDED_COUNT_90D: number;
  COMMITTEE_MEETINGS_90D: number;
  INVITED_COUNT_YTD: number;
  ATTENDED_COUNT_YTD: number;
  COMMITTEE_MEETINGS_YTD: number;
}

/** Result of the engagement-rows read, distinguishing a usable result set from either live-path degrade case (see `dataAvailable`). */
export interface CommitteeEngagementQueryResult {
  rows: CommitteeEngagementWarehouseRow[];
  /**
   * Only meaningful for the live path — mock mode always constructs this type directly with `true`
   * and synchronously-generated rows, no query involved (`committee-engagement.service.ts`'s
   * `getCommitteeEngagement`). Within the live path: `false` when the read produced no usable rows
   * (the table isn't deployed / not authorized, or the query succeeded but returned rows in the
   * pre-finalization placeholder shape — can't map to `CommitteeEngagementWarehouseRow`); `true` on
   * a cache hit, or a genuinely successful query returning zero (or, once the real model ships,
   * real) rows.
   */
  dataAvailable: boolean;
}

/**
 * The live SQL in `committee-engagement.service.ts`'s `queryEngagementRows` still selects these
 * pre-finalization placeholder columns, not `CommitteeEngagementWarehouseRow`'s real fields — a
 * distinct type (rather than casting to the finalized interface) so the compiler, not just a
 * comment, reflects that the two shapes share no fields and there's no honest mapping between them.
 */
export interface LegacyEngagementPlaceholderRow {
  MEMBER_EMAIL: string;
  ATTENDED_COUNT: number;
  INVITED_COUNT: number;
  COMPUTED_AT: string | Date | null;
}
