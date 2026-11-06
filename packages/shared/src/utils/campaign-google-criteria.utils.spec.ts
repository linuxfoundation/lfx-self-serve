// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS,
  GOOGLE_BIDDING_STRATEGY_LABELS,
} from '../constants/campaign.constants';
import type { NormalizedGoogleAdSchedule } from '../interfaces/campaign.interface';
import {
  googleAdsDevicesOn,
  googleAdScheduleBidModifierRefusal,
  googleAdScheduleRefusal,
  googleBidModifierRefusal,
  googleChannelOffersManualCpc,
  googleBidAdjustmentRangeText,
  googleChannelRefusesScheduleAdjustments,
  googleChannelTakesDeviceExclusionsOnly,
  googleDemographicExclusionRefusal,
  googleDeviceAdjustmentNotSentSentence,
  googleDeviceBidModifierRefusal,
  googleEffectiveBiddingStrategy,
  googleExcludedAgeRangeRefusal,
  googleExcludedAgeRangesRefusal,
  googleExcludedGenderRefusal,
  googleExcludedGendersRefusal,
  googleExcludedGeoClashRefusal,
  googleExcludedGeoListRefusal,
  googleExcludedGeoRefusal,
  googleScheduleAdjustmentStrategiesOn,
  googleStrategyTakesScheduleAdjustments,
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
  it('accepts 0, the device exclusion, and both ends of the range', () => {
    expect(googleBidModifierRefusal('device bid modifier 1', 0)).toBeNull();
    expect(googleBidModifierRefusal('device bid modifier 1', 0.1)).toBeNull();
    expect(googleBidModifierRefusal('device bid modifier 1', 10)).toBeNull();
  });

  it('refuses a value between 0 and the minimum, above the maximum, or not finite', () => {
    expect(googleBidModifierRefusal('device bid modifier 1', 0.05)).toContain('bid modifier of 0.05');
    expect(googleBidModifierRefusal('device bid modifier 1', 10.5)).toContain('Google accepts 0 (do not serve) or 0.1 to 10');
    expect(googleBidModifierRefusal('device bid modifier 1', Number.NaN)).toContain('needs a finite bid modifier');
  });
});

// Google's CampaignCriterion contract: 0.1-10.0 on an ad schedule, 0 only as a device exclusion (#5088 review).
describe('googleAdScheduleBidModifierRefusal', () => {
  it('accepts both ends of the range, -90% and +900%', () => {
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', 0.1)).toBeNull();
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', 10)).toBeNull();
  });

  it('refuses 0, the -100% a device takes, and says how to stop serving at that time', () => {
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', 0)).toBe(
      'The Google Ads ad schedule 1 has a bid modifier of 0. Google accepts 0.1 to 10 on an ad schedule (-90% to +900%). A bid modifier of 0 excludes a device, not an ad schedule. To stop serving at that time, remove this window and keep at least one other: with windows, the campaign serves only in them; with none, it serves around the clock. Fix it and create again.'
    );
  });

  it('refuses a value between 0 and the minimum, above the maximum, or not finite, without the device-only 0 advice', () => {
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', 0.05)).toBe(
      'The Google Ads ad schedule 1 has a bid modifier of 0.05. Google accepts 0.1 to 10 on an ad schedule (-90% to +900%). Fix it and create again.'
    );
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', 10.5)).not.toContain('0 (do not serve)');
    expect(googleAdScheduleBidModifierRefusal('ad schedule 1', Number.NaN)).toContain('needs a finite bid modifier');
  });
});

