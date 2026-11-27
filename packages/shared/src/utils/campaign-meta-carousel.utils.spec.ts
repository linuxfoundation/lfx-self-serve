// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_CAROUSEL_OFF_MESSAGE } from '../constants/campaign.constants';
import type { CreativeAssetLibraryState, MetaCarouselCardDraft, MetaCarouselImageContext } from '../interfaces/campaign.interface';
import {
  metaAdFormatToSend,
  metaCarouselCardViews,
  metaCarouselChosen,
  metaCarouselOffered,
  metaCarouselCreateRefusal,
  metaCarouselRefusal,
  metaCarouselSeed,
  metaCarouselUnavailable,
  metaCarouselVariantsForCreate,
} from './campaign-meta-carousel.utils';

const card = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  primaryText: '',
  headline: 'h',
  imageUrl: 'https://cdn.example/a.png',
  ...extra,
});
const cards = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => card(i === 0 ? { primaryText: 'Join us' } : {}));

describe('metaCarouselRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['no format', { variants: cards(1) }, false],
    ['a null format', { format: null, variants: cards(1) }, false],
    ['a blank format', { format: '  ', variants: cards(1) }, false],
    ['single, in any case, while off', { format: ' SINGLE ', variants: cards(1), leadFormId: '123' }, false],
    ['a carousel of 2 cards', { format: 'carousel', variants: cards(2) }, true],
    ['a carousel of 10 cards, in another case', { format: ' Carousel ', variants: cards(10) }, true],
    [
      'a carousel whose later cards repeat the message, an asset image on one',
      { format: 'carousel', variants: [card({ primaryText: 'Join us' }), card({ primaryText: ' Join us ', imageUrl: undefined, imageAssetId: 'a-1' })] },
      true,
    ],
    ['a carousel with a blank lead form', { format: 'carousel', variants: cards(2), leadFormId: ' ' }, true],
    ['no config', undefined, false],
  ])('accepts %s', (_case, raw, enabled) => {
    expect(metaCarouselRefusal(raw, enabled)).toBeNull();
  });

  // campaign-service's order: the type, the gate, the value, the lead form, the count, the message, then each card.
  it.each<[string, unknown, boolean, string, string]>([
    ['a non-text format, even while off', { format: 1 }, false, 'metaConfig.format', 'The Meta ad format must be text.'],
    ['a carousel while off', { format: 'carousel', variants: cards(2) }, false, 'metaConfig.format', META_CAROUSEL_OFF_MESSAGE],
    ['an unknown format while off, naming no format', { format: 'video' }, false, 'metaConfig.format', META_CAROUSEL_OFF_MESSAGE],
    ['an unknown format while on', { format: 'video' }, true, 'metaConfig.format', 'The Meta ad format must be one of single, carousel.'],
    [
      'a lead form, before the cards',
      { format: 'carousel', variants: cards(1), leadFormId: '123' },
      true,
      'metaConfig.format',
      'A carousel ad cannot use a lead form. Create single-image ads, or remove the lead form.',
    ],
    ['one card', { format: 'carousel', variants: cards(1) }, true, 'metaConfig.format', 'A carousel needs 2 to 10 variants, one per card.'],
    ['11 cards', { format: 'carousel', variants: cards(11) }, true, 'metaConfig.format', 'A carousel needs 2 to 10 variants, one per card.'],
    ['no variants list', { format: 'carousel', variants: 'x' }, true, 'metaConfig.format', 'A carousel needs 2 to 10 variants, one per card.'],
    [
      "a blank card 1 message, before a later card's",
      { format: 'carousel', variants: [card({ primaryText: ' ' }), card({ primaryText: 'Other' })] },
      true,
      'metaConfig.variants[0].primaryText',
      "A carousel's message is card 1's primary text, which is required.",
    ],
    [
      'a video card, before its missing image',
      { format: 'carousel', variants: [...cards(1), card({ videoAssetId: 'v-1', imageUrl: '' })] },
      true,
      'metaConfig.variants[1].videoAssetId',
      'Card 2 of a carousel carries an image, not a video.',
    ],
    [
      'a card with no image, before its second message',
      { format: 'carousel', variants: [...cards(1), card({ imageUrl: ' ', primaryText: 'Other' })] },
      true,
      'metaConfig.variants[1]',
      'Card 2 of a carousel needs an image.',
    ],
    [
      'a card that is not an object',
      { format: 'carousel', variants: [...cards(1), 'x'] },
      true,
      'metaConfig.variants[1]',
      'Card 2 of a carousel needs an image.',
    ],
    [
      'a second message',
      { format: 'carousel', variants: [...cards(2), card({ primaryText: 'Other' })] },
      true,
      'metaConfig.variants[2].primaryText',
      "A carousel has one message, card 1's primary text. Leave card 3's primary text empty or make it identical.",
    ],
  ])('refuses %s', (_case, raw, enabled, field, message) => {
    expect(metaCarouselRefusal(raw, enabled)).toEqual({ field, message });
  });
});

describe('metaAdFormatToSend', () => {
  it.each<[unknown, string | null]>([
    [{ format: ' Carousel ' }, 'carousel'],
    [{ format: 'SINGLE' }, 'single'],
    [{ format: ' ' }, null],
    [{ format: null }, null],
    [{}, null],
    [undefined, null],
  ])('sends %j as %s', (raw, expected) => {
    expect(metaAdFormatToSend(raw)).toBe(expected);
  });
});

