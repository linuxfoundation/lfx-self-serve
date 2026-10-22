// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { describeContributionsWindow } from './org-contributions.util';

describe('describeContributionsWindow', () => {
  const now = new Date('2026-10-21T23:26:00.000Z');

  it.each([
    ['12mo', 'Oct 21, 2025 – Oct 21, 2026 (UTC)'],
    ['90d', 'Jul 23, 2026 – Oct 21, 2026 (UTC)'],
    ['30d', 'Sep 21, 2026 – Oct 21, 2026 (UTC)'],
    ['all', 'all recorded history'],
  ] as const)('describes %s', (range, expected) => {
    expect(describeContributionsWindow(range, now)).toBe(expected);
  });
});
