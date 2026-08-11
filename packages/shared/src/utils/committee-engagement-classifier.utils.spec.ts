// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums';
import {
  classifyCommitteeEngagement,
  computeCommitteeEngagementRate,
  isCommitteeMemberActive,
  isCommitteeMemberAtRisk,
  isCommitteeMemberRateEligible,
  isJoinedWithinWindow,
} from './committee-engagement-classifier.utils';

const VOTING_REP = CommitteeMemberVotingStatus.VOTING_REP;
const OBSERVER = CommitteeMemberVotingStatus.OBSERVER;
const EMERITUS = CommitteeMemberVotingStatus.EMERITUS;
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

  // Row 2 (LFXV2-3101): LF Staff role always wins too, regardless of real numbers.
  it('classifies LF Staff regardless of a low real attendance rate (0/0)', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 0, votingStatus: OBSERVER, role: LF_STAFF, joinedWithinWindow: false })).toBe('LF Staff');
  });

  it('classifies LF Staff even for real attendance', () => {
    expect(classifyCommitteeEngagement({ attended: 5, invited: 5, votingStatus: VOTING_REP, role: LF_STAFF, joinedWithinWindow: false })).toBe('LF Staff');
  });

  it('does not broaden the LF Staff carve-out to non-staff Observers', () => {
    expect(classifyCommitteeEngagement({ attended: 2, invited: 10, votingStatus: OBSERVER, joinedWithinWindow: false })).toBe('Low');
  });

  it('does not broaden the LF Staff carve-out to a real Chair with zero attendance', () => {
    expect(classifyCommitteeEngagement({ attended: 0, invited: 3, votingStatus: VOTING_REP, role: CHAIR, joinedWithinWindow: false })).toBe('Inactive');
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

  it('is always false for LF Staff, even with real attendance or a fresh join (LFXV2-3101)', () => {
    expect(isCommitteeMemberActive({ attended: 5, invited: 5, votingStatus: VOTING_REP, role: LF_STAFF, joinedWithinWindow: true })).toBe(false);
  });
});

describe('isCommitteeMemberRateEligible (LFXV2-3101)', () => {
  it('is false for LF Staff, regardless of real attendance', () => {
    expect(isCommitteeMemberRateEligible({ attended: 8, invited: 8, votingStatus: VOTING_REP, role: LF_STAFF, joinedWithinWindow: false })).toBe(false);
  });

  it('is true for Emeritus — unlike every other rule in this file, Emeritus is NOT rate-excluded', () => {
    expect(isCommitteeMemberRateEligible({ attended: 1, invited: 20, votingStatus: EMERITUS, joinedWithinWindow: false })).toBe(true);
  });

  it('is true for a real Chair with zero attendance (the carve-out is role-based, not a broad exclusion)', () => {
    expect(isCommitteeMemberRateEligible({ attended: 0, invited: 3, votingStatus: VOTING_REP, role: CHAIR, joinedWithinWindow: false })).toBe(true);
  });

  it('is true for a member with no role set at all (undefined, not LF Staff)', () => {
    expect(isCommitteeMemberRateEligible({ attended: 5, invited: 10, votingStatus: VOTING_REP, joinedWithinWindow: false })).toBe(true);
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
