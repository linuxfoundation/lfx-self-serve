// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS } from '../constants/committee-engagement.constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums';
import type { CommitteeEngagementClassification, CommitteeEngagementClassificationInput } from '../interfaces/committee-engagement.interface';

/**
 * `attended / invited`, 0 when nobody was invited. Clamps `attended` to `invited` as a defensive
 * guard against warehouse data quality, not because a rate over 1 is expected. Always personal
 * `attended/invited`, never `attended/committee_meetings` — the latter is a committee-wide total
 * that would misclassify a tenure-limited member (e.g. `invited=5, attended=5` reads 100%, but
 * `5/committee_meetings` could read far lower and wrongly flag them At-Risk).
 */
function rawCommitteeEngagementRate(attended: number, invited: number): number {
  if (invited <= 0) return 0;
  const clampedAttended = Math.min(Math.max(attended, 0), invited);
  return clampedAttended / invited;
}

/**
 * `rawCommitteeEngagementRate`, rounded to 2 decimal places for display. Classification uses the
 * unrounded rate — thresholding the rounded value would flip e.g. 0.395 into `Medium` (rounds to
 * 0.40) despite falling under the threshold before rounding. Unaffected by seat type or tenure, so
 * an Emeritus member's real (low) rate is still visible here.
 */
export function computeCommitteeEngagementRate(attended: number, invited: number): number {
  return Math.round(rawCommitteeEngagementRate(attended, invited) * 100) / 100;
}

/**
 * Whether a member is an LF Staff seat with no real voting seat — `role === LF_STAFF` alone is not
 * enough; also requires `votingStatus` to be `Observer` or `None` (the latter is the norm on
 * committees with voting disabled, since the member form hides the Role/Voting Status fields
 * entirely there — but that's a UI default, not a guarantee: API/import/legacy data can still set
 * a real voting status). Neither Observer nor no-status carries a real attendance expectation,
 * which is what the exclusion protects; an LF Staff member who is a genuine Voting Rep, Alternate
 * Voting Rep, or Emeritus (a fifth status this predicate doesn't match — see
 * `classifyCommitteeEngagement`'s Emeritus-wins-first precedence below) classifies/counts normally.
 * Scoped to `role`+`(Observer|None)` specifically, not every Observer/None regardless of role — a
 * non-staff member with either status can still have real engagement expectations.
 */
export function isLfStaffNonVotingSeat(input: Pick<CommitteeEngagementClassificationInput, 'role' | 'votingStatus'>): boolean {
  return (
    input.role === CommitteeMemberRole.LF_STAFF &&
    (input.votingStatus === CommitteeMemberVotingStatus.OBSERVER || input.votingStatus === CommitteeMemberVotingStatus.NONE)
  );
}

/**
 * Decision order:
 * 1. `Emeritus` voting status always wins — on the roster for legacy/honorific reasons, low real
 *    attendance shouldn't read as disengagement.
 * 2. `LF Staff` + no real voting seat wins next — see `isLfStaffNonVotingSeat`'s doc.
 * 3. No invites yet, but joined within the window: no real opportunity has existed, so this can't
 *    be `Inactive` — tenure, not disengagement. Classified `High` (active by definition).
 * 4. No invites, and been a member the whole window: a genuine no-signal veteran.
 * 5-7. Invited at least once: threshold on the real (unrounded) rate.
 * 8. Invited at least once, attended nothing: a real disengagement signal regardless of tenure —
 *    unlike case 3, they had an actual opportunity and skipped every one of them.
 */
export function classifyCommitteeEngagement(input: CommitteeEngagementClassificationInput): CommitteeEngagementClassification {
  const { attended, invited, votingStatus, joinedWithinWindow } = input;
  if (votingStatus === CommitteeMemberVotingStatus.EMERITUS) return 'Emeritus';
  if (isLfStaffNonVotingSeat(input)) return 'LF Staff';
  if (invited <= 0) return joinedWithinWindow ? 'High' : 'Inactive';

  const rate = rawCommitteeEngagementRate(attended, invited);
  // `<=`, not `===`: defensive against `rawCommitteeEngagementRate`'s internal clamp ever being
  // weakened, not because a negative rate is reachable today — by this point the `invited <= 0`
  // guard above has returned, so `invited > 0`, and `attended` is clamped to `[0, invited]`, so
  // `rate` is always in `[0, 1]`.
  if (rate <= 0) return 'Inactive';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.high) return 'High';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

/**
 * `Low` members are at risk by definition. A member invited within the window who attended
 * nothing is at risk too, even though `classifyCommitteeEngagement` also calls them `Inactive` —
 * that tier's other member (never invited at all) has no signal to act on, but this one does.
 * `Emeritus`, `LF Staff`+non-voting, and the tenure-grace `High` never match `Low` or `Inactive`,
 * so no extra exclusion logic is needed here.
 */
