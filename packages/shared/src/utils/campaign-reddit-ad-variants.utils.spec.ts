// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { redditAdPerVariantRefusal } from './campaign-reddit-ad-variants.utils';

const v = (...headlines: string[]) => headlines.map((headline) => ({ headline, body: 'preview' }));
const authored = (variants: unknown) => ({ imageUrl: 'https://img.example/a.png', variants });

describe('redditAdPerVariantRefusal', () => {
  it.each<[string, unknown, boolean]>([
    // Today's creates already carry several variants: nothing changes while the flag is off.
    ['six variants and a blank headline, without the flag', authored(v('a', 'b', 'c', 'd', 'e', ' ')), false],
    ['not an object', null, true],
    ['two to five good variants', authored(v('a', 'b', 'c', 'd', 'e')), true],
    ['an uploaded image instead of a URL', { imageAssetId: 'asset-1', variants: v('a', 'b') }, true],
    // The one-ad create is unchanged: an existing post, no authored image, or fewer than two variants.
    ['an existing post', { postUrl: 'https://reddit.example/p', imageUrl: 'https://img.example/a.png', variants: v('a', 'b', 'c', 'd', 'e', 'f') }, true],
    ['no image', { variants: v('a', ' ', 'c', 'd', 'e', 'f') }, true],
    ['a blank image URL', { imageUrl: '  ', variants: v('a', ' ') }, true],
    ['one blank variant', authored(v(' ')), true],
    ['no variants', authored(null), true],
    // campaign-service fails a create it cannot decode before any Reddit call; that is left to it.
    ['a non-text headline', authored([{ headline: 1 }, { headline: '' }]), true],
    ['a non-text body', authored([{ headline: '', body: 2 }, { headline: 'b' }]), true],
    ['a variant list that is not a list', authored('a'), true],
    ['a non-text postUrl', { postUrl: 1, imageUrl: 'https://img.example/a.png', variants: v('a', ' ') }, true],
    // Counted in code points, as campaign-service counts runes: 300 emoji are 300 characters.
    ['a 300-character headline, emoji counted once', authored(v('😀'.repeat(300), 'b')), true],
    ['a headline padded past 300 that trims to 300', authored(v(` ${'x'.repeat(300)} `, 'b')), true],
    // campaign-service decodes keys ignoring case, and the last spelling in byte order wins.
    [
      'a case variant of postUrl naming an existing post',
      { PostURL: 'https://reddit.example/p', imageUrl: 'https://img.example/a.png', variants: v('a', ' ') },
      true,
    ],
    // campaign-service refuses both images first (`checkRedditAssetChoice`), so its message is the one to show.
    ['an image URL and an uploaded image', { imageUrl: 'https://img.example/a.png', imageAssetId: 'asset-1', variants: v('a', ' ') }, true],
    // Where Go's key matching could read the config differently, the create is left to campaign-service.
    ['a non-ASCII spelling Go does not fold to variants', { imageUrl: 'https://img.example/a.png', variants: v('a'), varıants: [{}, {}, {}] }, true],
    [
      'postUrl under two spellings, the exact one null',
      { postUrl: null, PostURL: 'https://reddit.example/p', imageUrl: 'https://img.example/a.png', variants: v('a', ' ') },
      true,
    ],
    ['variants under two spellings, which Go merges', { imageUrl: 'https://img.example/a.png', variants: [{ body: 'z' }, null], Variants: v('a', 'b') }, true],
    ['a headline under two spellings', authored([{ headline: 'a' }, { headline: ' ', Headline: 'b' }]), true],
    ['only a non-ASCII spelling of variants, which Go ignores', { imageUrl: 'https://img.example/a.png', varıants: [{}, {}, {}] }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditAdPerVariantRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, string, string]>([
    ['six variants', authored(v('a', 'b', 'c', 'd', 'e', 'f')), 'redditConfig.variants', 'at most 5'],
    // The count is refused before any headline is read.
    ['six variants with a blank headline', authored(v(' ', 'b', 'c', 'd', 'e', 'f')), 'redditConfig.variants', 'at most 5'],
    ['a blank headline', authored(v('a', ' \u0085 ')), 'redditConfig.variants[1].headline', 'Variant 2 has no headline'],
    ['a missing headline', authored([{ headline: 'a' }, { body: 'only a body' }]), 'redditConfig.variants[1].headline', 'Variant 2 has no headline'],
    ['a null variant', authored([null, { headline: 'b' }]), 'redditConfig.variants[0].headline', 'Variant 1 has no headline'],
    ['a 301-character headline', authored(v('a', 'x'.repeat(301))), 'redditConfig.variants[1].headline', '301 characters'],
    ['the first bad variant, blank before long', authored(v('x'.repeat(301), ' ')), 'redditConfig.variants[0].headline', 'Variant 1'],
    ['a case variant of the variants key', { imageUrl: 'https://img.example/a.png', Variants: v('a', ' ') }, 'redditConfig.variants[1].headline', 'Variant 2'],
  ])('refuses %s', (_name, raw, field, message) => {
    const refusal = redditAdPerVariantRefusal(raw, true);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(redditAdPerVariantRefusal(authored(v('<script>', `<b>${'x'.repeat(300)}`)), true)?.message).not.toContain('<');
  });
});
