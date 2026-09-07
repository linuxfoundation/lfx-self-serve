// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '../constants/committee-engagement.constants';
import { TagSeverity } from './components.interface';

/** Time window a committee-engagement request/response is scoped to. */
export type CommitteeEngagementWindow = (typeof COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS)[number];

/** `'mock'` = deterministically fabricated attendance numbers (`ENGAGEMENT_BACKEND=mock`, explicit opt-in and blocked in production); `'live'` = the real Snowflake read, the default. See `CommitteeEngagementResponse.data_source`. */
export type CommitteeEngagementDataSource = 'mock' | 'live';

/**
 * Engagement tier derived in the BFF from the member's personal attendance rate.
 * `Emeritus` and `LF Staff` are both seat-type overrides, not rate tiers — neither ever classifies
 * `Inactive`/`Low` regardless of real attendance: `Emeritus` members are on the roster for
 * legacy/honorific reasons, and an LF Staff member with Observer voting status, or no voting status
 * at all, carries no real attendance expectation. An LF Staff member who is a real Voting Rep or
 * Alternate Voting Rep is NOT covered by this override — see `isLfStaffNonVotingSeat` in
 * `committee-engagement-classifier.utils.ts`.
 */
export type CommitteeEngagementClassification = 'High' | 'Medium' | 'Low' | 'Inactive' | 'Emeritus' | 'LF Staff';

/**
 * Classification inputs beyond the raw counts: `votingStatus` (`'Emeritus'` short-circuits to a
 * neutral tier), `role`+`votingStatus` together (LF Staff + no real voting seat short-circuits to
 * a neutral tier — see `isLfStaffNonVotingSeat`'s doc for why this is a two-part condition, not
 * `role` alone), and `joinedWithinWindow` (whether `member_joined_at` falls after the requested
 * window's start — tenure clipping, so a brand-new member's zero invites doesn't read as
 * disengagement). Consumed by `committee-engagement-classifier.utils.ts`. `role`'s key is required
 * (value may be `undefined`), not optional — a construction site that forgets it should get a
 * compile error, not silently drop the LF Staff exclusion. `committee-engagement.service.ts`
 * resolves it roster-first with warehouse `MEMBER_ROLE` as a fallback; `groups-engagement-stats.
 * service.ts` has no live roster to prefer, so it passes warehouse `MEMBER_ROLE` directly.
 */
export interface CommitteeEngagementClassificationInput {
  attended: number;
  invited: number;
  votingStatus: string;
  role: string | undefined;
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
  /** e.g. `'Chair'`, `'Vice Chair'`, `'None'` — passthrough for the UI to call out distinctly; also drives the `LF Staff` classification (together with `voting_status` — see `isLfStaffNonVotingSeat`) and its `attendance_rate`/`active_count` exclusion. */
  role: string;
  /** e.g. `'Voting Rep'`, `'Observer'`, `'Emeritus'`, `'None'` — drives the `Emeritus` classification directly, and (together with `role`) feeds the `LF Staff` exclusion via `isLfStaffNonVotingSeat` — not just a display passthrough. */
  voting_status: string;
  /** Committee-wide meeting count for the window, regardless of who was invited — an informational "invitation rate" signal (`invited / committee_meetings`), never the rate denominator. */
  committee_meetings: number;
}

