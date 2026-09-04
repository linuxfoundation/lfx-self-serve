// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { daysUntilInTimezone, formatIsoDateLabel, formatVoteDeadline, localDateStamp, normalizeSnowflakeTimestamp, timeAgo } from './date-time.utils';

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
describe('normalizeSnowflakeTimestamp', () => {
  it('converts the zone-less space-separated Snowflake shape to explicit-UTC ISO', () => {
    expect(normalizeSnowflakeTimestamp('2026-08-01 15:30:00')).toBe('2026-08-01T15:30:00Z');
  });

  it('preserves fractional seconds', () => {
    expect(normalizeSnowflakeTimestamp('2026-08-01 15:30:00.123')).toBe('2026-08-01T15:30:00.123Z');
  });

  it('passes through values that already carry T or zone information', () => {
    expect(normalizeSnowflakeTimestamp('2026-08-01T15:30:00Z')).toBe('2026-08-01T15:30:00Z');
    expect(normalizeSnowflakeTimestamp('2026-08-01T15:30:00+05:00')).toBe('2026-08-01T15:30:00+05:00');
    expect(normalizeSnowflakeTimestamp('2026-08-01T15:30:00')).toBe('2026-08-01T15:30:00');
  });

  it('passes through empty and invalid input unchanged', () => {
    expect(normalizeSnowflakeTimestamp('')).toBe('');
    expect(normalizeSnowflakeTimestamp('not-a-date')).toBe('not-a-date');
  });

  // The whole point: new Date() would otherwise parse the zone-less form as browser-local.
  it('makes the converted value parse as UTC', () => {
    expect(new Date(normalizeSnowflakeTimestamp('2026-08-01 15:30:00')).getTime()).toBe(Date.UTC(2026, 7, 1, 15, 30, 0));
  });
});

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

describe('localDateStamp', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('stamps the local calendar date, not the UTC date', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    vi.useFakeTimers();
    // Still Aug 24 in America/Los_Angeles (UTC-7 in August) — this is exactly the case
    // `toISOString().slice(0, 10)` gets wrong, reporting the UTC date (Aug 25) instead.
    vi.setSystemTime(new Date('2026-08-25T02:30:00Z'));

    expect(localDateStamp()).toBe('20260824');
  });

  it('zero-pads single-digit months and days', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T20:00:00Z'));

    expect(localDateStamp()).toBe('20260105');
  });
});

describe('formatVoteDeadline', () => {
  // 2026-11-16T01:00Z is Nov 15, 5:00 PM in Los Angeles (PST, UTC-8) and 8:00 PM in New York (EST, UTC-5).
  const INSTANT = '2026-11-16T01:00:00.000Z';

  it('renders the deadline in the vote timezone', () => {
    expect(formatVoteDeadline(INSTANT, 'America/New_York')).toBe('Nov 15, 2026 8:00 PM EST');
  });

  it('falls back to Pacific for legacy votes with no stored zone', () => {
    expect(formatVoteDeadline(INSTANT, null)).toBe('Nov 15, 2026 5:00 PM PST');
    expect(formatVoteDeadline(INSTANT)).toBe('Nov 15, 2026 5:00 PM PST');
  });

  it('falls back to Pacific for an unparseable zone rather than throwing', () => {
    expect(formatVoteDeadline(INSTANT, 'Not/AZone')).toBe('Nov 15, 2026 5:00 PM PST');
  });

  it('returns an empty string for missing or invalid input', () => {
    expect(formatVoteDeadline(null)).toBe('');
    expect(formatVoteDeadline('not-a-date', 'America/New_York')).toBe('');
  });
});

describe('daysUntilInTimezone', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Noon UTC on Aug 11; the due instant is Aug 11 11:59 PM Pacific but Aug 12 in UTC —
  // the one case where the zone decides whether a vote closes "today" or "tomorrow".
  it('counts day boundaries in the given zone, not the host zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
    const due = '2026-08-12T06:59:00.000Z';

    expect(daysUntilInTimezone(due, 'America/Los_Angeles')).toBe(0);
    expect(daysUntilInTimezone(due, 'UTC')).toBe(1);
  });

  it('falls back to Pacific when no zone is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));

    expect(daysUntilInTimezone('2026-08-12T06:59:00.000Z', null)).toBe(0);
  });
});