describe('googleAdScheduleRefusal', () => {
  it('accepts a day split at noon, because touching windows do not overlap', () => {
    expect(googleAdScheduleRefusal([adSchedule({ endHour: 12 }), adSchedule({ startHour: 12 })], 'manual-cpc', 'search')).toBeNull();
  });

  it('accepts a whole day ending at hour 24', () => {
    expect(googleAdScheduleRefusal([adSchedule({ startHour: 0, endHour: 24 })], 'manual-cpc', 'search')).toBeNull();
  });

  it('refuses a -100% window (bid modifier 0) and accepts -90% (0.1), its lowest adjustment', () => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0 })], 'manual-cpc', 'search')).toContain(
      'ad schedule 1 has a bid modifier of 0. Google accepts 0.1 to 10 on an ad schedule'
    );
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0.1 })], 'manual-cpc', 'search')).toBeNull();
  });

  it.each([
    ['an unknown day', adSchedule({ dayOfWeek: 'FUNDAY' }), 'needs a day of week'],
    ['an end at or before the start', adSchedule({ endHour: 9 }), 'is not after its start of 09:00'],
    ['an end past midnight', adSchedule({ endHour: 24, endMinute: 15 }), 'past the end of the day'],
    ['a minute Google cannot represent', adSchedule({ startMinute: 10 }), 'start minute of 10'],
    ['a bid modifier out of range', adSchedule({ bidModifier: 20 }), 'bid modifier of 20'],
  ])('refuses %s', (_label, schedule, message) => {
    expect(googleAdScheduleRefusal([schedule], 'manual-cpc', 'search')).toContain(message);
  });

  it('names an overlap with the window it clashes with', () => {
    expect(googleAdScheduleRefusal([adSchedule(), adSchedule({ startHour: 16, endHour: 18 })], 'manual-cpc', 'search')).toBe(
      'The Google Ads ad schedule 2 (MONDAY 16:00-18:00) overlaps MONDAY 09:00-17:00. Google rejects overlapping ad schedules on the same day, so merge them and create again.'
    );
  });

  it('collapses an exact repeat and refuses one with a different bid modifier', () => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0.8 }), adSchedule({ bidModifier: 0.8 })], 'manual-cpc', 'search')).toBeNull();
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 0.8 }), adSchedule({ bidModifier: 0.5 })], 'manual-cpc', 'search')).toContain(
      'with a different bid modifier'
    );
  });

  it('refuses one interval past the per-day limit', () => {
    const hourly = Array.from({ length: GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY + 1 }, (_, h) => adSchedule({ startHour: h, endHour: h + 1 }));
    expect(googleAdScheduleRefusal(hourly.slice(0, -1), 'manual-cpc', 'search')).toBeNull();
    expect(googleAdScheduleRefusal(hourly, 'manual-cpc', 'search')).toContain(`accepts at most ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} per day`);
  });

  // Google stores an ad-schedule bid adjustment under Smart Bidding and ignores it; campaign-service
  // forwards it, so LFX One refuses it here (#5088 review). Windows with no adjustment pass everywhere.
  it.each(['manual-cpc', 'maximize-clicks'])('accepts an adjusted window under %s, where Google applies it', (strategy) => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 1.5 })], strategy, 'search')).toBeNull();
  });

  it.each(['maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'])(
    'refuses any adjusted window under %s on Search, 1 (0%%) included, offering both strategies that apply it',
    (strategy) => {
      const label = GOOGLE_BIDDING_STRATEGY_LABELS[strategy as keyof typeof GOOGLE_BIDDING_STRATEGY_LABELS];
      for (const bidModifier of [1.5, 1]) {
        expect(googleAdScheduleRefusal([adSchedule(), adSchedule({ dayOfWeek: 'TUESDAY', bidModifier })], strategy, 'search')).toBe(
          `The Google Ads ad schedule 2 has a bid modifier of ${bidModifier}. Google Ads applies an ad schedule bid adjustment only under Manual CPC or Maximize Clicks. Under ${label} it would ignore it, so LFX One doesn't send one. Clear its bid adjustment, or bid with Manual CPC or Maximize Clicks, then create again.`
        );
      }
      expect(googleAdScheduleRefusal([adSchedule(), adSchedule({ dayOfWeek: 'TUESDAY' })], strategy, 'search')).toBeNull();
    }
  );

  it.each([
    ['display', 'Clear its bid adjustment, or bid with Maximize Clicks, then create again.'],
    ['performance-max', 'Clear its bid adjustment, then create again.'],
    ['video', 'Clear its bid adjustment, then create again.'],
  ] as const)('on %s offers only the strategies it can bid', (channel, fix) => {
    const refusal = googleAdScheduleRefusal([adSchedule({ bidModifier: 0.8 })], 'maximize-conversions', channel) ?? '';
    expect(refusal.endsWith(` ${fix}`)).toBe(true);
  });

  it('judges every entry before the strategy, so a window Google refuses is named first', () => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 1.5 }), adSchedule({ dayOfWeek: 'TUESDAY', bidModifier: 0 })], 'target-cpa', 'search')).toContain(
      'ad schedule 2 has a bid modifier of 0. Google accepts 0.1 to 10'
    );
  });

  it('names an unknown strategy as written, since Google applies no adjustment it does not know', () => {
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 1.5 })], 'retired-strategy', 'search')).toContain('Under retired-strategy it would ignore it');
  });
});