/** Aggregate stats for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementSummary {
  /**
   * `sum(attended) / sum(invited)` across the full committee roster, excluding LF Staff+non-voting
   * seats (a staff seat with no real participation expectation shouldn't depress a committee's
   * rate; a real Voting Rep or Alternate Voting Rep is NOT excluded — see `isLfStaffNonVotingSeat`),
   * but NOT Emeritus-excluded — a committee with an Emeritus member (high invitation rate, low real
   * attendance, by design) can still show a depressed rate here alongside an `active_count` that
   * ignores that same member. A UI surfacing both side-by-side should call this out.
   * Edge case: a roster made up entirely of LF Staff+non-voting seats reports `0` here via the same
   * `invited <= 0` sentinel an empty/never-invited roster reports — indistinguishable from "no data
   * yet" at this field alone. The UI-facing consumer
   * (`CommitteeEngagementSummaryComponent.attendanceRateLabel`) re-derives the rate-eligible
   * population from `members[]` via `isCommitteeMemberRateEligible` and renders `'—'` instead of a
   * literal `0%` when no rate-eligible member has any invites this window, mirroring
   * `eligible_count`'s `activeMembersLabel` guard below. A future change that filters or truncates
   * `members[]` would silently defeat that gate.
   */
  attendance_rate: number;
  /**
   * Count of non-Emeritus, non-LF-Staff+non-voting members with real attendance this window, or who
   * joined within it (active by definition of being newly on the roster) — broader than "classified
   * High/Medium": a Low-classified member with some real attendance still counts here. See
   * `isCommitteeMemberActive`. The "joined within it" clause only applies when `data_available` is
   * `true` (see that field's doc). Display as a ratio against `eligible_count`, NOT `total_count`.
   */
  active_count: number;
  /**
   * Roster members NOT excluded from `active_count`'s population — i.e. not Emeritus, not LF
   * Staff+non-voting (`isCommitteeMemberActiveEligible`). The correct denominator for displaying
   * `active_count` as a ratio: `total_count` includes Emeritus/LF Staff+non-voting seats that
   * `active_count`'s numerator always excludes, so `active_count / total_count` can never reach
   * 100% for a committee that seats either, regardless of real participation.
   * Attendance-independent, so — unlike `active_count`/`at_risk_count`/`attendance_rate` — this
   * does NOT zero out when `data_available` is `false`: `role`/`voting_status` are roster
   * passthroughs that stay populated regardless. Reaches `0` for a roster made up entirely of
   * Emeritus and/or non-voting-LF-Staff seats — a different population than `attendance_rate`
   * sums over (Emeritus is excluded here but feeds `attendance_rate`'s sum), so the two fields' `0`
   * cases don't imply each other either direction. The UI-facing consumer
   * (`CommitteeEngagementSummaryComponent.activeMembersLabel`) renders `'—'` rather than the
   * literal `active_count/eligible_count` ratio when this is `0`.
   */
  eligible_count: number;
  /** Full committee roster size (including members with no engagement data, and including Emeritus/LF Staff+non-voting seats — use `eligible_count`, not this field, as the `active_count` ratio's denominator). */
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
   * `false`: the live read couldn't produce *usable*, roster-joined rows — either the query itself
   * errored, it ran and returned zero rows for this `committee_uid` (the model is roster-anchored,
   * so a real, currently-populated committee should always yield >=1 row — zero rows most likely
   * means this committee isn't covered by the model yet), or it returned rows but none of them key
   * to any roster member at all. All three degrade identically. Every member then shows zeroed
   * counts and classifies `Inactive` — except a roster member with a real `Emeritus` voting status
   * (still classifies `Emeritus`) or `role: 'LF Staff'` + non-voting `voting_status` (still
   * classifies `LF Staff`) — both are seat-type facts independent of whether any engagement data
   * exists. The tenure-grace `High` exception does NOT apply when `data_available` is `false`: with
   * no usable data for the whole committee, there's no engagement data to correlate tenure against,
   * so `summary`'s computed fields (`attendance_rate`, `active_count`, `at_risk_count`) are all `0`
   * — `total_count`/`eligible_count` still reflect the roster, since both are roster-known
   * independent of engagement data. The tenure-grace exception only fires when `data_available` is
   * `true` and this *specific* member's row is individually missing (e.g. added since the model's
   * last daily refresh).
   *
   * `true`: a mock-backend response for a non-empty roster (a mock response for a committee with
   * zero roster members is the one degenerate case that still reports `false`); or a live query —
   * fresh or a cache hit — that returned >=1 row matching at least one roster member by uid.
   *
   * The UI should key its "no data available" placeholder state off this flag rather than inferring
   * it from all-zero numbers — `members[]` is roster-complete either way, with `role`/`voting_status`
   * always populated and counts zeroed on `false`.
   */
  data_available: boolean;
  /**
   * `'mock'` when `ENGAGEMENT_BACKEND=mock` is explicitly set (and `NODE_ENV` isn't `production`,
   * where mock is hard-blocked) — every number in this response is deterministically fabricated,
   * not real attendance, even though it's attached to
   * real roster members and `data_available` is `true`. Any consumer that could display this to an
   * end user (rather than use it for local/integration testing) must check this field, not just
   * `data_available`, before presenting the numbers as real.
   */
  data_source: CommitteeEngagementDataSource;
}

/**
 * Precomputed per-member view of the Members table's engagement cells (LFXV2-1705). Built once in
 * a UID-keyed computed signal so the template binds properties directly instead of calling methods
 * per row on every change-detection pass (`docs/reviews/frontend-checklist.md` rule 4, "no template
 * functions").
 */
export interface CommitteeMemberEngagementRowView {
  /** Null when the member has no engagement row (e.g. joined after the rollup was computed). */
  row: CommitteeMemberEngagement | null;
  /** "Meetings" cell text — see `formatCommitteeEngagementMeetings`. */
  meetingsLabel: string;
  /** Tooltip context for the engagement chip; empty string disables the tooltip. */
  context: string;
  severity: TagSeverity;
}
