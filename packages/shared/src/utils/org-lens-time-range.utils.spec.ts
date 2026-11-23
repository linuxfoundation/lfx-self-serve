// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_OPTIONS } from '../constants/org-lens-time-range.constants';
import {
  isOrgLensTimeRange,
  normalizeLegacyOrgLensTimeRange,
  orgLensTimeRangeDays,
  orgLensTimeRangeUrlParam,
  parseOrgLensTimeRange,
} from './org-lens-time-range.utils';

describe('Org Lens time range', () => {
  it('offers Insights-style labels narrowest first, defaulting to Past 2 years as on Insights', () => {
    expect(ORG_LENS_TIME_RANGE_OPTIONS).toEqual([
      { label: 'Past 30 days', value: '30d' },
      { label: 'Past 90 days', value: '90d' },
      { label: 'Past 365 days', value: '365d' },
      { label: 'Past 2 years', value: '730d' },
      { label: 'All time', value: 'all' },
    ]);
    expect(ORG_LENS_DEFAULT_TIME_RANGE).toBe('730d');
  });

  it.each(['30d', '90d', '365d', '730d', 'all'])('parses %s', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe(value);
    expect(isOrgLensTimeRange(value)).toBe(true);
  });

  // Old `12m`/`2y` links from the old Trainees/Events pickers, and anything unknown, fall back to the Past 2 years default.
  it.each([null, undefined, '', '12m', '2y', '3m', 'ALL', '12MO'])('reads %s as the default', (value) => {
    expect(parseOrgLensTimeRange(value)).toBe('730d');
  });

  // An old `12mo` link (the previous Code page and All Employees default) keeps its 12-month window, as the BFF reads it.
  it('reads the legacy 12mo link as Past 365 days, like the BFF', () => {
    expect(parseOrgLensTimeRange('12mo')).toBe('365d');
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
    expect(orgLensTimeRangeUrlParam('730d')).toBeNull();
    expect(orgLensTimeRangeUrlParam('30d')).toBe('30d');
    expect(orgLensTimeRangeUrlParam('365d')).toBe('365d');
    expect(orgLensTimeRangeUrlParam('all')).toBe('all');
  });
});
