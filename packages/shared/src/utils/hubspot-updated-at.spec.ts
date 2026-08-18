// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { formatHubSpotUpdatedAt } from './date-time.utils';

describe('formatHubSpotUpdatedAt', () => {
  it('refuses dates that do not exist rather than rolling them over', () => {
    // JS rolls 2026-02-31 into Mar 3 and 0001 into 1901; both rendered a confident wrong date.
    expect(formatHubSpotUpdatedAt('2026-02-31')).toBe('');
    expect(formatHubSpotUpdatedAt('2026-02-30')).toBe('');
    expect(formatHubSpotUpdatedAt('0001-01-01')).toBe('');
    expect(formatHubSpotUpdatedAt('2026-13-01')).toBe('');
  });

  it('renders a real date-only value in local terms, not UTC-shifted', () => {
    expect(formatHubSpotUpdatedAt('2026-08-14')).toBe('Aug 14, 2026');
  });

  it('still renders a full timestamp', () => {
    expect(formatHubSpotUpdatedAt('2026-08-14T10:00:00Z')).toBe('Aug 14, 2026');
  });

  it('formats a timestamp in UTC, so SSR and the browser agree across a midnight boundary', () => {
    // `toContain('2026')` passed in every timezone, so it never covered this: without an explicit
    // `timeZone`, `toLocaleDateString` uses the HOST zone. A timestamp near midnight then renders
    // one day in the Node process and another in the browser, changing the row text and its
    // aria-label during hydration.
    //
    // Asserted against the UTC calendar day computed from the instant itself, NOT against a
    // literal. A literal would only disagree with the host-zone format on a non-UTC runner, and
    // the repo pins no TZ — under a UTC runner (the common CI default) the assertion would hold
    // with or without the fix. Setting `process.env.TZ` here would not help either: Node caches
    // the zone on first `Intl` use, which the tests above have already triggered.
    //
    // These instants straddle UTC midnight in opposite directions, so on ANY host with a non-zero
    // offset at least one of them formats to the wrong day without the pin.
    for (const iso of ['2026-08-14T23:30:00Z', '2026-08-15T00:30:00Z', '2026-08-15T12:00:00Z']) {
      const expected = new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
      expect(formatHubSpotUpdatedAt(iso)).toBe(expected);
    }
  });

  it('refuses impossible dates in the TIMESTAMP form too, not only date-only', () => {
    // The first fix guarded only the date-only branch, so these kept fabricating: JS rolls
    // 2026-02-31T10:00:00Z to Mar 3 exactly as it does the bare date. The spec pinned the
    // branch that was fixed and not the one that was not.
    expect(formatHubSpotUpdatedAt('2026-02-31T10:00:00Z')).toBe('');
    expect(formatHubSpotUpdatedAt('2026-02-30T00:00:00Z')).toBe('');
    expect(formatHubSpotUpdatedAt('0001-01-01T00:00:00Z')).toBe('');
  });

  it('renders nothing for absent or unparseable input', () => {
    expect(formatHubSpotUpdatedAt(undefined)).toBe('');
    expect(formatHubSpotUpdatedAt('not-a-date')).toBe('');
  });
});
