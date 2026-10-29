// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_OPTIONS } from '../constants/org-lens-time-range.constants';
import {
  isOrgLensTimeRange,
  normalizeLegacyOrgLensTimeRange,
  orgLensTimeRangeDays,
  orgLensTimeRangeStartDate,
  orgLensTimeRangeUrlParam,
  orgLensUtcToday,
  parseOrgLensTimeRange,
} from './org-lens-time-range.utils';

describe('Org Lens time range', () => {
  it('offers Insights-style labels narrowest first, defaulting to Past 365 days', () => {
    expect(ORG_LENS_TIME_RANGE_OPTIONS).toEqual([
      { label: 'Past 30 days', value: '30d' },
      { label: 'Past 90 days', value: '90d' },
      { label: 'Past 365 days', value: '365d' },
      { label: 'Past 2 years', value: '730d' },
      { label: 'All time', value: 'all' },
    ]);
    expect(ORG_LENS_DEFAULT_TIME_RANGE).toBe('365d');
  });

  it.each(['30d', '90d', '365d', '730d', 'all'])('parses %s', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe(value);
    expect(isOrgLensTimeRange(value)).toBe(true);
  });

  // Old links (`12mo` from the previous Code page and All Employees, `12m`/`2y` from the old Trainees/Events pickers) fall
  // back to the new Past 365 days default.
  it.each([null, undefined, '', '12mo', '12m', '2y', '3m', 'ALL'])('reads %s as the default', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe('365d');
  });

  it('reads the legacy 12mo BFF value as 365d and leaves every other value for validation', () => {
    expect(normalizeLegacyOrgLensTimeRange('12mo')).toBe('365d');
    for (const value of ['30d', '90d', '365d', '730d', 'all', '12m', '2y', '12MO', '']) {
      expect(normalizeLegacyOrgLensTimeRange(value)).toBe(value);
    }
  });

  it('gives the window length of each bounded range and throws for anything else', () => {
    expect(orgLensTimeRangeDays('30d')).toBe(30);
    expect(orgLensTimeRangeDays('90d')).toBe(90);
    expect(orgLensTimeRangeDays('365d')).toBe(365);
    expect(orgLensTimeRangeDays('730d')).toBe(730);
    for (const value of ['all', '12mo', 'toString', '__proto__']) {
      expect(() => orgLensTimeRangeDays(value as '30d')).toThrow(`Unknown bounded Org Lens time range: ${value}`);
    }
  });

  it('drops the default from the URL and keeps every other range', () => {
    expect(orgLensTimeRangeUrlParam('365d')).toBeNull();
    expect(orgLensTimeRangeUrlParam('30d')).toBe('30d');
    expect(orgLensTimeRangeUrlParam('730d')).toBe('730d');
    expect(orgLensTimeRangeUrlParam('all')).toBe('all');
  });

  it('starts a bounded range N days before today in UTC, matching DATEADD(day, -N, CURRENT_DATE())', () => {
    const now = new Date('2028-03-15T23:30:00.000Z');

    expect(orgLensTimeRangeStartDate('30d', now)).toBe('2028-02-14');
    expect(orgLensTimeRangeStartDate('90d', now)).toBe('2027-12-16');
    // 365 days, not twelve months: across a leap day it starts the day after the same date last year.
    expect(orgLensTimeRangeStartDate('365d', now)).toBe('2027-03-16');
    // 730 days back across the 2028 leap day lands one day after the same date two years earlier.
    expect(orgLensTimeRangeStartDate('730d', now)).toBe('2026-03-16');
    expect(orgLensTimeRangeStartDate('all', now)).toBeNull();
    expect(orgLensUtcToday(now)).toBe('2028-03-15');
  });
});
