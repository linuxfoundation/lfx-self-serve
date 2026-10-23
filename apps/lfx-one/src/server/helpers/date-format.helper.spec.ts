// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isoDateReplacer, toIsoDate, toIsoTimestamp } from './date-format.helper';

/** Mimics a `snowflake-sdk` timestamp: a real Date whose `toJSON()` emits the session output format. */
function snowflakeDate(iso: string, formatted: string): Date {
  const date = new Date(iso);
  date.toJSON = () => formatted;
  return date;
}

describe('toIsoTimestamp', () => {
  it.each([
    ['native Date', new Date('2026-10-21T23:12:33.000Z'), '2026-10-21T23:12:33.000Z'],
    ['strict ISO', '2026-10-21T23:12:33.000Z', '2026-10-21T23:12:33.000Z'],
    ['Snowflake NTZ (no zone → UTC)', '2026-10-21 23:12:33.000', '2026-10-21T23:12:33.000Z'],
    ['Snowflake LTZ/TZ, space + ±HHMM (cache-hit shape)', '2026-10-21 16:12:33.000 -0700', '2026-10-21T23:12:33.000Z'],
    ['Snowflake +0000', '2026-10-21 23:12:33.000 +0000', '2026-10-21T23:12:33.000Z'],
    ['offset with colon', '2026-10-21T16:12:33-07:00', '2026-10-21T23:12:33.000Z'],
    ['nanosecond precision', '2026-10-21 23:12:33.123456789', '2026-10-21T23:12:33.123Z'],
    ['no seconds', '2026-10-21 23:12', '2026-10-21T23:12:00.000Z'],
  ])('parses %s', (_label, input, expected) => {
    expect(toIsoTimestamp(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'not a date', new Date('invalid')])('returns null for %s', (input) => {
    expect(toIsoTimestamp(input as Date | string | null | undefined)).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('keeps the calendar date of a Snowflake string', () => {
    expect(toIsoDate('2026-10-21 23:12:33.000 -0700')).toBe('2026-10-21');
  });
});

describe('cache round-trip (regression: blank Org Lens dates on cache hit)', () => {
  const row = {
    FIRST_COMMIT_TS: snowflakeDate('2024-03-01T12:00:00.000Z', '2024-03-01 04:00:00.000 -0800'),
    LAST_COMMIT_TS: snowflakeDate('2026-10-21T23:12:33.000Z', '2026-10-21 16:12:33.000 -0700'),
    NULL_TS: null,
  };

  it('isoDateReplacer stores Snowflake Dates as strict ISO', () => {
    const stored = JSON.parse(JSON.stringify({ rows: [row] }, isoDateReplacer)) as { rows: Record<string, unknown>[] };
    expect(stored.rows[0]['FIRST_COMMIT_TS']).toBe('2024-03-01T12:00:00.000Z');
    expect(stored.rows[0]['LAST_COMMIT_TS']).toBe('2026-10-21T23:12:33.000Z');
    expect(stored.rows[0]['NULL_TS']).toBeNull();
  });

  it('isoDateReplacer keeps Snowflake DATE columns date-only so cache hits match misses', () => {
    const dateRow = { ENROLLMENT_DATE: snowflakeDate('2026-01-02T00:00:00.000Z', '2026-01-02') };
    const stored = JSON.parse(JSON.stringify({ rows: [dateRow] }, isoDateReplacer)) as { rows: Record<string, unknown>[] };
    expect(stored.rows[0]['ENROLLMENT_DATE']).toBe('2026-01-02');
  });

  it('a value cached before the fix (Snowflake format) still parses', () => {
    const legacy = JSON.parse(JSON.stringify(row)) as Record<string, string>;
    expect(legacy['LAST_COMMIT_TS']).toBe('2026-10-21 16:12:33.000 -0700');
    expect(toIsoTimestamp(legacy['LAST_COMMIT_TS'])).toBe('2026-10-21T23:12:33.000Z');
  });
});
