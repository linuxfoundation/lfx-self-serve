// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums';
import {
  classifyCommitteeEngagement,
  computeCommitteeEngagementRate,
  isCommitteeMemberActive,
  isCommitteeMemberActiveEligible,
  isCommitteeMemberAtRisk,
  isCommitteeMemberRateEligible,
  isJoinedWithinWindow,
  isLfStaffNonVotingSeat,
} from './committee-engagement-classifier.utils';

const VOTING_REP = CommitteeMemberVotingStatus.VOTING_REP;
const ALTERNATE_VOTING_REP = CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP;
const OBSERVER = CommitteeMemberVotingStatus.OBSERVER;
const EMERITUS = CommitteeMemberVotingStatus.EMERITUS;
const NONE = CommitteeMemberVotingStatus.NONE;
const CHAIR = CommitteeMemberRole.CHAIR;
const LF_STAFF = CommitteeMemberRole.LF_STAFF;

describe('computeCommitteeEngagementRate', () => {
  it('returns 0 when invited is 0', () => {
    expect(computeCommitteeEngagementRate(0, 0)).toBe(0);
  });

  it('returns 0 when invited is negative', () => {
    expect(computeCommitteeEngagementRate(5, -1)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeCommitteeEngagementRate(1, 3)).toBe(0.33);
  });

  it('returns 1 for a perfect attendance record', () => {
    expect(computeCommitteeEngagementRate(4, 4)).toBe(1);
  });

  it('clamps attended to invited, capping the rate at 1 rather than exceeding it', () => {
    expect(computeCommitteeEngagementRate(12, 10)).toBe(1);
  });
});

