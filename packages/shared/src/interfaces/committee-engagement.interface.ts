// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '../constants/committee-engagement.constants';

/** Time window a committee-engagement request/response is scoped to. */
export type CommitteeEngagementWindow = (typeof COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS)[number];

/**
 * Engagement tier derived in the BFF from the member's personal attendance rate.
 * `Emeritus` is a seat-type override, not a rate tier — Emeritus members never classify
 * `Inactive`/`Low` regardless of their real attendance, since they're on the roster for
 * legacy/honorific reasons rather than active participation.
 */
export type CommitteeEngagementClassification = 'High' | 'Medium' | 'Low' | 'Inactive' | 'Emeritus';

/**
 * Classification inputs beyond the raw counts, per LFXV2-1705's finalized model semantics
 * (`platinum_lfx_one_committee_meeting_attendance`, `lf-dbt#2694`): `votingStatus` (`'Emeritus'`
 * short-circuits to a neutral tier) and `joinedWithinWindow` (whether `member_joined_at` falls
 * after the requested window's start — tenure clipping, so a brand-new member's zero invites
 * doesn't read as disengagement). Consumed by `committee-engagement-classifier.util.ts`.
 */
export interface CommitteeEngagementClassificationInput {
  attended: number;
  invited: number;
  votingStatus: string;
  joinedWithinWindow: boolean;
}

/** Per-member attendance rollup for a single committee + window. */
export interface CommitteeMemberEngagement {
  /** `CommitteeMember.uid` this row corresponds to. */
  uid: string;
  /** Meetings attended within the window. */
  attended: number;
  /** Meetings the member was invited to within the window. */
  invited: number;
  /** `attended / invited`, 0 when `invited` is 0, rounded to 2 decimal places. */
  rate: number;
  classification: CommitteeEngagementClassification;
  /** e.g. `'Chair'`, `'Vice Chair'`, `'None'` — passthrough for the UI to call out distinctly. */
  role: string;
  /** e.g. `'Voting Rep'`, `'Observer'`, `'Emeritus'` — passthrough, drives the `Emeritus` classification. */
  voting_status: string;
  /** Committee-wide meeting count for the window, regardless of who was invited — an informational "invitation rate" signal (`invited / committee_meetings`), never the rate denominator. */
  committee_meetings: number;
}

/** Aggregate stats for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementSummary {
  /** `sum(attended) / sum(invited)` across the full committee roster, 0 when nobody was invited. */
  attendance_rate: number;
  /**
   * Count of non-Emeritus members with real attendance this window, or who joined within it
   * (active by definition of being newly on the roster) — broader than "classified High/Medium":
   * a Low-classified member with some real attendance still counts here. See
   * `committee-engagement-classifier.util.ts`'s `isCommitteeMemberActive`.
   */
  active_count: number;
  /** Full committee roster size (including members with no engagement data). */
  total_count: number;
  /** Members classified Low, plus members invited within the window who attended nothing (badge reads Inactive, but there is signal to act on — unlike a member never invited). */
  at_risk_count: number;
}

/** Response body for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementResponse {
  members: CommitteeMemberEngagement[];
  summary: CommitteeEngagementSummary;
  /**
   * ISO timestamp the warehouse model last computed this data. Always `null` today — the real
   * model doesn't expose a freshness column yet (a separate pipeline-freshness follow-up); use
   * `formatCommitteeEngagementFreshness` for a UI-facing label instead of rendering this raw.
   */
  computed_at: string | null;
  /**
   * `false` only when the live warehouse query itself couldn't run (the model isn't deployed yet)
   * — every member then shows zeroed, `Inactive` placeholder stats rather than real data. `true`
   * covers both a successful live query (even one returning zero rows for a genuinely new
   * committee) and a mock-backend response (`ENGAGEMENT_BACKEND` unset/non-`'live'`) — the flag
   * means "there's real per-member signal to show," not "this came from Snowflake." The UI should
   * key its "no data available" state off this flag rather than inferring it from all-zero numbers.
   */
  data_available: boolean;
  /**
   * `'mock'` when `ENGAGEMENT_BACKEND` is unset/non-`'live'` (the default) — every number in this
   * response is deterministically fabricated, not real attendance, even though it's attached to
   * real roster members and `data_available` is `true`. Any consumer that could display this to an
   * end user (rather than use it for local/integration testing) must check this field, not just
   * `data_available`, before presenting the numbers as real.
   */
  data_source: 'mock' | 'live';
}