export function isCommitteeMemberAtRisk(input: CommitteeEngagementClassificationInput): boolean {
  const classification = classifyCommitteeEngagement(input);
  return classification === 'Low' || (classification === 'Inactive' && input.invited > 0);
}

/**
 * The "Active Members x/y" summary rule — deliberately broader than "classified High/Medium": the
 * numerator is members with *any* real attendance this window, plus members who joined within it,
 * excluding Emeritus and LF Staff+non-voting seats. Doesn't delegate to `classifyCommitteeEngagement`,
 * so both exclusions need their own explicit check here. A `Low`-classified member (some
 * attendance, just under the Medium threshold) still counts — this is a distinct rule, not a
 * rollup of the classifier's tiers.
 */
export function isCommitteeMemberActive(input: CommitteeEngagementClassificationInput): boolean {
  if (input.votingStatus === CommitteeMemberVotingStatus.EMERITUS) return false;
  if (isLfStaffNonVotingSeat(input)) return false;
  return input.attended > 0 || input.joinedWithinWindow;
}

/**
 * Whether a member belongs to the population `active_count` is measured over — i.e. whether they
 * could ever contribute to it, independent of whether *this* member happens to be active right
 * now. This is `CommitteeEngagementSummary.eligible_count`'s per-member rule, the correct
 * denominator for displaying `active_count` as a ratio: counting Emeritus and LF Staff+non-voting
 * seats in the denominator while `isCommitteeMemberActive` always excludes them from the numerator
 * means a committee that seats either could never read 100% active regardless of real
 * participation. Attendance-independent by design (unlike `isCommitteeMemberActive`) — a
 * never-attended non-Emeritus/non-staff member is still eligible, just not active.
 */
export function isCommitteeMemberActiveEligible(input: Pick<CommitteeEngagementClassificationInput, 'votingStatus' | 'role'>): boolean {
  return input.votingStatus !== CommitteeMemberVotingStatus.EMERITUS && !isLfStaffNonVotingSeat(input);
}

/**
 * Whether a member's `attended`/`invited` counts should feed the committee-wide `attendance_rate`
 * sum — `LF Staff`+non-voting seats are excluded, Emeritus seats deliberately are NOT (see
 * `CommitteeEngagementSummary.attendance_rate`'s doc for why the two aren't symmetric here).
 * Named predicate, not an inline check, so both `committee-engagement.service.ts` (the sum) and
 * `CommitteeEngagementSummaryComponent.hasInvitedRateEligibleMember` (the UI gate, which also
 * requires `invited > 0`) call the same condition. Parameter narrowed to `role`/`votingStatus` so
 * a caller without `attended`/`invited`/`joinedWithinWindow` — like the UI — can call it directly,
 * mirroring `isCommitteeMemberActiveEligible` above.
 *
 * Delegates to `isLfStaffNonVotingSeat`: an `LF Staff` member with a real `Emeritus` voting status
 * is NOT excluded here — the same reason they classify `Emeritus` rather than `LF Staff` in
 * `classifyCommitteeEngagement`. One check, one answer; no case where the two disagree.
 *
 * `input.role`/`input.votingStatus` are whatever the caller resolved.
 * `committee-engagement.service.ts` resolves the live roster's value first for both fields,
 * falling back to warehouse `MEMBER_ROLE`/`MEMBER_VOTING_STATUS` only when the roster value is
 * missing — both fields need equally fresh precedence, since combining a fresh `role` with a
 * stale warehouse `votingStatus` (or vice versa) would make this predicate wrong even when
 * neither field alone is.
 */
export function isCommitteeMemberRateEligible(input: Pick<CommitteeEngagementClassificationInput, 'role' | 'votingStatus'>): boolean {
  return !isLfStaffNonVotingSeat(input);
}

/**
 * `false` (fail-safe: no tenure protection) for a missing or unparseable join date. Shared between
 * `committee-engagement.service.ts` (per-member tenure clipping) and
 * `groups-engagement-stats.service.ts` (the `active_members` rollup) so both apply identical
 * `member_joined_at` semantics — not a guarantee of exact agreement between the two: the rollup is
 * warehouse-row-anchored only (no live roster join), so it can still diverge from the detail
 * page's `window=30d` count for a roster member the model hasn't picked up yet. Also doesn't apply
 * at 90d/ytd, which the rollup doesn't compute (always the 30d definition).
 */
export function isJoinedWithinWindow(joinedAt: string | Date | null, windowStart: Date): boolean {
  if (!joinedAt) return false;
  const joined = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
  return !Number.isNaN(joined.getTime()) && joined.getTime() > windowStart.getTime();
}
