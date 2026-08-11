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
 * legacy/honorific reasons, and `LF Staff` seats (LFXV2-3101) carry no real attendance expectation,
 * so treating either as disengaged would be noise, not signal.
 */
export type CommitteeEngagementClassification = 'High' | 'Medium' | 'Low' | 'Inactive' | 'Emeritus' | 'LF Staff';

/**
 * Classification inputs beyond the raw counts, per LFXV2-1705's finalized model semantics
 * (`platinum_lfx_one_committee_meeting_attendance`, `lf-dbt#2694`): `votingStatus` (`'Emeritus'`
 * short-circuits to a neutral tier), `role` (`CommitteeMemberRole.LF_STAFF` short-circuits to a
 * neutral tier, LFXV2-3101), and `joinedWithinWindow` (whether `member_joined_at` falls after the
 * requested window's start — tenure clipping, so a brand-new member's zero invites doesn't read as
 * disengagement). Consumed by `committee-engagement-classifier.utils.ts`. `role` is optional: the
 * only other consumer of this shape (`groups-engagement-stats.service.ts`, LFXV2-1705) doesn't
 * query role data and simply gets no LF Staff exclusion, matching its pre-LFXV2-3101 behavior.
 */
export interface CommitteeEngagementClassificationInput {
  attended: number;
  invited: number;
  votingStatus: string;
  role?: string;
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
  /** e.g. `'Chair'`, `'Vice Chair'`, `'None'` — passthrough for the UI to call out distinctly; also drives the `LF Staff` classification (LFXV2-3101) and its `attendance_rate`/`active_count` exclusion. */
  role: string;
  /** e.g. `'Voting Rep'`, `'Observer'`, `'Emeritus'` — passthrough, drives the `Emeritus` classification. */
  voting_status: string;
  /** Committee-wide meeting count for the window, regardless of who was invited — an informational "invitation rate" signal (`invited / committee_meetings`), never the rate denominator. */
  committee_meetings: number;
}

/** Aggregate stats for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementSummary {
  /**
   * `sum(attended) / sum(invited)` across the full committee roster, excluding `LF Staff` seats
   * (LFXV2-3101 — a staff seat's real 0-attendance shouldn't depress a committee's rate), but NOT
   * Emeritus-excluded — a committee with an Emeritus member (high invitation rate, low real
   * attendance, by design) can still show a depressed rate here alongside an `active_count` that
   * ignores that same member. A UI surfacing both side-by-side should call this out rather than
   * let them appear to contradict. Known, accepted edge case: a roster made up entirely of `LF
   * Staff` seats (no non-staff member ever invited) reports `0` here via the same `invited <= 0`
   * sentinel an empty/never-invited roster already reports — indistinguishable from "no data yet"
   * at this field alone. Not disambiguated by a separate value, consistent with how this field
   * already overloads `0` for "nobody was invited" before this ticket.
   */
  attendance_rate: number;
  /**
   * Count of non-Emeritus, non-LF-Staff members with real attendance this window, or who joined
   * within it (active by definition of being newly on the roster) — broader than "classified
   * High/Medium": a Low-classified member with some real attendance still counts here. See
   * `committee-engagement-classifier.utils.ts`'s `isCommitteeMemberActive`. The "joined within it"
   * clause only applies when `data_available` is `true` — on a zero-row committee, or one whose
   * rows exist but don't join to any roster member, tenure alone can't imply active (see
   * `data_available`'s doc), so this is `0` there regardless of roster join dates.
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
   * `false`: the live read couldn't produce *usable*, roster-joined rows — either the query itself
   * errored (the model isn't synced yet for this committee, or the role isn't granted on it), it ran
   * and returned zero rows for this `committee_uid` (the model is roster-anchored and retains
   * zero-activity members, so a real, currently-populated committee should always yield >=1 row;
   * zero rows most likely means this committee isn't covered by the model yet, not that engagement
   * is genuinely zero for everyone), or it returned rows but none of them key to any roster member at
   * all (a total join-key mismatch — the warehouse's `MEMBER_USER_ID` values don't correspond to any
   * `CommitteeMember.uid` for this committee). All three degrade identically from the caller's point
   * of view. Every member then shows zeroed counts and classifies `Inactive` — except a roster
   * member with a real `Emeritus` voting status, which still classifies `Emeritus`, or a roster
   * member with `role: 'LF Staff'` (LFXV2-3101), which still classifies `LF Staff` — both are
   * seat-type facts independent of whether any engagement data exists. The tenure-grace `High`
   * exception (a member who genuinely joined within the requested window, classified `High` instead
   * of `Inactive` off zero invites) does NOT apply when `data_available` is `false` — with no usable
   * data for the whole committee, there is no engagement data to correlate tenure against, so every
   * non-Emeritus, non-LF-Staff member classifies `Inactive` and `summary`'s computed fields (`attendance_rate`,
   * `active_count`, `at_risk_count`) are all `0` — `total_count` still reflects the full roster size
   * regardless, since that's roster-known independent of engagement data. Asserting `High` (or a
   * nonzero `active_count`) on literal 0/0 counts would contradict `data_available: false` and
   * `attendance_rate: 0` in the same payload. The tenure-grace exception only fires when
   * `data_available` is `true` — i.e. the committee has rows AND at least one roster member matched
   * one — and this *specific* member's row is individually missing (e.g. a roster member added since
   * the model's last daily refresh): the committee has real, roster-joinable data, just not yet for
   * this member. `role`/`voting_status` are roster passthroughs and stay populated regardless of
   * whether a warehouse row matched, in both cases.
   *
   * `true`: a mock-backend response for a non-empty roster (`ENGAGEMENT_BACKEND=mock`, explicit
   * opt-in and blocked in production — a mock response for a committee with zero roster members is
   * the one degenerate case that still reports `false`, since there's trivially no member to match);
   * or a live query — fresh or a cache hit (the row cache is keyed on the committee uid; the cached
   * array's length picks the TTL and derives this flag on a hit, so a hit never assumes `true` — but
   * the roster join itself always re-runs against a freshly-fetched roster on every request, cached
   * rows included) — that returned >=1 row matching at least one roster member by uid.
   *
   * The UI should key its "no data available" placeholder state off this flag rather than inferring
   * it from all-zero numbers — `members[]` is roster-complete either way, with `role`/`voting_status`
   * always populated and counts zeroed on `false` (see above for the roster-Emeritus and roster-LF-
   * Staff exceptions, and the tenure-grace exception's `data_available:true`-only condition).
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
