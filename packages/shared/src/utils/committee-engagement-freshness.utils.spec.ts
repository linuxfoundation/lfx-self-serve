// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatCommitteeEngagementFreshness } from './committee-engagement-freshness.utils';

describe('formatCommitteeEngagementFreshness', () => {
  it('returns the daily-refresh fallback for null (the only reachable case today)', () => {
    expect(formatCommitteeEngagementFreshness(null)).toBe('Updated daily');
  });

  it('returns the daily-refresh fallback for an unparseable value', () => {
    expect(formatCommitteeEngagementFreshness('not-a-date')).toBe('Updated daily');
  });

  it('formats a real ISO timestamp for whenever the model exposes one', () => {
    expect(formatCommitteeEngagementFreshness('2026-07-28T00:00:00.000Z')).toBe('Updated Jul 28');
  });
});
