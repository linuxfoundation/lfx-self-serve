// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_CAROUSEL_OFF_MESSAGE } from '../constants/campaign.constants';
import { metaAdFormatToSend, metaCarouselRefusal } from './campaign-meta-carousel.utils';

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
