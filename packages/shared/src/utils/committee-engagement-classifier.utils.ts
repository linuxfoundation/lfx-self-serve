// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS } from '../constants/committee-engagement.constants';
import { CommitteeMemberVotingStatus } from '../enums';
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
 * Decision order (see the ticket's Jira thread for the full rationale):
 * 1. `Emeritus` voting status always wins — on the roster for legacy/honorific reasons, real
 *    attendance (often ~5%, per the model's real observed data) shouldn't read as disengagement.
 * 2. No invites yet, but joined within the window: no real opportunity has existed, so this can't
 *    be `Inactive` — tenure, not disengagement. Classified `High` (active by definition) rather
 *    than a new tier, since the ticket's classification set is fixed.
 * 3. No invites, and been a member the whole window: a genuine no-signal veteran — unchanged from
 *    the original rule.
 * 4-6. Invited at least once: threshold on the real (unrounded) rate as before.
 * 7. Invited at least once, attended nothing: a real disengagement signal regardless of tenure —
 *    unlike case 2, they had an actual opportunity and skipped every one of them, so tenure does
 *    not protect this case.
 */
export function classifyCommitteeEngagement(input: CommitteeEngagementClassificationInput): CommitteeEngagementClassification {
  const { attended, invited, votingStatus, joinedWithinWindow } = input;
  if (votingStatus === CommitteeMemberVotingStatus.EMERITUS) return 'Emeritus';
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
 * `Emeritus` and the tenure-grace `High` (case 2 above) are never at-risk — neither matches `Low`
 * or `Inactive`, so no extra exclusion logic is needed here.
 */
export function isCommitteeMemberAtRisk(input: CommitteeEngagementClassificationInput): boolean {
  const classification = classifyCommitteeEngagement(input);
  return classification === 'Low' || (classification === 'Inactive' && input.invited > 0);
}

/**
 * The "Active Members x/y" summary rule — deliberately broader than "classified High/Medium":
 * per the ticket, the numerator is members with *any* real attendance this window, plus members
 * who joined within it (active by definition of being newly on the roster), excluding Emeritus.
 * A `Low`-classified member (some attendance, just under the Medium threshold) still counts here —
 * this is a distinct rule from `classifyCommitteeEngagement`, not a rollup of its tiers.
 */
export function isCommitteeMemberActive(input: CommitteeEngagementClassificationInput): boolean {
  if (input.votingStatus === CommitteeMemberVotingStatus.EMERITUS) return false;
  return input.attended > 0 || input.joinedWithinWindow;
}

/**
 * `false` (fail-safe: no tenure protection) for a missing or unparseable join date. Shared between
 * `committee-engagement.service.ts` (per-member tenure clipping for `GET /:uid/engagement`) and
 * `groups-engagement-stats.service.ts` (the `active_members` rollup for `GET /engagement-stats`) so
 * both apply identical `member_joined_at` semantics from the LFXV2-1705 dbt model. This function is
 * one shared piece of a broader intent (LFXV2-1711: the two surfaces shouldn't disagree), not a
 * guarantee of exact agreement by itself — the groups rollup is warehouse-row-anchored only (no live
 * roster join per committee), so it can still diverge from the detail page's `window=30d` count for
 * a roster member the model hasn't picked up yet, or a blank `MEMBER_VOTING_STATUS` the detail page
 * resolves via the roster (see `groups-engagement-stats.service.ts`'s class doc). It also doesn't
 * apply at 90d/ytd, which the groups rollup doesn't compute at all (always the 30d definition).
 */
export function isJoinedWithinWindow(joinedAt: string | Date | null, windowStart: Date): boolean {
  if (!joinedAt) return false;
  const joined = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
  return !Number.isNaN(joined.getTime()) && joined.getTime() > windowStart.getTime();
}
