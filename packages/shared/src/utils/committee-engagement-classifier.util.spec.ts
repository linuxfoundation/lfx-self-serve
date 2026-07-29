// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { classifyCommitteeEngagement, computeCommitteeEngagementRate } from './committee-engagement-classifier.util';

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
});

describe('classifyCommitteeEngagement', () => {
  it('classifies never-invited members as Inactive', () => {
    expect(classifyCommitteeEngagement(0, 0)).toBe('Inactive');
  });

  it('classifies invited-but-zero-attendance members as Inactive', () => {
    expect(classifyCommitteeEngagement(0, 5)).toBe('Inactive');
  });

  it('classifies a rate just below the medium threshold as Low', () => {
    expect(classifyCommitteeEngagement(39, 100)).toBe('Low');
  });

  it('classifies a rate exactly at the medium threshold as Medium', () => {
    expect(classifyCommitteeEngagement(40, 100)).toBe('Medium');
  });

  it('classifies a rate just below the high threshold as Medium', () => {
    expect(classifyCommitteeEngagement(74, 100)).toBe('Medium');
  });

  it('classifies a rate exactly at the high threshold as High', () => {
    expect(classifyCommitteeEngagement(75, 100)).toBe('High');
  });

  it('classifies perfect attendance as High', () => {
    expect(classifyCommitteeEngagement(10, 10)).toBe('High');
  });
});
