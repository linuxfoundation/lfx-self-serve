// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInTextAdAssetField, linkedInTextAdsRefusal } from './campaign-linkedin-text-ads.utils';

const ad = { headline: 'KubeCon NA', description: 'Join cloud native engineers.' };
const text = { format: 'text', bidding: { strategy: 'manual', bidAmount: 5 }, variants: [], textAds: [ad] };

describe('linkedInTextAdsRefusal', () => {
  it.each([
    ['a single-image create', { variants: [{ introText: 'i', headline: 'h' }] }],
    ['an explicit single-image format', { format: 'single_image', variants: [] }],
    ['a text create', text],
    ['a text create with no variants key', { ...text, variants: undefined }],
    ['an image URN', { ...text, textAds: [{ ...ad, imageUrn: 'urn:li:image:C4E22AQ_x-1' }] }],
    ['an uploaded image', { ...text, textAds: [{ ...ad, imageAssetId: 'a1' }] }],
    ['an empty image field beside the other', { ...text, textAds: [{ ...ad, imageUrn: '', imageAssetId: 'a1' }] }],
    ['a headline of 25 and description of 75 characters', { ...text, textAds: [{ headline: 'h'.repeat(25), description: 'd'.repeat(75) }] }],
    ['100 text ads', { ...text, textAds: Array(100).fill(ad) }],
    ['not an object', null],
  ])('accepts %s', (_name, raw) => {
    expect(linkedInTextAdsRefusal(raw, true)).toBeNull();
  });

  it.each([
    ['an unknown format', { format: 'video' }, 'linkedInConfig.format'],
    ['a format that is not text', { format: null }, 'linkedInConfig.format'],
    ['text ads without the text format', { textAds: [ad] }, 'linkedInConfig.textAds'],
    ['automatic bidding', { ...text, bidding: { strategy: 'automatic' } }, 'linkedInConfig.bidding'],
    ['no bidding', { ...text, bidding: undefined }, 'linkedInConfig.bidding'],
    ['variants beside text ads', { ...text, variants: [{ introText: 'i', headline: 'h' }] }, 'linkedInConfig.variants'],
    ['no text ads', { ...text, textAds: [] }, 'linkedInConfig.textAds'],
    ['text ads that are not a list', { ...text, textAds: {} }, 'linkedInConfig.textAds'],
    ['101 text ads', { ...text, textAds: Array(101).fill(ad) }, 'linkedInConfig.textAds'],
    ['a text ad that is not an object', { ...text, textAds: [ad, 'x'] }, 'linkedInConfig.textAds[1]'],
    ['a null field', { ...text, textAds: [{ ...ad, imageUrn: null }] }, 'linkedInConfig.textAds[0].imageUrn'],
    ['a number headline', { ...text, textAds: [{ ...ad, headline: 7 }] }, 'linkedInConfig.textAds[0].headline'],
    ['a missing description', { ...text, textAds: [{ headline: 'h' }] }, 'linkedInConfig.textAds[0].description'],
    ['a dash-only headline', { ...text, textAds: [{ ...ad, headline: ' — ' }] }, 'linkedInConfig.textAds[0].headline'],
    ['a 26-character headline', { ...text, textAds: [{ ...ad, headline: 'h'.repeat(26) }] }, 'linkedInConfig.textAds[0].headline'],
    ['a 76-character description', { ...text, textAds: [{ ...ad, description: 'd'.repeat(76) }] }, 'linkedInConfig.textAds[0].description'],
    ['both image fields', { ...text, textAds: [{ ...ad, imageUrn: 'urn:li:image:1', imageAssetId: 'a1' }] }, 'linkedInConfig.textAds[0].imageUrn'],
    ['a malformed image URN', { ...text, textAds: [{ ...ad, imageUrn: 'urn:li:digitalmediaAsset:1' }] }, 'linkedInConfig.textAds[0].imageUrn'],
  ])('refuses %s', (_name, raw, field) => {
    expect(linkedInTextAdsRefusal(raw, true)?.field).toBe(field);
  });

  it('counts characters, not UTF-16 units, as campaign-service does', () => {
    expect(linkedInTextAdsRefusal({ ...text, textAds: [{ ...ad, headline: '🚀'.repeat(25) }] }, true)).toBeNull();
  });

  it('refuses a text create while this deployment cannot send one, but not a single-image create', () => {
    expect(linkedInTextAdsRefusal(text, false)?.field).toBe('linkedInConfig.format');
    expect(linkedInTextAdsRefusal({ format: 'single_image', variants: [] }, false)).toBeNull();
  });

  it('never echoes a caller value', () => {
    expect(linkedInTextAdsRefusal({ ...text, textAds: [{ ...ad, headline: 'SECRET'.repeat(5) }] }, true)?.message).not.toContain('SECRET');
  });
});

describe('linkedInTextAdAssetField', () => {
  it.each([
    [{ textAds: [ad, { ...ad, imageAssetId: 'a1' }] }, 'linkedInConfig.textAds[1].imageAssetId'],
    [{ textAds: [{ ...ad, imageAssetId: null }] }, 'linkedInConfig.textAds[0].imageAssetId'],
    [{ textAds: [ad, null] }, null],
    [{ textAds: 'none' }, null],
    [null, null],
  ])('finds the stored image in %j: %s', (raw, expected) => {
    expect(linkedInTextAdAssetField(raw)).toBe(expected);
  });
});
