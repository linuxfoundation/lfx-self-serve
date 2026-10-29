// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES,
  GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES,
  GOOGLE_ADS_MAX_PRICE_HEADER_RUNES,
  GOOGLE_ADS_MAX_PRICE_OFFERINGS,
  GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES,
  GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES,
  GOOGLE_ADS_MIN_PRICE_OFFERINGS,
} from '../constants/campaign.constants';
import type { CampaignPriceExtension, CampaignPriceOffering, CampaignPromotion } from '../interfaces/campaign.interface';
import { googleAdsToUpperCode, googleCallExtensionRefusal, googlePriceExtensionRefusal, googlePromotionRefusal } from './campaign-google-assets.utils';

/**
 * One test per branch of upstream's three validators (`internal/platform/googleads/
 * assets_extended.go`), plus the accept-cases that keep them from over-refusing. These functions are
 * the ONE judge both the Implementation tab and the BFF refuse by, so a branch missing here is a
 * branch missing from both.
 */

const URL = 'https://events.example.org/register';
const promo = (overrides: Partial<CampaignPromotion> = {}): CampaignPromotion => ({
  promotionTarget: 'Conference passes',
  discountPercent: 25,
  finalUrl: URL,
  ...overrides,
});
const row = (header: string, overrides: Partial<CampaignPriceOffering> = {}): CampaignPriceOffering => ({
  header,
  description: 'Two days',
  amount: 499,
  currencyCode: 'USD',
  finalUrl: URL,
  ...overrides,
});
const price = (overrides: Partial<CampaignPriceExtension> = {}): CampaignPriceExtension => ({
  type: 'EVENTS',
  languageCode: 'en',
  offerings: [row('Standard'), row('Student'), row('Virtual')],
  ...overrides,
});

describe('googleAdsToUpperCode', () => {
  it("upper-cases what Go's ToUpper turns into ASCII, and leaves ß alone where JS would expand it", () => {
    expect(googleAdsToUpperCode('us')).toBe('US');
    expect(googleAdsToUpperCode('ıt')).toBe('IT');
    expect(googleAdsToUpperCode('uſ')).toBe('US');
    // JS `toUpperCase` makes this 'SS', a code Go never produces — the over-acceptance this avoids.
    expect(googleAdsToUpperCode('ß')).toBe('ß');
  });
});

