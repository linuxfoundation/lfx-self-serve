// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatIsoDateLabel, timeAgo } from './date-time.utils';

/**
 * The fallback contract is the whole point of this helper: anything that is not a real
 * `YYYY-MM-DD` date comes back untouched, so bad warehouse data reads as obviously broken rather
 * than as a plausible wrong date. Each case below is a way `Date.UTC` will happily invent one.
 */
describe('formatIsoDateLabel', () => {
  it('formats a real date', () => {
    expect(formatIsoDateLabel('2026-07-14')).toBe('Jul 14, 2026');
    expect(formatIsoDateLabel('2026-12-31')).toBe('Dec 31, 2026');
  });

  // Date.UTC rolls out-of-range parts over: month 13 lands in the next January.
  it('returns the input for out-of-range parts', () => {
    expect(formatIsoDateLabel('2026-13-45')).toBe('2026-13-45');
    expect(formatIsoDateLabel('2026-00-10')).toBe('2026-00-10');
  });

  // In range but not a real date — Feb 31 becomes March 3rd, which only a round-trip catches.
  it('returns the input for a date that does not exist', () => {
    expect(formatIsoDateLabel('2026-02-31')).toBe('2026-02-31');
  });

  // Date.UTC remaps years 0–99 into the 1900s, so 0001-01-01 would render as "Jan 1, 1901".
  it('returns the input for a two-digit-mapped year', () => {
    expect(formatIsoDateLabel('0001-01-01')).toBe('0001-01-01');
    expect(formatIsoDateLabel('0099-05-05')).toBe('0099-05-05');
  });

  // Splitting on '-' alone ignores trailing junk, so the shape has to be checked first.
  it('returns the input when the string is not exactly YYYY-MM-DD', () => {
    expect(formatIsoDateLabel('2026-07-14-extra')).toBe('2026-07-14-extra');
    expect(formatIsoDateLabel('2026-7-4')).toBe('2026-7-4');
    expect(formatIsoDateLabel('not-a-date')).toBe('not-a-date');
    expect(formatIsoDateLabel('')).toBe('');
  });

  // Parts are parsed explicitly rather than via new Date(iso), which renders UTC midnight in local
  // time — a day early for anyone west of Greenwich.
  it('does not drift across time zones', () => {
    expect(formatIsoDateLabel('2026-01-01')).toBe('Jan 1, 2026');
  });
});

/**
 * The unit thresholds use approximate month (30d) and year (365d) divisors, so the branch
 * boundaries are where they disagree — a 360-day gap is 12 "months" but 0 years.
 */
describe('timeAgo', () => {
  const NOW = Date.UTC(2026, 0, 1);
  const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

  afterEach(() => vi.useRealTimers());

  const freeze = (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  it('reports months, not "0 years", just under a year', () => {
    freeze();
    expect(timeAgo(daysAgo(360))).toBe('12 months ago');
    expect(timeAgo(daysAgo(364))).toBe('12 months ago');
  });

  it('switches to years at 365 days', () => {
    freeze();
    expect(timeAgo(daysAgo(365))).toBe('1 year ago');
    expect(timeAgo(daysAgo(800))).toBe('2 years ago');
  });

  it('covers the smaller units', () => {
    freeze();
    expect(timeAgo(new Date(NOW - 30_000).toISOString())).toBe('Just now');
    expect(timeAgo(new Date(NOW - 5 * 60_000).toISOString())).toBe('5 minutes ago');
    expect(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString())).toBe('3 hours ago');
    expect(timeAgo(daysAgo(1))).toBe('1 day ago');
    expect(timeAgo(daysAgo(14))).toBe('2 weeks ago');
    expect(timeAgo(daysAgo(60))).toBe('2 months ago');
  });

  it('returns an empty string for missing or unparseable input', () => {
    expect(timeAgo('')).toBe('');
    expect(timeAgo('not-a-date')).toBe('');
  });
});
