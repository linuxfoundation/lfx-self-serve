// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_OPTIONS } from '../constants/org-lens-time-range.constants';
import { isOrgLensTimeRange, orgLensTimeRangeStartDate, orgLensTimeRangeUrlParam, orgLensUtcToday, parseOrgLensTimeRange } from './org-lens-time-range.utils';

describe('Org Lens time range', () => {
  it('offers Insights-style labels narrowest first, defaulting to Past 365 days', () => {
    expect(ORG_LENS_TIME_RANGE_OPTIONS).toEqual([
      { label: 'Past 30 days', value: '30d' },
      { label: 'Past 90 days', value: '90d' },
      { label: 'Past 365 days', value: '365d' },
      { label: 'All time', value: 'all' },
    ]);
    expect(ORG_LENS_DEFAULT_TIME_RANGE).toBe('365d');
  });

  it.each(['30d', '90d', '365d', 'all'])('parses %s', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe(value);
    expect(isOrgLensTimeRange(value)).toBe(true);
  });

  // Old links (`12mo` from the previous Code page and All Employees, `12m`/`2y` from the old Trainees/Events pickers) land
  // on the default, which is the same window as the old 12-month default.
  it.each([null, undefined, '', '12mo', '12m', '2y', '3m', 'ALL'])('reads %s as the default', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe('365d');
  });

  it('drops the default from the URL and keeps every other range', () => {
    expect(orgLensTimeRangeUrlParam('365d')).toBeNull();
    expect(orgLensTimeRangeUrlParam('30d')).toBe('30d');
    expect(orgLensTimeRangeUrlParam('all')).toBe('all');
  });

  it('starts a bounded range N days before today in UTC, matching DATEADD(day, -N, CURRENT_DATE())', () => {
    const now = new Date('2028-03-15T23:30:00.000Z');

    expect(orgLensTimeRangeStartDate('30d', now)).toBe('2028-02-14');
    expect(orgLensTimeRangeStartDate('90d', now)).toBe('2027-12-16');
    // 365 days, not twelve months: across a leap day it starts the day after the same date last year.
    expect(orgLensTimeRangeStartDate('365d', now)).toBe('2027-03-16');
    expect(orgLensTimeRangeStartDate('all', now)).toBeNull();
    expect(orgLensUtcToday(now)).toBe('2028-03-15');
  });
});