describe('the Implement tab carousel', () => {
  const draft = (key: string, extra: Partial<MetaCarouselCardDraft> = {}): MetaCarouselCardDraft => ({
    key,
    imageAssetId: '',
    imageAssetBriefId: '',
    imageUrl: '',
    headline: '',
    description: '',
    ...extra,
  });
  const ctx: MetaCarouselImageContext = { uploadAvailable: true, creativeAvailable: true, briefId: 'b1' };
  const library: CreativeAssetLibraryState = {
    status: 'ready',
    assets: [{ id: 'img-1', projectId: 'p', briefId: 'b1', mimeType: 'image/png', byteSize: 1, checksum: 'c', width: 1080, height: 1080 }],
  };
  const ready = [draft('card-1', { imageAssetId: 'img-1', imageAssetBriefId: 'b1', headline: 'Keynotes' }), draft('card-2', { imageUrl: 'https://cdn/b.png' })];

  it.each([
    ['carousel', true, true, false],
    ['carousel', false, false, true],
    // Not read yet: held, never sent.
    ['carousel', null, false, true],
    ['single', true, false, false],
  ] as const)('format %s with the capability %s: chosen %s, unavailable %s', (format, enabled, chosen, unavailable) => {
    expect(metaCarouselChosen(format, enabled)).toBe(chosen);
    expect(metaCarouselUnavailable(format, enabled)).toBe(unavailable);
  });

  it.each([
    [true, true, true],
    // No images: no card could carry one, so the carousel is not offered.
    [true, false, false],
    [false, true, false],
    [true, null, null],
    [null, true, null],
    [null, null, null],
  ] as const)('carousel %s with images %s: offered %s', (carouselEnabled, creativeEnabled, offered) => {
    expect(metaCarouselOffered(carouselEnabled, creativeEnabled)).toBe(offered);
  });

  it.each([
    ['no variants: two empty cards and no message', [], 2, ['', ''], ''],
    ['one variant: its headline, then an empty card', [{ primaryText: 'Join', headline: 'A', description: 'd' }], 2, ['A', ''], 'Join'],
    ['twelve variants: the first ten', Array.from({ length: 12 }, (_, i) => ({ primaryText: '', headline: `H${i}` })), 10, ['H0', 'H1'], ''],
  ])('seeds %s', (_name, variants, count, headlines, message) => {
    const seed = metaCarouselSeed(variants);
    expect(seed.cards).toHaveLength(count);
    expect(seed.cards.slice(0, 2).map((c) => c.headline)).toEqual(headlines);
    expect(new Set(seed.cards.map((c) => c.key)).size).toBe(count);
    expect(seed.message).toBe(message);
  });

  it('sends card 1 the message and later cards none, each with one image', () => {
    const cards = [...ready, draft('card-3', { imageAssetId: 'img-1', imageAssetBriefId: 'b1', imageUrl: 'https://cdn/c.png', description: ' Talks ' })];
    expect(metaCarouselVariantsForCreate(cards, ' Join us ', ctx)).toEqual([
      { primaryText: 'Join us', headline: 'Keynotes', imageAssetId: 'img-1' },
      { primaryText: '', headline: '', imageUrl: 'https://cdn/b.png' },
      { primaryText: '', headline: '', description: 'Talks', imageAssetId: 'img-1' },
    ]);
  });

  it.each([
    ['uploads off: the URL only', { uploadAvailable: false }, [undefined, 'https://cdn/c.png']],
    ['images off: the stored image only', { creativeAvailable: false }, ['img-1', undefined]],
    ['another brief: the URL only', { briefId: 'b2' }, [undefined, 'https://cdn/c.png']],
  ])('picks the image a card can send, %s', (_name, overrides, [assetId, url]) => {
    const card = draft('card-1', { imageAssetId: 'img-1', imageAssetBriefId: 'b1', imageUrl: 'https://cdn/c.png' });
    const [sent] = metaCarouselVariantsForCreate([card], 'm', { ...ctx, ...overrides });
    expect([sent.imageAssetId, sent.imageUrl]).toEqual([assetId, url]);
  });

  it.each([
    ['ready cards', ready, 'Join us', null, null],
    ['no message', ready, ' ', null, "card 1's primary text, which is required"],
    ['one card', ready.slice(0, 1), 'Join us', null, '2 to 10 variants'],
    ['a card with no image', [ready[0], draft('card-2')], 'Join us', null, 'Card 2 of a carousel needs an image.'],
    ['a lead form', ready, 'Join us', '123', 'cannot use a lead form'],
    [
      'an image stored for another brief',
      [ready[0], draft('card-2', { imageAssetId: 'x', imageAssetBriefId: 'b2' })],
      'Join us',
      null,
      'choose another image for card 2',
    ],
    [
      'an image gone from the library',
      [ready[0], draft('card-2', { imageAssetId: 'gone', imageAssetBriefId: 'b1' })],
      'Join us',
      null,
      'choose another image for card 2',
    ],
  ])('holds Create for %s', (_name, cards, message, leadFormId, expected) => {
    const refusal = metaCarouselCreateRefusal(cards, message, library, ctx, leadFormId);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
    if (expected !== null) expect(refusal?.startsWith('Meta Ads: ')).toBe(true);
  });

  it('shows each card with its position, its image problem and its picker', () => {
    const [first, second] = metaCarouselCardViews([ready[0], draft('card-2', { imageAssetId: 'gone', imageAssetBriefId: 'b1' })], library, 'b1');
    expect(first).toMatchObject({ position: 1, imageProblem: '' });
    expect(first.imageOptions.map((o) => o.value)).toEqual(['', 'img-1']);
    expect(second.imageProblem).toContain('No longer');
    expect(second.imageOptions.map((o) => o.value)).toEqual(['', 'gone', 'img-1']);
    expect(metaCarouselCardViews([draft('card-1')], { status: 'loading', assets: [] }, 'b1')[0].imageOptions).toEqual([]);
  });
});
