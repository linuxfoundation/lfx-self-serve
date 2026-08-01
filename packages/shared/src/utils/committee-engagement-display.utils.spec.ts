// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CommitteeMemberEngagement } from '../interfaces/committee-engagement.interface';
import { formatCommitteeEngagementMeetings, formatCommitteeEngagementRatePercent, isCommitteeEngagementRowAtRisk } from './committee-engagement-display.utils';

function buildRow(overrides: Partial<CommitteeMemberEngagement> = {}): CommitteeMemberEngagement {
  return {
    uid: 'member-1',
    attended: 8,
    invited: 12,
    rate: 0.67,
    classification: 'Medium',
    role: 'None',
    voting_status: 'Voting Rep',
    committee_meetings: 12,
    ...overrides,
  };
}

describe('isCommitteeEngagementRowAtRisk', () => {
  it('flags Low members', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Low', attended: 2, invited: 10, rate: 0.2 }))).toBe(true);
  });

  it('flags Inactive members who had real invites (signal to act on)', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Inactive', attended: 0, invited: 5, rate: 0 }))).toBe(true);
  });

  it('does not flag Inactive members who were never invited', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Inactive', attended: 0, invited: 0, rate: 0 }))).toBe(false);
  });

  it('never flags Emeritus regardless of counts', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Emeritus', voting_status: 'Emeritus', attended: 0, invited: 10, rate: 0 }))).toBe(false);
  });

  it('does not flag High or Medium members', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'High', rate: 1 }))).toBe(false);
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Medium' }))).toBe(false);
  });

  it('trusts the served classification over the rounded rate (boundary case)', () => {
    // 0.395 rounds to 0.40 for display but classifies Low server-side — the row must stay at-risk.
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Low', attended: 79, invited: 200, rate: 0.4 }))).toBe(true);
  });

  it('never flags zeroed rows from a degraded response', () => {
    expect(isCommitteeEngagementRowAtRisk(buildRow({ classification: 'Inactive', attended: 0, invited: 0, rate: 0 }))).toBe(false);
  });
});

describe('formatCommitteeEngagementMeetings', () => {
  it('renders personal attended/invited', () => {
    expect(formatCommitteeEngagementMeetings(buildRow({ attended: 12, invited: 12 }), true)).toBe('12/12');
    expect(formatCommitteeEngagementMeetings(buildRow({ attended: 0, invited: 0 }), true)).toBe('0/0');
  });

  it('renders an em-dash when data is unavailable', () => {
    expect(formatCommitteeEngagementMeetings(buildRow(), false)).toBe('—');
  });

  it('renders an em-dash when the member has no engagement row', () => {
    expect(formatCommitteeEngagementMeetings(null, true)).toBe('—');
    expect(formatCommitteeEngagementMeetings(undefined, true)).toBe('—');
  });
});

describe('formatCommitteeEngagementRatePercent', () => {
  it('formats a ratio as a whole percent', () => {
    expect(formatCommitteeEngagementRatePercent(0.784)).toBe('78%');
    expect(formatCommitteeEngagementRatePercent(0.785)).toBe('79%');
    expect(formatCommitteeEngagementRatePercent(0)).toBe('0%');
    expect(formatCommitteeEngagementRatePercent(1)).toBe('100%');
  });
});
