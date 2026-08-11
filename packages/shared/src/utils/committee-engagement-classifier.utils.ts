// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS } from '../constants/committee-engagement.constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums';
import type { CommitteeEngagementClassification, CommitteeEngagementClassificationInput } from '../interfaces/committee-engagement.interface';

/**
 * `attended / invited`, 0 when nobody was invited. Clamps `attended` to `invited` so a warehouse
 * data-quality glitch can't produce a rate over 1 — the finalized model's own dbt tests are
 * expected to enforce `attended <= invited` as a grain invariant, but this is a defensive clamp
 * against that guarantee being violated in practice (a future live-read bug, a stale cache entry),
 * not a sign the invariant is known to be unenforced. Always personal `attended/invited`, never
 * `attended/committee_meetings` — the real model's `committee_meetings_*` column is a committee-wide
 * total that would misclassify a tenure-limited member (e.g. the ticket's Orlin example:
 * `invited_ytd=5, attended_ytd=5` reads as 100%, but `5/committee_meetings` would read as ~36% and
 * wrongly land him in At-Risk).
 */
function rawCommitteeEngagementRate(attended: number, invited: number): number {
  if (invited <= 0) return 0;
  const clampedAttended = Math.min(Math.max(attended, 0), invited);
  return clampedAttended / invited;
}

/**
 * `rawCommitteeEngagementRate`, rounded to 2 decimal places for display. Classification uses the
 * unrounded rate (`classifyCommitteeEngagement`) — thresholding the rounded value would flip a
 * rate like 0.395 into the `Medium` bucket (rounds to 0.40) despite falling under the `medium`
 * threshold before rounding. Unaffected by seat type or tenure — those change the classification
 * tier, never the underlying number, so an Emeritus member's real (low) rate is still visible.
 */
export function computeCommitteeEngagementRate(attended: number, invited: number): number {
  return Math.round(rawCommitteeEngagementRate(attended, invited) * 100) / 100;
}

/**
 * Whether a member is an LF Staff seat with Observer voting status specifically — the actual
 * exclusion condition every "LF Staff" rule in this file keys on, not `role === LF_STAFF` alone
 * (LFXV2-3101 follow-up review fix). Staff seats are typically added as an Observer with no real
 * meeting-attendance expectation, which is what the exclusion exists to protect — but an LF Staff
 * member who is a Voting Rep or Alternate Voting Rep (e.g. an ED or staff member serving as a real
 * board/committee voting representative) is a genuine participant and should classify/count
 * normally, the same as any other member. Excluding them anyway would silence real engagement
 * signal for exactly the population — real participants — every rule in this file exists to
 * measure. Scoped to `role`+`Observer` specifically, not broadened to every Observer regardless of
 * role: a non-staff Observer can still have real engagement expectations depending on the
 * community, so excluding all Observers would hide genuine disengagement signal in the other
 * direction.
 */
function isLfStaffObserverSeat(input: Pick<CommitteeEngagementClassificationInput, 'role' | 'votingStatus'>): boolean {
  return input.role === CommitteeMemberRole.LF_STAFF && input.votingStatus === CommitteeMemberVotingStatus.OBSERVER;
}

/**
 * Decision order (see the ticket's Jira thread for the full rationale):
 * 1. `Emeritus` voting status always wins — on the roster for legacy/honorific reasons, real
 *    attendance (often ~5%, per the model's real observed data) shouldn't read as disengagement.
 * 2. `LF Staff` + `Observer` wins next (LFXV2-3101) — see `isLfStaffObserverSeat`'s doc for exactly
 *    why it's this two-part condition and not `role` alone.
 * 3. No invites yet, but joined within the window: no real opportunity has existed, so this can't
 *    be `Inactive` — tenure, not disengagement. Classified `High` (active by definition) rather
 *    than a new tier, since the ticket's classification set is fixed.
 * 4. No invites, and been a member the whole window: a genuine no-signal veteran — unchanged from
 *    the original rule.
 * 5-7. Invited at least once: threshold on the real (unrounded) rate as before.
 * 8. Invited at least once, attended nothing: a real disengagement signal regardless of tenure —
 *    unlike case 3, they had an actual opportunity and skipped every one of them, so tenure does
 *    not protect this case.
 */
export function classifyCommitteeEngagement(input: CommitteeEngagementClassificationInput): CommitteeEngagementClassification {
  const { attended, invited, votingStatus, joinedWithinWindow } = input;
  if (votingStatus === CommitteeMemberVotingStatus.EMERITUS) return 'Emeritus';
  if (isLfStaffObserverSeat(input)) return 'LF Staff';
  if (invited <= 0) return joinedWithinWindow ? 'High' : 'Inactive';

  const rate = rawCommitteeEngagementRate(attended, invited);
  // `<=`, not `===`: defensive against `rawCommitteeEngagementRate`'s internal clamp ever being
  // weakened, not because a negative rate is reachable today — by this point `invited > 0` (line
  // 53) and `attended` is clamped to `[0, invited]`, so `rate` is always in `[0, 1]`.
  if (rate <= 0) return 'Inactive';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.high) return 'High';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

/**
 * `Low` members are at risk by definition. A member invited within the window who attended
 * nothing is at risk too, even though `classifyCommitteeEngagement` also calls them `Inactive` —
 * that tier's other member (never invited at all) has no signal to act on, but this one does.
 * `Emeritus`, `LF Staff`+`Observer` (LFXV2-3101), and the tenure-grace `High` (case 3 above) are
 * never at-risk — none of them match `Low` or `Inactive`, so no extra exclusion logic is needed
 * here.
 */
export function isCommitteeMemberAtRisk(input: CommitteeEngagementClassificationInput): boolean {
  const classification = classifyCommitteeEngagement(input);
  return classification === 'Low' || (classification === 'Inactive' && input.invited > 0);
}

