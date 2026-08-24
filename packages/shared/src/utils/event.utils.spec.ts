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

  it.each([[' backfill'], ['backfill '], ['  Backfill  '], ['\tbackfill\n']])('tolerates surrounding whitespace in %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(true);
  });

  it.each([['cvent'], ['bevy'], ['platform'], ['backfilled'], ['back fill'], ['']])('rejects %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });

  it.each([[null], [undefined]])('rejects %p without throwing', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });
});
