// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY, GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS } from '../constants/campaign.constants';
import type { NormalizedGoogleAdSchedule } from '../interfaces/campaign.interface';
import {
  googleAdScheduleRefusal,
  googleBidModifierRefusal,
  googleDemographicExclusionRefusal,
  googleDeviceBidModifierRefusal,
  googleExcludedAgeRangeRefusal,
  googleExcludedGenderRefusal,
  googleExcludedGeoClashRefusal,
  googleExcludedGeoRefusal,
  googleUpperCodeList,
} from './campaign-google-criteria.utils';

/**
 * The criteria refusals are the ONE judge both the Implementation tab and the BFF refuse by. The
 * BFF's controller spec drives each of these messages through `createCampaign` and asserts its text,
 * with one exception: "needs a finite bid modifier" cannot arrive in a JSON request body, since JSON
 * has no Infinity or NaN, so the controller spec reaches it only with an in-memory
 * `Number.POSITIVE_INFINITY` and this file pins it directly. These pin the branches the tab relies on
 * directly, so a change here is caught without the controller in the loop.
 */

const adSchedule = (overrides: Partial<NormalizedGoogleAdSchedule> = {}): NormalizedGoogleAdSchedule => ({
  dayOfWeek: 'MONDAY',
  startHour: 9,
  startMinute: 0,
  endHour: 17,
  endMinute: 0,
  ...overrides,
});

describe('googleBidModifierRefusal', () => {
  it('accepts 0, the do-not-serve opt-out, and both ends of the range', () => {
    expect(googleBidModifierRefusal('ad schedule 1', 0)).toBeNull();
    expect(googleBidModifierRefusal('ad schedule 1', 0.1)).toBeNull();
    expect(googleBidModifierRefusal('ad schedule 1', 10)).toBeNull();
  });

  it('refuses a value between 0 and the minimum, above the maximum, or not finite', () => {
    expect(googleBidModifierRefusal('ad schedule 1', 0.05)).toContain('bid modifier of 0.05');
    expect(googleBidModifierRefusal('ad schedule 1', 10.5)).toContain('Google accepts 0 (do not serve) or 0.1 to 10');
    expect(googleBidModifierRefusal('ad schedule 1', Number.NaN)).toContain('needs a finite bid modifier');
  });
});

describe('googleAdScheduleRefusal', () => {
  it('accepts a day split at noon, because touching windows do not overlap', () => {
    expect(googleAdScheduleRefusal([adSchedule({ endHour: 12 }), adSchedule({ startHour: 12 })])).toBeNull();
  });

  it('accepts a whole day ending at hour 24', () => {
    expect(googleAdScheduleRefusal([adSchedule({ startHour: 0, endHour: 24 })])).toBeNull();
  });

  it.each([
    ['an unknown day', adSchedule({ dayOfWeek: 'FUNDAY' }), 'needs a day of week'],
    ['an end at or before the start', adSchedule({ endHour: 9 }), 'is not after its start of 09:00'],
    ['an end past midnight', adSchedule({ endHour: 24, endMinute: 15 }), 'past the end of the day'],
    ['a minute Google cannot represent', adSchedule({ startMinute: 10 }), 'start minute of 10'],
    ['a bid modifier out of range', adSchedule({ bidModifier: 20 }), 'bid modifier of 20'],
  ])('refuses %s', (_label, schedule, message) => {
    expect(googleAdScheduleRefusal([schedule])).toContain(message);
  });

  it('names an overlap with the window it clashes with', () => {
    expect(googleAdScheduleRefusal([adSchedule(), adSchedule({ startHour: 16, endHour: 18 })])).toBe(
      'The Google Ads ad schedule 2 (MONDAY 16:00-18:00) overlaps MONDAY 09:00-17:00. Google rejects overlapping ad schedules on the same day, so merge them and create again.'
    );
  });

  it('collapses an exact repeat and refuses one with a different bid modifier', () => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0.8 }), adSchedule({ bidModifier: 0.8 })])).toBeNull();
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0.8 }), adSchedule({ bidModifier: 0.5 })])).toContain('with a different bid modifier');
  });

  it('refuses one interval past the per-day limit', () => {
    const hourly = Array.from({ length: GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY + 1 }, (_, h) => adSchedule({ startHour: h, endHour: h + 1 }));
    expect(googleAdScheduleRefusal(hourly.slice(0, -1))).toBeNull();
    expect(googleAdScheduleRefusal(hourly)).toContain(`accepts at most ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} per day`);
  });
});