/**
 * The "Active Members x/y" summary rule — deliberately broader than "classified High/Medium":
 * per the ticket, the numerator is members with *any* real attendance this window, plus members
 * who joined within it (active by definition of being newly on the roster), excluding Emeritus
 * and LF Staff+Observer seats (LFXV2-3101, see `isLfStaffObserverSeat`'s doc for the two-part
 * condition). This function doesn't delegate to `classifyCommitteeEngagement`, so both exclusions
 * need their own explicit check here, same as the classifier's. A `Low`-classified member (some
 * attendance, just under the Medium threshold) still counts here — this is a distinct rule from
 * `classifyCommitteeEngagement`, not a rollup of its tiers.
 */
export function isCommitteeMemberActive(input: CommitteeEngagementClassificationInput): boolean {
  if (input.votingStatus === CommitteeMemberVotingStatus.EMERITUS) return false;
  if (isLfStaffObserverSeat(input)) return false;
  return input.attended > 0 || input.joinedWithinWindow;
}

/**
 * Whether a member belongs to the population `active_count` is measured over — i.e. whether they
 * could ever contribute to it, independent of whether *this* member happens to be active right
 * now. This is `CommitteeEngagementSummary.eligible_count`'s per-member rule, the correct
 * denominator for displaying `active_count` as a ratio (LFXV2-3101 review fix): counting Emeritus
 * and LF Staff+Observer seats in the denominator while `isCommitteeMemberActive` always excludes
 * them from the numerator means a committee that seats either could never read 100% active
 * regardless of real participation — the same shape of bug the ticket fixed for the At-Risk
 * filter, just showing up in the ratio instead. Attendance-independent by design (unlike
 * `isCommitteeMemberActive`, which mixes the exclusion with an attendance check) — a
 * never-attended non-Emeritus/non-staff member is still eligible, just not active.
 */
export function isCommitteeMemberActiveEligible(input: Pick<CommitteeEngagementClassificationInput, 'votingStatus' | 'role'>): boolean {
  return input.votingStatus !== CommitteeMemberVotingStatus.EMERITUS && !isLfStaffObserverSeat(input);
}

/**
 * Whether a member's `attended`/`invited` counts should feed the committee-wide `attendance_rate`
 * sum (LFXV2-3101) — `LF Staff`+`Observer` seats are excluded, Emeritus seats deliberately are NOT
 * (see `CommitteeEngagementSummary.attendance_rate`'s doc for why the two aren't symmetric here,
 * unlike every other rule in this file). Exported as its own named predicate, not left as an
 * inline check at the one call site, so this asymmetry is stated once in the module that owns
 * every other classification rule, rather than risking a second, easily-missed copy.
 *
 * Delegates to `isLfStaffObserverSeat`, independent of `classifyCommitteeEngagement`'s tier — a
 * member who is BOTH a real Emeritus (`votingStatus`) and a real LF Staff+Observer seat classifies
 * `Emeritus` (voting status wins first in the classifier's decision order) and renders the
 * Emeritus chip, but is still excluded from the rate sum here, since the exclusion is deliberately
 * seat-type-based, not classification-based. Rare in practice (an honorific legacy seat is not
 * usually also an active staff seat) but not undefined behavior: the check simply doesn't care
 * what tier the member displayed as.
 *
 * `input.role`'s and `input.votingStatus`'s values are whatever the caller resolved — for
 * `committee-engagement.service.ts` today that's the live roster's value first for BOTH fields,
 * warehouse `MEMBER_ROLE`/`MEMBER_VOTING_STATUS` only as the fallback when the roster value is
 * missing (Cursor Bugbot follow-up, LFXV2-3101: `votingStatus` used to stay warehouse-first even
 * after `role` was flipped roster-first, which meant a member promoted from Observer to a real
 * Voting/Alternate Rep could keep a stale warehouse `Observer` and stay incorrectly excluded here
 * until the next dbt refresh — this predicate combines both fields into one condition via
 * `isLfStaffObserverSeat`, so both need equally fresh precedence or the combination itself goes
 * stale even when each field individually wouldn't). The roster's typed `CommitteeMemberRole`/
 * `CommitteeMemberVotingStatus` are also safer match targets than the warehouse's untyped strings.
 */
export function isCommitteeMemberRateEligible(input: CommitteeEngagementClassificationInput): boolean {
  return !isLfStaffObserverSeat(input);
}

/**
 * `false` (fail-safe: no tenure protection) for a missing or unparseable join date. Shared between
 * `committee-engagement.service.ts` (per-member tenure clipping for `GET /:uid/engagement`) and
 * `groups-engagement-stats.service.ts` (the `active_members` rollup for `GET /engagement-stats`) so
 * both apply identical `member_joined_at` semantics from the LFXV2-1705 dbt model. This function is
 * one shared piece of a broader intent (LFXV2-1711: the two surfaces shouldn't disagree), not a
 * guarantee of exact agreement by itself — the groups rollup is warehouse-row-anchored only (no live
 * roster join per committee), so it can still diverge from the detail page's `window=30d` count for
 * a roster member the model hasn't picked up yet, a blank `MEMBER_VOTING_STATUS`, or a blank/
 * unparseable `MEMBER_JOINED_AT` — the detail page resolves all three via a live roster fetch (see
 * `groups-engagement-stats.service.ts`'s class doc). It also doesn't
 * apply at 90d/ytd, which the groups rollup doesn't compute at all (always the 30d definition).
 */
export function isJoinedWithinWindow(joinedAt: string | Date | null, windowStart: Date): boolean {
  if (!joinedAt) return false;
  const joined = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
  return !Number.isNaN(joined.getTime()) && joined.getTime() > windowStart.getTime();
}