/**
 * `validateCriteriaPlan`'s Demand Gen arm (campaign-service v1.0.31): a schedule is taken only
 * without a bid modifier, under every strategy, and the arm runs before `validateAdSchedules`.
 */
describe('googleAdScheduleRefusal on Demand Gen', () => {
  it('accepts a window with no bid modifier', () => {
    expect(googleAdScheduleRefusal([adSchedule()], 'maximize-clicks', 'demand-gen')).toBeNull();
  });

  it('refuses any bid modifier, even under Maximize Clicks, which takes one elsewhere', () => {
    const refusal = googleAdScheduleRefusal([adSchedule(), adSchedule({ dayOfWeek: 'TUESDAY', bidModifier: 1.2 })], 'maximize-clicks', 'demand-gen');
    expect(refusal).toBe(
      "The Google Ads ad schedule 2 has a bid modifier of 1.2. Demand Gen campaigns take an ad schedule only without a bid adjustment, so LFX One doesn't send one. Clear its bid adjustment, then create again."
    );
    expect(googleAdScheduleRefusal([adSchedule({ bidModifier: 1.2 })], 'maximize-clicks', 'display')).toBeNull();
  });

  it('names the channel rule before any per-entry refusal, as upstream orders them', () => {
    expect(googleAdScheduleRefusal([adSchedule({ dayOfWeek: 'FUNDAY' }), adSchedule({ bidModifier: 0 })], 'maximize-clicks', 'demand-gen')).toContain(
      'ad schedule 2 has a bid modifier of 0. Demand Gen campaigns'
    );
  });
});

describe('googleBidAdjustmentRangeText', () => {
  it("prints Google's range from the modifier bounds", () => {
    expect(googleBidAdjustmentRangeText()).toBe('-90% to +900%');
  });
});

