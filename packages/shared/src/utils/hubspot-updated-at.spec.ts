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
    expect(formatHubSpotUpdatedAt('2026-08-14T10:00:00Z')).toContain('2026');
  });

  it('renders nothing for absent or unparseable input', () => {
    expect(formatHubSpotUpdatedAt(undefined)).toBe('');
    expect(formatHubSpotUpdatedAt('not-a-date')).toBe('');
  });
});