describe('googleCallExtensionRefusal', () => {
  it('accepts a number written the way a human writes it', () => {
    expect(googleCallExtensionRefusal({ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' }, [])).toBeNull();
  });

  it.each([
    ['a blank country', { countryCode: '', phoneNumber: '4155550100' }, 'no country code'],
    ['a three-letter country', { countryCode: 'USA', phoneNumber: '4155550100' }, 'two-letter ISO'],
    ['a blank number', { countryCode: 'US', phoneNumber: '' }, 'no phone number'],
    ['a number over the rune bound', { countryCode: 'US', phoneNumber: '1'.repeat(GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES + 1) }, '36 characters'],
    ['a vanity number', { countryCode: 'US', phoneNumber: '1-800-FLOWERS' }, 'vanity'],
    ['too few digits', { countryCode: 'US', phoneNumber: '(12)' }, 'fewer than 4 digits'],
  ])('refuses %s', (_label, call, expected) => {
    expect(googleCallExtensionRefusal(call, [])).toContain(expected);
  });

  it('refuses the same digits in the same country however they are punctuated, and accepts them in another country', () => {
    const earlier = [{ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' }];

    expect(googleCallExtensionRefusal({ countryCode: 'US', phoneNumber: '14155550100' }, earlier)).toContain('already listed');
    expect(googleCallExtensionRefusal({ countryCode: 'CA', phoneNumber: '14155550100' }, earlier)).toBeNull();
  });
});

describe('googlePromotionRefusal', () => {
  it.each([
    ['a percentage discount', promo()],
    ['exactly 100 percent', promo({ discountPercent: 100 })],
    ['a money discount with its currency', promo({ discountPercent: undefined, discountAmount: 50, currencyCode: 'USD' })],
    ['a promotion code', promo({ promotionCode: 'SPRING' })],
    ['a minimum order with its currency', promo({ ordersOverAmount: 100, currencyCode: 'EUR' })],
    ['a 25-emoji target, which is 50 UTF-16 units', promo({ promotionTarget: '🎉'.repeat(GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES) })],
    ['a redemption window outside the serving one', promo({ startDate: '2026-11-01', endDate: '2026-11-10', redemptionStartDate: '2026-12-01' })],
    ['the same day as start and end', promo({ startDate: '2026-11-01', endDate: '2026-11-01' })],
    ['a leap day', promo({ startDate: '2028-02-29' })],
    ['an occasion and a regional language tag', promo({ occasion: 'BLACK_FRIDAY', languageCode: 'pt-BR' })],
    ['a zero amount, which upstream reads as unset', promo({ ordersOverAmount: 0 })],
  ])('accepts %s', (_label, promotion) => {
    expect(googlePromotionRefusal(promotion, [])).toBeNull();
  });

  it.each([
    ['a blank target', promo({ promotionTarget: '' }), 'no promotion target'],
    ['a target over the rune bound', promo({ promotionTarget: 'A'.repeat(GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES + 1) }), '26 characters'],
    ['both discounts', promo({ discountAmount: 10, currencyCode: 'USD' }), 'both a percentage and a money discount'],
    ['neither discount', promo({ discountPercent: undefined }), 'neither a percentage nor a money discount'],
    ['a percentage over 100', promo({ discountPercent: 101 }), 'at most 100'],
    ['a negative percentage', promo({ discountPercent: -5 }), 'greater than 0'],
    ['a percentage that rounds to nothing', promo({ discountPercent: 0.00001 }), 'too small'],
    ['a money discount with no currency', promo({ discountPercent: undefined, discountAmount: 10 }), 'no currency code'],
    ['a money discount in a non-ISO currency', promo({ discountPercent: undefined, discountAmount: 10, currencyCode: 'DOLLARS' }), 'three-letter ISO'],
    ['a sub-micro money discount', promo({ discountPercent: undefined, discountAmount: 0.0000001, currencyCode: 'USD' }), 'greater than 0'],
    ['a money discount over the ceiling', promo({ discountPercent: undefined, discountAmount: 2_000_000_000, currencyCode: 'USD' }), 'exceeds the maximum'],
    ['a code and a minimum order', promo({ promotionCode: 'SPRING', ordersOverAmount: 100, currencyCode: 'USD' }), 'at most one'],
    ['a code over the rune bound', promo({ promotionCode: 'C'.repeat(GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES + 1) }), '21 characters'],
    ['a minimum order with no currency', promo({ ordersOverAmount: 100 }), 'no currency code'],
    ['a lower-case occasion', promo({ occasion: 'black_friday' }), 'occasion name'],
    ['a malformed language', promo({ languageCode: 'english!' }), 'language tag'],
    ['an impossible date', promo({ startDate: '2026-02-30' }), 'not a valid'],
    ['a non-leap February 29', promo({ startDate: '2027-02-29' }), 'not a valid'],
    ['a date in the wrong shape', promo({ endDate: '11/01/2026' }), 'not a valid'],
    ['a serving window ending before it starts', promo({ startDate: '2026-11-10', endDate: '2026-11-01' }), 'serving end date'],
    ['a redemption window ending before it starts', promo({ redemptionStartDate: '2026-11-10', redemptionEndDate: '2026-11-01' }), 'redemption end date'],
    ['a blank destination', promo({ finalUrl: '' }), 'no destination URL'],
    ['a destination with credentials', promo({ finalUrl: 'https://user:pw@events.example.org/' }), 'full http:// or https:// URL'],
    ['a destination over the byte bound', promo({ finalUrl: `${URL}?q=${'a'.repeat(2100)}` }), 'bytes'],
  ])('refuses %s', (_label, promotion, expected) => {
    expect(googlePromotionRefusal(promotion, [])).toContain(expected);
  });

  it("refuses a target repeated in a different case, folded with Go's rules", () => {
    expect(googlePromotionRefusal(promo({ promotionTarget: 'οδοσ' }), [promo({ promotionTarget: 'ΟΔΟΣ' })])).toContain('already listed');
  });

  it("checks the discount before the destination, in upstream's own order", () => {
    expect(googlePromotionRefusal(promo({ discountPercent: 200, finalUrl: '' }), [])).toContain('at most 100');
  });
});

describe('googlePriceExtensionRefusal', () => {
  it.each([
    ['a three-row table', price()],
    [
      'an eight-row table with a qualifier and units',
      price({ priceQualifier: 'FROM', offerings: Array.from({ length: 8 }, (_, i) => row(`Tier ${i + 1}`, { unit: 'PER_DAY' })) }),
    ],
    ['a type Google adds later, judged by shape only', price({ type: 'SOME_NEW_TYPE' })],
  ])('accepts %s', (_label, entry) => {
    expect(googlePriceExtensionRefusal(entry)).toBeNull();
  });

  it.each([
    ['a blank type', price({ type: '' }), 'no type'],
    ['a lower-case type', price({ type: 'events' }), 'type name'],
    ['a malformed qualifier', price({ priceQualifier: 'from' }), 'qualifier name'],
    ['a blank language', price({ languageCode: '' }), 'no language code'],
    ['a malformed language', price({ languageCode: 'e' }), 'language tag'],
    ['too few rows', price({ offerings: [row('A'), row('B')] }), `between ${GOOGLE_ADS_MIN_PRICE_OFFERINGS} and ${GOOGLE_ADS_MAX_PRICE_OFFERINGS}`],
    ['too many rows', price({ offerings: Array.from({ length: 9 }, (_, i) => row(`Tier ${i}`)) }), 'It has 9 rows'],
    ['a blank header', price({ offerings: [row('A'), row(''), row('C')] }), 'Row 2 has no header'],
    ['a header over the rune bound', price({ offerings: [row('A'.repeat(GOOGLE_ADS_MAX_PRICE_HEADER_RUNES + 1)), row('B'), row('C')] }), '26 characters'],
    ['a repeated header', price({ offerings: [row('Standard'), row('standard'), row('C')] }), 'one row per header'],
    ['a blank description', price({ offerings: [row('A'), row('B'), row('C', { description: '' })] }), 'Row 3 has no description'],
    [
      'a description over the rune bound',
      price({ offerings: [row('A', { description: 'D'.repeat(GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES + 1) }), row('B'), row('C')] }),
      '26 characters',
    ],
    ['a zero price', price({ offerings: [row('A', { amount: 0 }), row('B'), row('C')] }), 'greater than 0'],
    ['a price with no currency', price({ offerings: [row('A', { currencyCode: '' }), row('B'), row('C')] }), 'no currency code'],
    ['a malformed unit', price({ offerings: [row('A', { unit: 'per day' }), row('B'), row('C')] }), 'unit name'],
    ['a row with no destination', price({ offerings: [row('A'), row('B', { finalUrl: '' }), row('C')] }), 'Row 2 has no destination URL'],
  ])('refuses %s', (_label, entry, expected) => {
    expect(googlePriceExtensionRefusal(entry)).toContain(expected);
  });
});
