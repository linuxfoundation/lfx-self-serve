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
 * follow-up, LFXV2-2930); the BFF always returns `computed_at: null` until that lands.
 *
 * Produced by both the mock generator (`committee-engagement-mock.helper.ts`) and the live direct
 * Snowflake read (`committee-engagement.service.ts`'s `queryEngagementRows`, against
 * `PLATINUM_LFX_ONE.COMMITTEE_MEETING_ATTENDANCE`) — the two paths share this exact shape.
 */
export interface CommitteeEngagementWarehouseRow {
  /** `CommitteeMember.uid` this row corresponds to. */
  MEMBER_USER_ID: string;
  /** When the member joined the committee roster — used for tenure clipping (see the classifier). */
  MEMBER_JOINED_AT: string | Date | null;
  /** e.g. `'Chair'`, `'Vice Chair'`, `'None'` — `'LF Staff'` together with `MEMBER_VOTING_STATUS` being `'Observer'` or `'None'` short-circuits classification and excludes the row from the rate/active sums (`role` alone is not enough — a real Voting Rep who happens to be LF Staff is not excluded). */
  MEMBER_ROLE: string;
  /** e.g. `'Voting Rep'`, `'Observer'`, `'Emeritus'`, `'None'` — `'Emeritus'` short-circuits classification; `'None'` (the norm on committees without voting) is load-bearing for the LF Staff exclusion above, not just a display passthrough — may also come back blank/falsy from the warehouse, which callers normalize to the `'None'` sentinel (see `committee-engagement.service.ts` and `groups-engagement-stats.service.ts`). */
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
   * `getCommitteeEngagement`). Within the live path: `false` when the read produced no usable rows —
   * either the query errored (table not yet synced / not authorized, never cached) or it succeeded
   * but returned zero rows for this `committee_uid` (most likely a committee the model doesn't cover
   * yet, since the model is roster-anchored and retains zero-activity members — a real,
   * currently-populated committee should always yield >=1 row; this outcome IS cached, under a short
   * TTL). `true` when the query (or a cache hit reading back that same outcome) returned >=1 row —
   * a cache hit derives this from the cached array's length, not a hardcoded `true`, since both
   * outcomes are cached under the same key.
   */
  dataAvailable: boolean;
}
