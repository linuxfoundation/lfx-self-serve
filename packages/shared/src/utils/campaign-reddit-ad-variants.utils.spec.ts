// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  redditAdPerVariantAuthorsPost,
  redditAdPerVariantRefusal,
  redditAdVariantsAdded,
  redditAdVariantsCheck,
  redditAdVariantsFirstHeadlineRefusal,
  redditAdVariantsFromDraft,
  redditAdVariantsInEffect,
  redditAdVariantsRemoved,
  redditAdVariantsWithHeadline,
  redditAdVariantViews,
} from './campaign-reddit-ad-variants.utils';

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

// The Implement tab's editor (#6108 row 6).
describe('redditAdPerVariantAuthorsPost', () => {
  it.each<[string, string, string, string, boolean]>([
    ['an image URL', '', 'https://img.example/a.png', '', true],
    ['an uploaded image', '', '', 'asset-1', true],
    ['an existing post', 'https://reddit.example/p', 'https://img.example/a.png', '', false],
    ['no image', '', '  ', '', false],
    ['a blank post URL beside an image', '  ', 'https://img.example/a.png', '', true],
  ])('%s', (_name, postUrl, imageUrl, imageAssetId, expected) => {
    expect(redditAdPerVariantAuthorsPost(postUrl, imageUrl, imageAssetId)).toBe(expected);
  });
});

describe('redditAdVariantsInEffect', () => {
  const seed = v('brief');
  const edited = v('edited');
  it.each<[string, ReturnType<typeof v> | null, boolean | null, ReturnType<typeof v>]>([
    ['the edits on an explicit yes', edited, true, edited],
    ['every variant removed, on a yes', [], true, []],
    ['the seed while unanswered', edited, null, seed],
    ['the seed once the capability is off, so a restored edit is not sent', edited, false, seed],
    ['the seed when nothing was edited', null, true, seed],
  ])('sends %s', (_name, held, enabled, expected) => {
    expect(redditAdVariantsInEffect(seed, held, enabled)).toEqual(expected);
  });
});

describe('redditAdVariantsFromDraft', () => {
  it.each<[string, unknown, unknown]>([
    ['nothing stored', undefined, undefined],
    ['a value that is not a list', 'a', undefined],
    ['an empty list', [], []],
    [
      'a body only when it is text',
      [
        { headline: 'a', body: 'b' },
        { headline: 'c', body: 3 },
      ],
      [{ headline: 'a', body: 'b' }, { headline: 'c' }],
    ],
    ['only entries with a text headline', [{ headline: 'a' }, null, 'b', { headline: 2 }, { body: 'x' }], [{ headline: 'a' }]],
  ])('reads %s', (_name, stored, expected) => {
    expect(redditAdVariantsFromDraft(stored)).toEqual(expected);
  });
});

describe('redditAdVariantsCheck', () => {
  it.each<[string, boolean, boolean, number, string]>([
    ['every headline, one ad each', true, true, 2, 'every'],
    ['the first headline on a one-ad authored post', true, true, 1, 'first'],
    ['nothing with no variants beyond the first', true, true, 0, 'first'],
    ['nothing while an existing post is promoted', true, false, 3, 'none'],
    ['nothing while the editor is not offered', false, true, 3, 'none'],
  ])('reads %s', (_name, enabled, authorsPost, count, expected) => {
    expect(redditAdVariantsCheck(enabled, authorsPost, count)).toBe(expected);
  });
});

describe('redditAdVariantViews', () => {
  const BLANK = 'Enter a headline. Each variant becomes its own Reddit ad.';
  const LONG = 'Shorten the headline to 300 characters or fewer.';
  it.each<[string, ReturnType<typeof v>, 'every' | 'first' | 'none', string[], number[]]>([
    ['good headlines', v('a', 'bb'), 'every', ['', ''], [1, 2]],
    ['a blank headline while each variant is its own ad', v('a', '  '), 'every', ['', BLANK], [1, 0]],
    ['a 301-character headline', v('x'.repeat(301), 'b'), 'every', [LONG, ''], [301, 1]],
    ['300 emoji, counted once each', v('😀'.repeat(300), 'b'), 'every', ['', ''], [300, 1]],
    ['a long first headline on the one-ad authored post', v('x'.repeat(301)), 'first', [LONG], [301]],
    ['a blank first headline there, which falls back to the event name', v(' '), 'first', [''], [0]],
    ['no marks while an existing post is promoted', v(' ', 'x'.repeat(301)), 'none', ['', ''], [0, 301]],
  ])('%s', (_name, variants, check, errors, lengths) => {
    const views = redditAdVariantViews(variants, check);
    expect(views.map((view) => view.error)).toEqual(errors);
    expect(views.map((view) => view.length)).toEqual(lengths);
  });

  it('shows a missing body as blank', () => {
    expect(redditAdVariantViews([{ headline: 'a' }], 'every')[0].body).toBe('');
  });
});

describe('redditAdVariantsFirstHeadlineRefusal', () => {
  it.each<[string, ReturnType<typeof v>, 'every' | 'first' | 'none', string | null]>([
    ['a 301-character first headline on the one-ad authored post', v('x'.repeat(301)), 'first', "Variant 1's headline is 301 characters."],
    ['a 300-character one', v('x'.repeat(300)), 'first', null],
    ['no variants', [], 'first', null],
    ['one ad per variant, which redditAdPerVariantRefusal holds', v('x'.repeat(301), 'b'), 'every', null],
    ['an existing post', v('x'.repeat(301)), 'none', null],
  ])('%s', (_name, variants, check, expected) => {
    const refusal = redditAdVariantsFirstHeadlineRefusal(variants, check);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('redditAdVariants edits', () => {
  it('replaces one headline and keeps its body', () => {
    expect(redditAdVariantsWithHeadline(v('a', 'b'), 1, 'c')).toEqual([
      { headline: 'a', body: 'preview' },
      { headline: 'c', body: 'preview' },
    ]);
  });

  it.each<[string, ReturnType<typeof v>, number]>([
    ['adds a blank variant', v('a'), 2],
    ['adds the first variant', [], 1],
    ['adds none past 5', v('a', 'b', 'c', 'd', 'e'), 5],
    ['adds none to a seed already past 5', v('a', 'b', 'c', 'd', 'e', 'f'), 6],
  ])('%s', (_name, variants, count) => {
    const added = redditAdVariantsAdded(variants);
    expect(added).toHaveLength(count);
    if (count > variants.length) expect(added[count - 1]).toEqual({ headline: '' });
  });

  it('removes any variant, the last one included', () => {
    expect(redditAdVariantsRemoved(v('a', 'b'), 0)).toEqual(v('b'));
    expect(redditAdVariantsRemoved(v('a'), 0)).toEqual([]);
  });
});
