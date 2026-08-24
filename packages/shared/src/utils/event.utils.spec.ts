// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isBackfillEventSource } from './event.utils';

describe('isBackfillEventSource', () => {
  it('matches the canonical value', () => {
    expect(isBackfillEventSource('backfill')).toBe(true);
  });

  it.each([['Backfill'], ['BACKFILL'], ['BackFill']])('is case-insensitive for %s', (source) => {
    expect(isBackfillEventSource(source)).toBe(true);
  });

  it.each([[' backfill'], ['backfill '], ['  Backfill  '], ['\tbackfill\n'], ['\r\nbackfill\t ']])('strips the SQL-aligned whitespace set in %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(true);
  });

  // Deliberate parity boundary: String.prototype.trim() strips these, but Snowflake's
  // TRIM(EVENT_SOURCE, ' \t\n\r') cannot, and Snowflake has no ECMAScript-whitespace equivalent.
  // Both sides must agree, so this side is narrowed to match — such a value reads as non-backfill
  // in JS and SQL alike, and the row falls back to the stored IS_PAST_EVENT.
  it.each([['\u000Bbackfill'], ['\u000Cbackfill'], ['\u00A0backfill'], ['\uFEFFbackfill'], ['\u2028backfill'], ['\u3000backfill'], ['backfill\u00A0']])(
    'rejects %j — whitespace that trim() strips but Snowflake TRIM cannot',
    (source) => {
      expect(isBackfillEventSource(source)).toBe(false);
      // Guards the premise above: plain trim() would have matched, which is the divergence avoided.
      expect(source.trim().toLowerCase()).toBe('backfill');
    }
  );

  it.each([['cvent'], ['bevy'], ['platform'], ['backfilled'], ['back fill'], ['']])('rejects %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });

  it.each([[null], [undefined]])('rejects %p without throwing', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });
});
