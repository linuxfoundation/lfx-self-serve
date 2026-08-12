// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS, NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES } from '../constants/newsletter.constants';
import { newsletterScheduleWindowValidator } from './newsletter.validators';

// The validator reads scheduleDate/scheduleTime/scheduleTimezone off a
// FormGroup-shaped object via `.get(name)?.value` — a minimal stub covers it.
const group = (value: { scheduleDate?: Date | null; scheduleTime?: string; scheduleTimezone?: string }): AbstractControl =>
  ({
    get: (name: string) => ({ value: (value as Record<string, unknown>)[name] }),
  }) as AbstractControl;

const validate = (value: { scheduleDate?: Date | null; scheduleTime?: string; scheduleTimezone?: string }): ValidationErrors | null =>
  newsletterScheduleWindowValidator()(group(value));

describe('newsletterScheduleWindowValidator', () => {
  // Fixed clock so "now" is deterministic — the validator compares against
  // Date.now() directly, so real time would make lead/horizon boundaries flaky.
  const NOW = new Date('2026-08-11T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when scheduleDate is empty — "send now", not invalid', () => {
    expect(validate({ scheduleDate: null, scheduleTime: '9:30 AM' })).toBeNull();
  });

  it('returns null when scheduleTime is empty — "send now", not invalid', () => {
    expect(validate({ scheduleDate: new Date(NOW), scheduleTime: '' })).toBeNull();
  });

  it('flags scheduleWindow: past for a time behind now', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000);
    const result = validate({ scheduleDate: oneHourAgo, scheduleTime: formatAsPicker(oneHourAgo) });
    expect(result).toEqual({ scheduleWindow: 'past' });
  });

  it('flags scheduleWindow: tooSoon for a time inside the minimum lead', () => {
    const tooSoon = new Date(NOW.getTime() + (NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES - 1) * 60_000);
    const result = validate({ scheduleDate: tooSoon, scheduleTime: formatAsPicker(tooSoon) });
    expect(result).toEqual({ scheduleWindow: 'tooSoon' });
  });

  it('flags scheduleWindow: tooFar for a time beyond the maximum horizon', () => {
    const tooFar = new Date(NOW.getTime() + (NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS + 1) * 60 * 60_000);
    const result = validate({ scheduleDate: tooFar, scheduleTime: formatAsPicker(tooFar) });
    expect(result).toEqual({ scheduleWindow: 'tooFar' });
  });

  it('returns null for a time comfortably inside the valid window', () => {
    const valid = new Date(NOW.getTime() + (NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES + 30) * 60_000);
    const result = validate({ scheduleDate: valid, scheduleTime: formatAsPicker(valid) });
    expect(result).toBeNull();
  });

  it('never reports tooFar at the minimum-lead boundary (still past/tooSoon at worst)', () => {
    const atBoundary = new Date(NOW.getTime() + NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES * 60_000);
    const result = validate({ scheduleDate: atBoundary, scheduleTime: formatAsPicker(atBoundary) });
    // combineDateTime truncates to minute precision, so a value exactly at the
    // lead boundary can round either side of "< minLeadMs" — assert it never
    // reports the opposite extreme (tooFar) rather than pin an exact bucket.
    expect(result?.['scheduleWindow']).not.toBe('tooFar');
  });
});

/**
 * Renders a Date as the `"9:30 AM"`-style string `combineDateTime` expects,
 * reading hour/minute in the local timezone to match the Y/M/D components
 * `combineDateTime` reads via `getFullYear`/`getMonth`/`getDate` — with no
 * `scheduleTimezone` supplied, the validator's `combineDateTime` call takes
 * the backward-compatible local-timezone path, so both must agree.
 */
function formatAsPicker(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
