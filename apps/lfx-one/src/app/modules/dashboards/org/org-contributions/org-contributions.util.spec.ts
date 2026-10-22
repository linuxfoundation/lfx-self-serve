// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { describeContributionsWindow } from './org-contributions.util';

describe('describeContributionsWindow', () => {
  const now = new Date('2026-10-21T23:26:00.000Z');

  it.each([
    ['12mo', 'from Oct 21, 2025 to Oct 21, 2026 (UTC)'],
    ['90d', 'from Jul 23, 2026 to Oct 21, 2026 (UTC)'],
    ['30d', 'from Sep 21, 2026 to Oct 21, 2026 (UTC)'],
    ['all', 'across all recorded history'],
  ] as const)('describes %s', (range, expected) => {
    expect(describeContributionsWindow(range, now)).toBe(expected);
  });

  // Twelve months back lands in the same calendar month, so the leap day is the only date where the
  // target month is shorter. `DATEADD(month, -12, ...)` clamps to Feb 28; a bare `setUTCMonth` would
  // overflow to Mar 1 and put the caption a day off exactly when someone is reconciling source rows.
  it('clamps the 12-month start on a leap day instead of overflowing', () => {
    expect(describeContributionsWindow('12mo', new Date('2028-02-29T12:00:00.000Z'))).toBe('from Feb 28, 2027 to Feb 29, 2028 (UTC)');
  });

  it('leaves the 12-month start alone on a date the target month can hold', () => {
    expect(describeContributionsWindow('12mo', new Date('2028-02-28T12:00:00.000Z'))).toBe('from Feb 28, 2027 to Feb 28, 2028 (UTC)');
  });
});