describe('googleDeviceBidModifierRefusal', () => {
  it('accepts an exclusion and an adjustment on different devices', () => {
    expect(
      googleDeviceBidModifierRefusal([
        { device: 'TABLET', bidModifier: 0 },
        { device: 'mobile ', bidModifier: 1.2 },
      ])
    ).toBeNull();
  });

  it('refuses an unknown device, a repeated device and an out-of-range modifier', () => {
    expect(googleDeviceBidModifierRefusal([{ device: 'TV', bidModifier: 1 }])).toContain('which is not one of MOBILE, DESKTOP, TABLET');
    expect(
      googleDeviceBidModifierRefusal([
        { device: 'MOBILE', bidModifier: 1 },
        { device: 'MOBILE', bidModifier: 2 },
      ])
    ).toContain('name MOBILE more than once');
    expect(googleDeviceBidModifierRefusal([{ device: 'DESKTOP', bidModifier: 0.05 }])).toContain('device bid modifier 1 has a bid modifier of 0.05');
  });
});

describe('googleDemographicExclusionRefusal', () => {
  const ageRanges = (raw: unknown, channel: unknown = 'search'): string | null =>
    googleDemographicExclusionRefusal(raw, 'excluded age ranges', 'age range names', channel, googleExcludedAgeRangeRefusal);

  it('accepts both spellings of an age range, and nothing at all', () => {
    expect(ageRanges(['18-24', 'age_range_65_up'])).toBeNull();
    expect(ageRanges(undefined)).toBeNull();
  });

  it('refuses a non-list, the fenced channel, the cap and an unknown entry', () => {
    expect(ageRanges('18-24')).toBe('Google Ads excluded age ranges must be a list of age range names.');
    expect(ageRanges(['18-24'], 'performance-max')).toContain('on Performance Max campaigns');
    expect(ageRanges(Array.from({ length: GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS + 1 }, () => '18-24'))).toContain('and this one has 21');
    expect(ageRanges(['17-23'])).toContain('cannot exclude the age range 17-23');
  });

  it('judges genders against their own vocabulary', () => {
    expect(googleExcludedGenderRefusal('UNDETERMINED')).toBeNull();
    expect(googleExcludedGenderRefusal('OTHER')).toContain('cannot exclude the gender OTHER');
  });
});

describe('excluded locations', () => {
  it('normalizes codes the way upstream does, keeping blanks', () => {
    expect(googleUpperCodeList([' us\u0085', '', 7])).toEqual(['US', '']);
  });

  it('accepts a supported country and a canonical geo target id, and refuses the rest', () => {
    expect(googleExcludedGeoRefusal('US')).toBeNull();
    expect(googleExcludedGeoRefusal('1023191')).toBeNull();
    expect(googleExcludedGeoRefusal('')).toContain('cannot include a blank entry');
    expect(googleExcludedGeoRefusal('01023191')).toContain('is not the canonical spelling');
    expect(googleExcludedGeoRefusal('ZZ')).toContain('cannot exclude ZZ on this path');
  });

  it('refuses a location both targeted and excluded, however each half is spelled', () => {
    expect(googleExcludedGeoClashRefusal(['US'], ['2840'])).toContain('cannot both target and exclude US');
    expect(googleExcludedGeoClashRefusal(['GB'], ['US'])).toBeNull();
  });
});
