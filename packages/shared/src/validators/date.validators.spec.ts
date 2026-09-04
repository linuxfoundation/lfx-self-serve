// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { voteDeadlineValidator } from './date.validators';

// The validator reads close_date/close_time/timezone off a FormGroup-shaped object via
// `.get(name)?.value` — a minimal stub covers it (same pattern as newsletter.validators.spec.ts).
const group = (value: { close_date?: Date | null; close_time?: string; timezone?: string }): AbstractControl =>
  ({
    get: (name: string) => ({ value: (value as Record<string, unknown>)[name] }),
  }) as AbstractControl;

const validate = (value: { close_date?: Date | null; close_time?: string; timezone?: string }): ValidationErrors | null =>
  voteDeadlineValidator()(group(value));

describe('voteDeadlineValidator', () => {
  // Fixed clock so "now" is deterministic — the validator compares against the current instant.
  const NOW = new Date('2026-08-11T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // close_date uses the local constructor: combineDateTime reads local wall-clock fields,
  // so an ISO-string date would shift the result with the test machine's TZ.
  it('rejects a deadline earlier today in the chosen timezone', () => {
    expect(validate({ close_date: new Date(2026, 7, 11), close_time: '12:00 AM', timezone: 'UTC' })).toEqual({ futureDateTime: true });
  });

  it('accepts a later same-day deadline', () => {
    expect(validate({ close_date: new Date(2026, 7, 11), close_time: '11:59 PM', timezone: 'UTC' })).toBeNull();
  });

  it('accepts a future date', () => {
    expect(validate({ close_date: new Date(2026, 7, 20), close_time: '5:00 PM', timezone: 'America/New_York' })).toBeNull();
  });

  it('skips validation when any of the three controls is unset', () => {
    expect(validate({ close_date: null, close_time: '11:59 PM', timezone: 'UTC' })).toBeNull();
    expect(validate({ close_date: new Date(2026, 7, 11), close_time: '', timezone: 'UTC' })).toBeNull();
    expect(validate({ close_date: new Date(2026, 7, 11), close_time: '11:59 PM', timezone: '' })).toBeNull();
  });

  it('skips validation for an unparseable time string', () => {
    expect(validate({ close_date: new Date(2026, 7, 11), close_time: '25:99 XM', timezone: 'UTC' })).toBeNull();
  });
});