describe('googleScheduleAdjustmentStrategiesOn / googleStrategyTakesScheduleAdjustments', () => {
  it('lists the strategies that apply a schedule adjustment, as each channel offers them', () => {
    expect(googleScheduleAdjustmentStrategiesOn('search')).toEqual(['manual-cpc', 'maximize-clicks']);
    expect(googleScheduleAdjustmentStrategiesOn('display')).toEqual(['maximize-clicks']);
    expect(googleScheduleAdjustmentStrategiesOn('performance-max')).toEqual([]);
    expect(googleScheduleAdjustmentStrategiesOn('video')).toEqual([]);
    // Demand Gen offers Maximize Clicks, but `validateCriteriaPlan` refuses its schedule modifiers under every strategy.
    expect(googleScheduleAdjustmentStrategiesOn('demand-gen')).toEqual([]);
    expect(googleChannelRefusesScheduleAdjustments('demand-gen')).toBe(true);
    expect(googleChannelRefusesScheduleAdjustments('search')).toBe(false);
  });

  it('is true only for Manual CPC and Maximize Clicks', () => {
    expect(
      ['manual-cpc', 'maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'].map(
        googleStrategyTakesScheduleAdjustments
      )
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe('googleDeviceBidModifierRefusal', () => {
  it('accepts an exclusion and an adjustment on different devices under Manual CPC', () => {
    expect(
      googleDeviceBidModifierRefusal(
        [
          { device: 'TABLET', bidModifier: 0 },
          { device: 'mobile ', bidModifier: 1.2 },
        ],
        'manual-cpc',
        'search'
      )
    ).toBeNull();
  });

  it('refuses an unknown device, a repeated device and an out-of-range modifier', () => {
    expect(googleDeviceBidModifierRefusal([{ device: 'TV', bidModifier: 1 }], 'manual-cpc', 'search')).toContain('which is not one of MOBILE, DESKTOP, TABLET');
    expect(
      googleDeviceBidModifierRefusal(
        [
          { device: 'MOBILE', bidModifier: 1 },
          { device: 'MOBILE', bidModifier: 2 },
        ],
        'manual-cpc',
        'search'
      )
    ).toContain('name MOBILE more than once');
    expect(googleDeviceBidModifierRefusal([{ device: 'DESKTOP', bidModifier: 0.05 }], 'manual-cpc', 'search')).toContain(
      'device bid modifier 1 has a bid modifier of 0.05'
    );
  });

  // campaign-service's `validateBiddingPlan`: under any strategy but manual-cpc, every NON-ZERO device
  // modifier is refused, 1 (a 0% adjustment) included, and 0 (the exclusion) is not. The reason given
  // is Google's under Smart Bidding and LFX One's policy under Maximize Clicks, where Google applies it.
  it.each(['maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'])(
    'refuses any non-zero modifier under %s on Search, 1 (0%%) included, offering Manual CPC as a way out',
    (strategy) => {
      for (const bidModifier of [1.2, 1]) {
        const refusal = googleDeviceBidModifierRefusal(
          [
            { device: 'TABLET', bidModifier: 0 },
            { device: ' mobile', bidModifier },
          ],
          strategy,
          'search'
        );
        expect(refusal).toBe(
          `The Google Ads device bid modifier 2 gives MOBILE a bid modifier of ${bidModifier}. ${googleDeviceAdjustmentNotSentSentence(strategy)} Set it to 0 to exclude the device, remove it, or bid with Manual CPC, then create again.`
        );
      }
    }
  );

  it.each(['display', 'video'] as const)('leaves Manual CPC out of the way out on %s, which does not offer it', (channel) => {
    const refusal = googleDeviceBidModifierRefusal([{ device: 'MOBILE', bidModifier: 1.2 }], 'maximize-conversions', channel);
    expect(refusal).toBe(
      "The Google Ads device bid modifier 1 gives MOBILE a bid modifier of 1.2. Google Ads doesn't apply a device bid adjustment under Maximize Conversions, except a -100% exclusion, so LFX One doesn't send one. Set it to 0 to exclude the device or remove it, then create again."
    );
    expect(refusal).not.toContain('bid with Manual CPC');
  });

  it.each(['maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'])(
    'accepts exclusions under %s, which Google honours under automated bidding',
    (strategy) => {
      expect(
        googleDeviceBidModifierRefusal(
          [
            { device: 'TABLET', bidModifier: 0 },
            { device: 'MOBILE', bidModifier: 0 },
          ],
          strategy,
          'search'
        )
      ).toBeNull();
    }
  );

  it('judges every entry before the strategy, as validateCriteriaPlan runs before validateBiddingPlan', () => {
    expect(
      googleDeviceBidModifierRefusal(
        [
          { device: 'MOBILE', bidModifier: 1.2 },
          { device: 'DESKTOP', bidModifier: 0.05 },
        ],
        'maximize-conversions',
        'search'
      )
    ).toContain('device bid modifier 2 has a bid modifier of 0.05');
  });

  it('names an unknown strategy as written, since it is not Manual CPC either', () => {
    expect(googleDeviceBidModifierRefusal([{ device: 'MOBILE', bidModifier: 1.2 }], 'retired-strategy', 'search')).toContain(
      "LFX One sends a device bid adjustment only under Manual CPC, so it doesn't send one under retired-strategy."
    );
  });
});

// Google applies a device bid adjustment under Maximize Clicks, applies it to the CPA target under
// Target CPA (https://support.google.com/google-ads/answer/6268632), and does not apply it under the
// other Smart Bidding strategies (except a -100% exclusion):
// https://support.google.com/google-ads/answer/2732132. The sentence must not say Google ignores it
// under Maximize Clicks or Target CPA, where the refusal is campaign-service's Manual-CPC-only rule.
/**
 * `validateCriteriaPlan`'s Demand Gen arm and `demandGenDeviceTypes` (campaign-service v1.0.31): a
 * device only as an exclusion, CONNECTED_TV in the vocabulary, the cap at the vocabulary's size.
 */
describe('googleDeviceBidModifierRefusal on Demand Gen', () => {
  it('takes CONNECTED_TV there and nowhere else', () => {
    expect(googleAdsDevicesOn('demand-gen')).toEqual(['MOBILE', 'DESKTOP', 'TABLET', 'CONNECTED_TV']);
    expect(googleAdsDevicesOn('search')).toEqual(['MOBILE', 'DESKTOP', 'TABLET']);
    expect(googleAdsDevicesOn('display')).toEqual(['MOBILE', 'DESKTOP', 'TABLET']);
    expect(googleDeviceBidModifierRefusal([{ device: 'CONNECTED_TV', bidModifier: 0 }], 'maximize-clicks', 'demand-gen')).toBeNull();
    expect(googleDeviceBidModifierRefusal([{ device: 'CONNECTED_TV', bidModifier: 0 }], 'maximize-conversions', 'display')).toContain(
      'which is not one of MOBILE, DESKTOP, TABLET on Display campaigns'
    );
  });

  it('accepts every device excluded, which upstream does not refuse on Demand Gen', () => {
    const all = googleAdsDevicesOn('demand-gen').map((device) => ({ device, bidModifier: 0 }));
    expect(googleDeviceBidModifierRefusal(all, 'maximize-conversions', 'demand-gen')).toBeNull();
  });

  it('echoes a device it has not yet checked against the vocabulary at most 32 characters long', () => {
    const refusal = googleDeviceBidModifierRefusal([{ device: 'x'.repeat(200), bidModifier: 1.2 }], 'manual-cpc', 'demand-gen');
    expect(refusal).toContain(`gives ${'X'.repeat(32)}… a bid modifier of 1.2.`);
    expect(refusal).not.toContain('X'.repeat(33));
  });

  it('refuses any modifier but 0, under every strategy, before the vocabulary', () => {
    expect(googleChannelTakesDeviceExclusionsOnly('demand-gen')).toBe(true);
    expect(googleChannelTakesDeviceExclusionsOnly('search')).toBe(false);
    expect(googleDeviceBidModifierRefusal([{ device: 'TABLET', bidModifier: 1.2 }], 'manual-cpc', 'demand-gen')).toBe(
      "The Google Ads device bid modifier 1 gives TABLET a bid modifier of 1.2. Demand Gen campaigns take a device only as an exclusion, so LFX One doesn't send a device bid adjustment there. Set it to 0 to exclude the device or remove it, then create again."
    );
    expect(
      googleDeviceBidModifierRefusal(
        [
          { device: 'TV', bidModifier: 0 },
          { device: 'MOBILE', bidModifier: 1 },
        ],
        'maximize-clicks',
        'demand-gen'
      )
    ).toContain('device bid modifier 2 gives MOBILE a bid modifier of 1. Demand Gen campaigns');
  });
});

describe('googleDeviceAdjustmentNotSentSentence', () => {
  it.each(['maximize-conversions', 'maximize-conversion-value', 'target-roas'])("gives Google's reason where Google ignores it (%s)", (strategy) => {
    expect(googleDeviceAdjustmentNotSentSentence(strategy)).toBe(
      `Google Ads doesn't apply a device bid adjustment under ${GOOGLE_BIDDING_STRATEGY_LABELS[strategy as keyof typeof GOOGLE_BIDDING_STRATEGY_LABELS]}, except a -100% exclusion, so LFX One doesn't send one.`
    );
  });

  it("gives LFX One's policy under Maximize Clicks, where Google would apply it", () => {
    const sentence = googleDeviceAdjustmentNotSentSentence('maximize-clicks');
    expect(sentence).toBe("LFX One sends a device bid adjustment only under Manual CPC, so it doesn't send one under Maximize Clicks.");
    expect(sentence).not.toContain("doesn't apply");
  });

  it("gives LFX One's policy under Target CPA, where Google adjusts the CPA target", () => {
    const sentence = googleDeviceAdjustmentNotSentSentence('target-cpa');
    expect(sentence).toBe("LFX One sends a device bid adjustment only under Manual CPC, so it doesn't send one under Target CPA.");
    expect(sentence).not.toContain("doesn't apply");
  });
});

describe('googleChannelOffersManualCpc', () => {
  it('is true only where the strategy picker offers Manual CPC', () => {
    expect(googleChannelOffersManualCpc('search')).toBe(true);
    expect(googleChannelOffersManualCpc('display')).toBe(false);
    expect(googleChannelOffersManualCpc('video')).toBe(false);
    expect(googleChannelOffersManualCpc('performance-max')).toBe(false);
    expect(googleChannelOffersManualCpc('demand-gen')).toBe(false);
  });
});

describe('googleEffectiveBiddingStrategy', () => {
  it('lower-cases and Go-trims the forwarded name', () => {
    expect(googleEffectiveBiddingStrategy('\u0085 Manual-CPC ', 'display')).toBe('manual-cpc');
    expect(googleEffectiveBiddingStrategy('target-cpa', 'search')).toBe('target-cpa');
  });

  it("falls back to the channel's default when nothing is forwarded", () => {
    expect(googleEffectiveBiddingStrategy(undefined, 'search')).toBe('manual-cpc');
    expect(googleEffectiveBiddingStrategy('  ', 'display')).toBe('maximize-conversions');
    expect(googleEffectiveBiddingStrategy(42, 'video')).toBe('maximize-conversions');
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

  it('names each list in its own words through the per-list wrappers', () => {
    expect(googleExcludedAgeRangesRefusal(['18-24', '65+'], 'search')).toBeNull();
    expect(googleExcludedAgeRangesRefusal('18-24', 'search')).toBe('Google Ads excluded age ranges must be a list of age range names.');
    expect(googleExcludedGendersRefusal(['FEMALE'], 'display')).toBeNull();
    expect(googleExcludedGendersRefusal('FEMALE', 'search')).toBe('Google Ads excluded genders must be a list of gender names.');
    expect(googleExcludedGendersRefusal(['FEMALE'], 'demand-gen')).toContain('Remove the excluded genders or pick a different channel');
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

  it('judges the whole exclusion list in upstream order: cap, then each entry, then the clash', () => {
    expect(googleExcludedGeoListRefusal(['DE', '1023191'], ['US'])).toBeNull();
    expect(
      googleExcludedGeoListRefusal(
        Array.from({ length: GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS }, () => 'DE'),
        []
      )
    ).toBeNull();
    // Over the cap AND carrying a bad entry and a clash: the cap is named, as upstream checks it first.
    const overCap = ['ZZ', 'US', ...Array.from({ length: GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS - 1 }, () => 'DE')];
    expect(googleExcludedGeoListRefusal(overCap, ['US'])).toBe(
      `Google Ads accepts at most ${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS} excluded locations on one campaign, and this one has ${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS + 1}. Remove some and create again.`
    );
    // A bad entry is named before a clash later in the list.
    expect(googleExcludedGeoListRefusal(['US', 'ZZ'], ['US'])).toContain('cannot exclude ZZ on this path');
    expect(googleExcludedGeoListRefusal(['2840'], ['US'])).toContain('cannot both target and exclude US');
  });
});
