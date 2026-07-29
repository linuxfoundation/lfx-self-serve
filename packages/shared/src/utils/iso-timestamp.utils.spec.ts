// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { firstValidTimestamp, firstValidTimestampMs } from './iso-timestamp.utils';

describe('firstValidTimestamp', () => {
  it('returns the first candidate that is present and parseable', () => {
    expect(firstValidTimestamp('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z');
  });

  it('falls back past an absent candidate', () => {
    expect(firstValidTimestamp(undefined, '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('falls back past a Go zero-date sentinel', () => {
    expect(firstValidTimestamp('0001-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('falls back past an unparseable candidate', () => {
    expect(firstValidTimestamp('not-a-date', '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('returns an empty string when every candidate is invalid or absent', () => {
    expect(firstValidTimestamp(undefined, '0001-01-01T00:00:00Z', 'not-a-date')).toBe('');
  });
});

describe('firstValidTimestampMs', () => {
  it('returns epoch ms for the first candidate that is present and parseable', () => {
    expect(firstValidTimestampMs('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('falls back past a Go zero-date sentinel', () => {
    expect(firstValidTimestampMs('0001-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('returns null when every candidate is invalid or absent', () => {
    expect(firstValidTimestampMs(undefined, '0001-01-01T00:00:00Z', 'not-a-date')).toBeNull();
  });
});
