// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditCreateConfigCapabilities } from '../interfaces/campaign.interface';

import { redditCreateConfigRefusal } from './campaign-reddit-create.utils';

const OFF: RedditCreateConfigCapabilities = {
  conversionEvent: false,
  customAudiences: false,
  targetingExclusions: false,
  subCountryGeo: false,
  placements: false,
  demographics: false,
  budgetType: false,
  video: false,
  adPerVariant: false,
};

const ASSET = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

// One field per feature that this deployment cannot send with every flag off, and the field each refusal names.
const HELD: [string, Record<string, unknown>, string][] = [
  ['a conversion event (row 2)', { objective: 'conversions', conversionEvent: 'LEAD' }, 'redditConfig.conversionEvent'],
  ['custom audiences (row 1)', { customAudienceIds: ['t2_synthetic1'] }, 'redditConfig.customAudienceIds'],
  ['excluded communities (row 3)', { excludedSubreddits: ['synth_offtopic'] }, 'redditConfig.excludedSubreddits'],
  ['regions (row 7)', { subCountryGeoTargets: ['US-CA'] }, 'redditConfig.subCountryGeoTargets'],
  ['placements (row 5)', { placements: ['FEED'] }, 'redditConfig.placements'],
  ['a gender (row 9)', { gender: 'FEMALE' }, 'redditConfig.gender'],
  ['a budget type (row 5)', { budgetType: 'daily' }, 'redditConfig.budgetType'],
  ['a stored video (row 8)', { videoAssetId: ASSET, thumbnailAssetId: ASSET }, 'redditConfig.videoAssetId'],
];

describe('redditCreateConfigRefusal', () => {
  it.each(HELD)('refuses %s on a Reddit create', (_name, config, field) => {
    expect(redditCreateConfigRefusal(['reddit-ads'], { budgetUsd: 50, ...config }, OFF)?.field).toBe(field);
  });

  it.each(HELD)('never judges %s when Reddit is not selected', (_name, config) => {
    expect(redditCreateConfigRefusal(['meta-ads', 'google-ads'], { budgetUsd: 50, ...config }, OFF)).toBeNull();
    expect(redditCreateConfigRefusal([], { budgetUsd: 50, ...config }, OFF)).toBeNull();
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      'a conversion event before exclusions',
      { objective: 'conversions', conversionEvent: 'LEAD', excludedSubreddits: ['synth_offtopic'] },
      'redditConfig.conversionEvent',
    ],
    ['placements before a gender', { placements: ['FEED'], gender: 'FEMALE' }, 'redditConfig.placements'],
    ['a gender before a budget type', { gender: 'FEMALE', budgetType: 'daily' }, 'redditConfig.gender'],
  ])('keeps campaign-service order: %s', (_name, config, field) => {
    expect(redditCreateConfigRefusal(['reddit-ads'], { budgetUsd: 50, ...config }, OFF)?.field).toBe(field);
  });

  it('passes a plain config, and every feature once its flag is on', () => {
    expect(redditCreateConfigRefusal(['reddit-ads'], { budgetUsd: 50 }, OFF)).toBeNull();
    const on = Object.fromEntries(Object.keys(OFF).map((key) => [key, true])) as unknown as RedditCreateConfigCapabilities;
    expect(redditCreateConfigRefusal(['reddit-ads'], { budgetUsd: 50, gender: 'FEMALE', placements: ['FEED'], budgetType: 'daily' }, on)).toBeNull();
  });
});
