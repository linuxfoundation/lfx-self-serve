// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { correctLinkedInGeoTargets, linkedInConfigKeyRefusal } from './campaign-linkedin-config.utils';

describe('linkedInConfigKeyRefusal', () => {
  const variant = { introText: 'Join us', headline: 'KubeCon', imageAssetId: 'a1' };
  const config = { eventName: 'KubeCon', budgetUsd: 500, lifetimeBudget: true, dailyCapUsd: 20, variants: [variant], bidding: {} };

  it.each([
    [config, null],
    [null, null],
    [{ ...config, variants: 'none' }, null],
    [{ ...config, variants: [null, 'text'] }, null],
    [{ ...config, format: 'text', textAds: [{ headline: 'h', description: 'd', imageUrn: 'urn:li:image:1' }, null] }, null],
    [{ ...config, targeting: { include: [{ skills: ['urn:li:skill:1'] }] } }, null],
    [{ ...config, objective: 'conversions', conversions: ['104012'] }, null],
    [{ ...config, variants: [{ introText: 'Join us', headline: 'KubeCon', videoAssetId: 'v1' }] }, null],
  ])('accepts %j', (raw, expected) => {
    expect(linkedInConfigKeyRefusal(raw)).toBe(expected);
  });

  it.each([
    // A field campaign-service reads that no self-serve check covers yet.
    [{ ...config, jobFunctions: ['urn:li:function:8'] }, 'linkedInConfig'],
    [{ ...config, Objective: 'conversions' }, 'linkedInConfig.objective'],
    // Another spelling of a known key names the key; Go folds U+017F (long s) to s.
    [{ ...config, DailyCapUsd: 20 }, 'linkedInConfig.dailyCapUsd'],
    [{ ...config, ['ſelectedAdAccountId']: '1' }, 'linkedInConfig.selectedAdAccountId'],
    [{ ...config, variants: [variant, { ...variant, thumbnailAssetId: 'v1' }] }, 'linkedInConfig.variants[1]'],
    [{ ...config, variants: [{ ...variant, VideoAssetId: 'v1' }] }, 'linkedInConfig.variants[0].videoAssetId'],
    [{ ...config, variants: [{ ...variant, ImageUrn: 'urn:li:image:1' }] }, 'linkedInConfig.variants[0].imageUrn'],
    [{ ...config, textAds: [{ headline: 'h', descripton: 'd' }] }, 'linkedInConfig.textAds[0]'],
    [{ ...config, textAds: [{ Headline: 'h' }] }, 'linkedInConfig.textAds[0].headline'],
  ])('refuses %j, naming %s', (raw, field) => {
    expect(linkedInConfigKeyRefusal(raw)?.field).toBe(field);
  });

  it('never echoes an unknown key', () => {
    expect(linkedInConfigKeyRefusal({ ...config, secretField: 1 })?.message).not.toContain('secretField');
  });
});

describe('correctLinkedInGeoTargets', () => {
  it.each([
    ['Germany as the old map sent it', [{ label: 'Germany', urn: 'urn:li:geo:101165590' }], [{ label: 'Germany', urn: 'urn:li:geo:101282230' }]],
    [
      'the United Kingdom as the old map sent it',
      [{ label: 'United Kingdom', urn: 'urn:li:geo:106693272' }],
      [{ label: 'United Kingdom', urn: 'urn:li:geo:101165590' }],
    ],
    ['a genuine United Kingdom target', [{ label: 'United Kingdom', urn: 'urn:li:geo:101165590' }], [{ label: 'United Kingdom', urn: 'urn:li:geo:101165590' }]],
    ['a genuine Switzerland target', [{ label: 'Switzerland', urn: 'urn:li:geo:106693272' }], [{ label: 'Switzerland', urn: 'urn:li:geo:106693272' }]],
    ['other targets', [{ label: 'Japan', urn: 'urn:li:geo:101355337' }, 'x'], [{ label: 'Japan', urn: 'urn:li:geo:101355337' }, 'x']],
    ['a value that is not a list', 'none', 'none'],
    [
      'a stale United Kingdom beside a new one',
      [
        { label: 'United Kingdom', urn: 'urn:li:geo:106693272' },
        { label: 'United Kingdom', urn: 'urn:li:geo:101165590' },
      ],
      [{ label: 'United Kingdom', urn: 'urn:li:geo:101165590' }],
    ],
  ])('corrects %s', (_name, raw, expected) => {
    expect(correctLinkedInGeoTargets(raw)).toEqual(expected);
  });
});