describe('classifyCommitteeEngagement — decision table', () => {
  // Row 1: Emeritus always wins, regardless of real numbers.
  it('classifies Emeritus regardless of a low real attendance rate', () => {
    expect(classifyCommitteeEngagement({ attended: 1, invited: 20, votingStatus: EMERITUS, joinedWithinWindow: false })).toBe('Emeritus');
  });

  it('classifies Emeritus even for perfect attendance', () => {
    expect(classifyCommitteeEngagement({ attended: 10, invited: 10, votingStatus: EMERITUS, joinedWithinWindow: false })).toBe('Emeritus');
  });

  // Row 2 (LFXV2-3101, broadened GH-1848): LF Staff + no real voting seat (Observer, or no voting
  // status at all) wins too, regardless of real numbers.
  it('classifies LF Staff regardless of a low real attendance rate (0/0), when voting status is Observer', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: OBSERVER, role: LF_STAFF, joinedWithinWindow: false })).toBe('LF Staff');
  });

  it('classifies LF Staff even for real attendance, when voting status is Observer', () => {
    expect(classifyCommitteeEngagement({ attended: 5, invited: 5, votingStatus: OBSERVER, role: LF_STAFF, joinedWithinWindow: false })).toBe('LF Staff');
  });

  // GH-1848: on a committee with no voting, staff seats never get assigned a voting status and
  // resolve to the 'None' sentinel — previously this fell through the Observer-only carve-out and
  // tenure-graced a literal 0/0 seat to 'High'; that was the exact reported bug.
  it('classifies LF Staff (not the tenure-grace High) for a 0/0 staff seat with no voting status, even joined within the window', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: NONE, role: LF_STAFF, joinedWithinWindow: true })).toBe('LF Staff');
  });

  it('classifies LF Staff for real attendance too, when voting status is None', () => {
    expect(classifyCommitteeEngagement({ attended: 3, invited: 5, votingStatus: NONE, role: LF_STAFF, joinedWithinWindow: false })).toBe('LF Staff');
  });

  it('does not broaden the LF Staff carve-out to non-staff Observers', () => {
    expect(classifyCommitteeEngagement({ attended: 2, invited: 10, votingStatus: OBSERVER, joinedWithinWindow: false })).toBe('Low');
  });

  it('does not broaden the None carve-out beyond staff — a non-staff member with no voting status still classifies on attendance/tenure normally', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: NONE, joinedWithinWindow: true })).toBe('High');
    expect(classifyCommitteeEngagement({ attended: 0, invited: 3, votingStatus: NONE, joinedWithinWindow: false })).toBe('Inactive');
  });

  it('does not broaden the LF Staff carve-out to a real Chair with zero attendance', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 3, votingStatus: VOTING_REP, role: CHAIR, joinedWithinWindow: false })).toBe('Inactive');
  });

  // LFXV2-3101 follow-up (Jordan Evans review), broadened GH-1848: an LF Staff member who is also
  // a real Voting Rep or Alternate Voting Rep (an ED or staff member serving as a board/committee
  // representative) is a genuine participant and must classify/count normally — only a staff seat
  // with no real voting role (Observer or None) is excluded, not every LF Staff member regardless
  // of their real voting role.
  it('does NOT classify LF Staff for a real Voting Rep who happens to be LF Staff — classifies on real attendance instead', () => {
    expect(classifyCommitteeEngagement({ attended: 5, invited: 5, votingStatus: VOTING_REP, role: LF_STAFF, joinedWithinWindow: false })).toBe('High');
  });

  it('does NOT classify LF Staff for a real Alternate Voting Rep who happens to be LF Staff', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 5, votingStatus: ALTERNATE_VOTING_REP, role: LF_STAFF, joinedWithinWindow: false })).toBe(
      'Inactive'
    );
  });

  // Staff + Emeritus: Emeritus wins first in the decision order regardless of role, and this
  // behavior is unchanged by the GH-1848 broadening (Emeritus is neither Observer nor None).
  it('classifies Emeritus (not LF Staff) for a staff member with Emeritus voting status', () => {
    expect(classifyCommitteeEngagement({ attended: 1, invited: 20, votingStatus: EMERITUS, role: LF_STAFF, joinedWithinWindow: false })).toBe('Emeritus');
  });

  // Row 3: no invites yet, joined within window — "the Orlin case", but the invited=0 variant.
  it('classifies High (not Inactive) for a member with zero invites who joined within the window', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: true })).toBe('High');
  });

  // Row 4: no invites, been a member the whole window — unchanged from the original rule.
  it('classifies Inactive for a never-invited member who has been on the roster the whole window', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Inactive');
  });

  // Rows 5-7: threshold on the real rate, unchanged boundaries.
  it('classifies a rate just below the medium threshold as Low', () => {
    expect(classifyCommitteeEngagement({ attended: 39, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Low');
  });

  it('classifies a rate exactly at the medium threshold as Medium', () => {
    expect(classifyCommitteeEngagement({ attended: 40, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Medium');
  });

  it('classifies a rate just below the high threshold as Medium', () => {
    expect(classifyCommitteeEngagement({ attended: 74, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Medium');
  });

  it('classifies a rate exactly at the high threshold as High', () => {
    expect(classifyCommitteeEngagement({ attended: 75, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('High');
  });

  it('classifies perfect attendance as High', () => {
    expect(classifyCommitteeEngagement({ attended: 10, invited: 10, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('High');
  });

  it('classifies a rate that only reaches the medium threshold after rounding as Low', () => {
    // 395/1000 = 0.395, which rounds to the displayed 0.40 (the medium threshold) but is below it
    // before rounding. Classification must use the raw rate or this misclassifies as Medium.
    expect(computeCommitteeEngagementRate(395, 1000)).toBe(0.4);
    expect(classifyCommitteeEngagement({ attended: 395, invited: 1000, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Low');
  });

  // Row 8: invited at least once, attended nothing — a real signal, tenure does not protect it.
  it('classifies Inactive for a member invited at least once who attended nothing, even if joined within the window', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 3, votingStatus: VOTING_REP, joinedWithinWindow: true })).toBe('Inactive');
    expect(classifyCommitteeEngagement({ attended: 0, invited: 3, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe('Inactive');
  });

  // The ticket's real example: Orlin Vasilev, joined mid-window, invited_ytd=5, attended_ytd=5.
  it('the Orlin case: joined mid-window, invited 5, attended 5, classifies High at 100% and is never at-risk', () => {
    const input = { attended: 5, invited: 5, votingStatus: VOTING_REP, joinedWithinWindow: true };
    expect(computeCommitteeEngagementRate(input.attended, input.invited)).toBe(1);
    expect(classifyCommitteeEngagement(input)).toBe('High');
    expect(isCommitteeMemberAtRisk(input)).toBe(false);
  });
});

describe('isCommitteeMemberAtRisk', () => {
  it('is false for a never-invited member who joined within the window (Inactive is unreachable there)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: true })).toBe(false);
  });

  it('is false for a never-invited veteran member (Inactive with no signal)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(false);
  });

  it('is true for an invited member who attended nothing (Inactive with negative signal)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 5, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(true);
  });

  it('is true for a Low-classified member', () => {
    expect(isCommitteeMemberAtRisk({ attended: 10, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(true);
  });

  it('is false for Medium and High members', () => {
    expect(isCommitteeMemberAtRisk({ attended: 40, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(false);
    expect(isCommitteeMemberAtRisk({ attended: 100, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(false);
  });

  it('is never true for an Emeritus member, regardless of real attendance', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 20, votingStatus: EMERITUS, joinedWithinWindow: false })).toBe(false);
  });

  it('is never true for an LF Staff member, regardless of real attendance (LFXV2-3101)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 20, votingStatus: OBSERVER, role: LF_STAFF, joinedWithinWindow: false })).toBe(false);
  });

  it('is never true for an LF Staff member with no voting status, same as Observer (GH-1848)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 0, invited: 20, votingStatus: NONE, role: LF_STAFF, joinedWithinWindow: false })).toBe(false);
  });

  it('is still true for a non-staff Observer with a low real rate (the carve-out is role-based, not voting-status-based)', () => {
    expect(isCommitteeMemberAtRisk({ attended: 10, invited: 100, votingStatus: OBSERVER, joinedWithinWindow: false })).toBe(true);
  });
});

describe('isCommitteeMemberActive', () => {
  it('is true for any real attendance, even a Low-classified rate', () => {
    const input = { attended: 5, invited: 100, votingStatus: VOTING_REP, joinedWithinWindow: false };
    expect(classifyCommitteeEngagement(input)).toBe('Low');
    expect(isCommitteeMemberActive(input)).toBe(true);
  });

  it('is true for a member who joined within the window, regardless of counts', () => {
    expect(isCommitteeMemberActive({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: true })).toBe(true);
  });

  it('is false for a never-invited veteran member', () => {
    expect(isCommitteeMemberActive({ attended: 0, invited: 0, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(false);
  });

  it('is false for an invited member who attended nothing', () => {
    expect(isCommitteeMemberActive({ attended: 0, invited: 5, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(false);
  });

  it('is always false for Emeritus, even with real attendance or a fresh join', () => {
    expect(isCommitteeMemberActive({ attended: 5, invited: 5, votingStatus: EMERITUS, joinedWithinWindow: true })).toBe(false);
  });

  it('is always false for LF Staff + Observer, even with real attendance or a fresh join (LFXV2-3101)', () => {
    expect(isCommitteeMemberActive({ attended: 5, invited: 5, votingStatus: OBSERVER, role: LF_STAFF, joinedWithinWindow: true })).toBe(false);
  });

  it('is always false for LF Staff + no voting status, same as Observer (GH-1848)', () => {
    expect(isCommitteeMemberActive({ attended: 5, invited: 5, votingStatus: NONE, role: LF_STAFF, joinedWithinWindow: true })).toBe(false);
  });

  it('is true for a real Voting Rep who happens to be LF Staff — only non-voting staff seats are excluded (LFXV2-3101 follow-up)', () => {
    expect(isCommitteeMemberActive({ attended: 5, invited: 5, votingStatus: VOTING_REP, role: LF_STAFF, joinedWithinWindow: false })).toBe(true);
  });
});

describe('isCommitteeMemberActiveEligible (LFXV2-3101 review fix — the active_count/eligible_count denominator)', () => {
  it('is false for Emeritus, so an Emeritus-heavy committee is not permanently capped below 100% active', () => {
    expect(isCommitteeMemberActiveEligible({ votingStatus: EMERITUS, role: undefined })).toBe(false);
  });

  it('is false for LF Staff, for the same reason', () => {
    expect(isCommitteeMemberActiveEligible({ votingStatus: OBSERVER, role: LF_STAFF })).toBe(false);
  });

  it('is false for LF Staff with no voting status, same as Observer (GH-1848)', () => {
    expect(isCommitteeMemberActiveEligible({ votingStatus: NONE, role: LF_STAFF })).toBe(false);
  });

  it('is true for a real member regardless of attendance — eligibility is attendance-independent, unlike isCommitteeMemberActive', () => {
    expect(isCommitteeMemberActiveEligible({ votingStatus: VOTING_REP, role: CHAIR })).toBe(true);
    expect(isCommitteeMemberActiveEligible({ votingStatus: VOTING_REP, role: undefined })).toBe(true);
  });

  it('is true for a non-staff Observer (the carve-out is role-based, not voting-status-based)', () => {
    expect(isCommitteeMemberActiveEligible({ votingStatus: OBSERVER, role: undefined })).toBe(true);
  });
});

describe('isCommitteeMemberRateEligible (LFXV2-3101)', () => {
  it('is false for LF Staff + Observer, regardless of real attendance', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: OBSERVER, role: LF_STAFF })).toBe(false);
  });

  it('is false for LF Staff with no voting status, same as Observer (GH-1848)', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: NONE, role: LF_STAFF })).toBe(false);
  });

  it('is true for a real Voting Rep who happens to be LF Staff — only non-voting staff seats are excluded (LFXV2-3101 follow-up)', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: VOTING_REP, role: LF_STAFF })).toBe(true);
  });

  it('is true for Emeritus — unlike every other rule in this file, Emeritus is NOT rate-excluded', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: EMERITUS, role: undefined })).toBe(true);
  });

  it('is true for a real Chair regardless of attendance — the carve-out is role-based, not a broad exclusion, and this predicate is attendance-independent', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: VOTING_REP, role: CHAIR })).toBe(true);
  });

  it('is true for a member with no role set at all (undefined, not LF Staff)', () => {
    expect(isCommitteeMemberRateEligible({ votingStatus: VOTING_REP, role: undefined })).toBe(true);
  });

  it('is true for a member who is BOTH Emeritus and LF Staff — the LF Staff rate exclusion is scoped to non-voting status (Observer or None) specifically, and Emeritus is neither', () => {
    // LFXV2-3101 follow-up, broadened GH-1848: the LF Staff exclusion only fires for
    // role === LF_STAFF && (votingStatus === Observer || votingStatus === None). An
    // Emeritus+LF-Staff member's votingStatus is Emeritus, not Observer or None, so
    // isLfStaffNonVotingSeat is false here — they classify Emeritus (voting status wins first in
    // the classifier) and are rate-eligible via the ordinary Emeritus-inclusion rule, not excluded
    // a second way by role.
    const input = { attended: 1, invited: 20, votingStatus: EMERITUS, role: LF_STAFF, joinedWithinWindow: false };
    expect(classifyCommitteeEngagement(input)).toBe('Emeritus');
    expect(isCommitteeMemberRateEligible(input)).toBe(true);
  });
});

describe('isJoinedWithinWindow', () => {
  const windowStart = new Date('2024-06-01T00:00:00.000Z');

  it('is true for a date after the window start', () => {
    expect(isJoinedWithinWindow('2024-06-15T00:00:00.000Z', windowStart)).toBe(true);
  });

  it('is false for a date before the window start', () => {
    expect(isJoinedWithinWindow('2024-01-01T00:00:00.000Z', windowStart)).toBe(false);
  });

  it('is false for a date exactly at the window start (strictly after, not on-or-after)', () => {
    expect(isJoinedWithinWindow(windowStart.toISOString(), windowStart)).toBe(false);
  });

  it('is false (fail-safe) for null', () => {
    expect(isJoinedWithinWindow(null, windowStart)).toBe(false);
  });

  it('is false (fail-safe) for an empty string', () => {
    expect(isJoinedWithinWindow('', windowStart)).toBe(false);
  });

  it('is false (fail-safe) for an unparseable date string', () => {
    expect(isJoinedWithinWindow('not-a-real-date', windowStart)).toBe(false);
  });

  it('accepts a Date instance directly, not just a string', () => {
    expect(isJoinedWithinWindow(new Date('2024-06-15T00:00:00.000Z'), windowStart)).toBe(true);
  });
});

describe('isLfStaffNonVotingSeat (LFXV2-3101, broadened GH-1848)', () => {
  it('is true for LF Staff + Observer', () => {
    expect(isLfStaffNonVotingSeat({ role: LF_STAFF, votingStatus: OBSERVER })).toBe(true);
  });

  it('is true for LF Staff + None', () => {
    expect(isLfStaffNonVotingSeat({ role: LF_STAFF, votingStatus: NONE })).toBe(true);
  });

  it('is false for LF Staff + a real voting seat', () => {
    expect(isLfStaffNonVotingSeat({ role: LF_STAFF, votingStatus: VOTING_REP })).toBe(false);
    expect(isLfStaffNonVotingSeat({ role: LF_STAFF, votingStatus: ALTERNATE_VOTING_REP })).toBe(false);
  });

  it('is false for LF Staff + Emeritus (Emeritus wins first in the classifier, not this predicate)', () => {
    expect(isLfStaffNonVotingSeat({ role: LF_STAFF, votingStatus: EMERITUS })).toBe(false);
  });

  it('is false for a non-staff Observer — the carve-out is role-based, not voting-status-based', () => {
    expect(isLfStaffNonVotingSeat({ role: CHAIR, votingStatus: OBSERVER })).toBe(false);
  });

  it('is false for a non-staff member with no voting status', () => {
    expect(isLfStaffNonVotingSeat({ role: undefined, votingStatus: NONE })).toBe(false);
  });
});
