// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  linkedInBoostChosen,
  linkedInBoostCreateRefusal,
  linkedInBoostFieldsForCreate,
  linkedInBoostPostError,
  linkedInBoostRefusal,
  linkedInBoostUnavailable,
} from './campaign-linkedin-boost.utils';
import { linkedInConfigKeyRefusal } from './campaign-linkedin-config.utils';
import { linkedInTextAdsRefusal } from './campaign-linkedin-text-ads.utils';

const SHARE = 'urn:li:share:7518402035831111680';
const boost = (fields: Record<string, unknown> = {}) => ({ format: 'boost', boostPost: SHARE, variants: [], ...fields });

describe('linkedInBoostRefusal', () => {
  it.each([
    ['no boost field, on a deployment without boosts', { format: 'single_image', variants: [] }, false],
    // campaign-service reads "" as omitted.
    ['an empty post without the format, on a deployment without boosts', { boostPost: '' }, false],
    ['a share', boost(), true],
    ['a ugcPost', boost({ boostPost: 'urn:li:ugcPost:7400000000000000000' }), true],
    ['no variants key', { format: 'boost', boostPost: SHARE }, true],
    ['not an object', null, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInBoostRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['the format without the flag', boost(), false, 'linkedInConfig.format', 'cannot boost'],
    ['a post without the flag', { boostPost: SHARE }, false, 'linkedInConfig.boostPost', 'cannot boost'],
    ['a post that is not text', boost({ boostPost: 7518402035831111680 }), true, 'linkedInConfig.boostPost', 'as text'],
    ['a null post', boost({ boostPost: null }), true, 'linkedInConfig.boostPost', 'as text'],
    ['a post without the format', { format: 'single_image', boostPost: SHARE }, true, 'linkedInConfig.boostPost', 'only with the boost format'],
    ['text ads', boost({ textAds: [] }), true, 'linkedInConfig.textAds', 'only with the text ad format'],
    ['null text ads', boost({ textAds: null }), true, 'linkedInConfig.textAds', 'only with the text ad format'],
    ['variants', boost({ variants: [{ introText: 'a', headline: 'b' }] }), true, 'linkedInConfig.variants', 'existing post'],
    ['no post', { format: 'boost', variants: [] }, true, 'linkedInConfig.boostPost', 'Choose the LinkedIn post'],
    ['an empty post', boost({ boostPost: '' }), true, 'linkedInConfig.boostPost', 'Choose the LinkedIn post'],
    ['a post URL, not a URN', boost({ boostPost: 'https://www.linkedin.com/feed/update/urn:li:share:1/' }), true, 'linkedInConfig.boostPost', 'post URN'],
    ['an activity URN', boost({ boostPost: 'urn:li:activity:7518402035831111680' }), true, 'linkedInConfig.boostPost', 'post URN'],
    ['a URN with a suffix', boost({ boostPost: `${SHARE}?x` }), true, 'linkedInConfig.boostPost', 'post URN'],
    ['padding around the URN', boost({ boostPost: ` ${SHARE}` }), true, 'linkedInConfig.boostPost', 'post URN'],
    ['non-ASCII digits', boost({ boostPost: 'urn:li:share:٣' }), true, 'linkedInConfig.boostPost', 'post URN'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInBoostRefusal(raw, enabled);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes the caller value', () => {
    expect(linkedInBoostRefusal(boost({ boostPost: 'urn:li:share:<script>' }), true)?.message).not.toContain('<script>');
  });
});

describe('a boost and the other LinkedIn checks', () => {
  it('lets boostPost through the key allow-list', () => {
    expect(linkedInConfigKeyRefusal(boost())).toBeNull();
  });

  it('lets format "boost" through the format check', () => {
    expect(linkedInTextAdsRefusal(boost(), true)).toBeNull();
  });
});

describe('the Implement tab boost', () => {
  it.each([
    ['boost', true, true, false],
    ['boost', false, false, true],
    // Not read yet: held, never sent.
    ['boost', null, false, true],
    ['single_image', true, false, false],
    ['document', false, false, false],
  ] as const)('format %s with the capability %s: chosen %s, unavailable %s', (format, enabled, chosen, unavailable) => {
    expect(linkedInBoostChosen(format, enabled)).toBe(chosen);
    expect(linkedInBoostUnavailable(format, enabled)).toBe(unavailable);
  });

  it('sends the format, the post without the spaces a paste carries, and no variants', () => {
    expect(linkedInBoostFieldsForCreate(`  ${SHARE}\n`)).toEqual({ format: 'boost', boostPost: SHARE, variants: [] });
  });

  it.each([
    ['empty', '', '', null],
    ['a share', SHARE, '', null],
    ['a ugcPost with spaces around it', ' urn:li:ugcPost:74 ', '', null],
    ['an activity URN', 'urn:li:activity:7518402035831111680', 'activity URN', 'post URN'],
    ['a post link', `https://www.linkedin.com/feed/update/${SHARE}/`, 'not its link', 'post URN'],
    ['anything else', 'my post', 'Enter a LinkedIn post URN', 'post URN'],
  ])('the post field, %s', (_name, post, error, refusal) => {
    expect(linkedInBoostPostError(post)).toContain(error);
    if (error === '') expect(linkedInBoostPostError(post)).toBe('');
    if (refusal !== null) expect(linkedInBoostCreateRefusal(post)).toContain(refusal);
  });

  it('holds Create on an empty post, and not on a post URN', () => {
    expect(linkedInBoostCreateRefusal('')).toBe('LinkedIn Ads: Choose the LinkedIn post to boost.');
    expect(linkedInBoostCreateRefusal(SHARE)).toBeNull();
  });
});
