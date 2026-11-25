// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInCarouselDestinationProblem, linkedInCarouselRefusal } from './campaign-linkedin-carousel.utils';
import { linkedInConfigKeyRefusal } from './campaign-linkedin-config.utils';

const A = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const B = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
const card = (fields: Record<string, unknown> = {}) => ({ imageAssetId: A, headline: 'Keynote', ...fields });
const carousel = (fields: Record<string, unknown> = {}) => ({
  format: 'carousel',
  carouselIntroText: 'Meet the speakers',
  carouselCards: [card(), card({ imageAssetId: B })],
  variants: [],
  ...fields,
});

describe('linkedInCarouselRefusal', () => {
  it.each([
    ['no carousel field, on a deployment without carousels', { format: 'single_image', variants: [] }, false],
    // campaign-service reads "" as omitted.
    ['an empty intro text without the format, on a deployment without carousels', { carouselIntroText: '' }, false],
    ['two cards', carousel(), true],
    [
      'ten cards, each with a link',
      carousel({ carouselCards: Array.from({ length: 10 }, () => card({ destinationUrl: 'https://events.example.org/a?b=c' })) }),
      true,
    ],
    [
      'a 45-character headline and a 255-character intro',
      carousel({ carouselIntroText: 'i'.repeat(255), carouselCards: [card({ headline: 'h'.repeat(45) }), card()] }),
      true,
    ],
    // A dash becomes ", " before it is counted, as campaign-service normalizes it.
    ['a headline of 43 characters and a dash', carousel({ carouselCards: [card({ headline: `${'h'.repeat(43)}—` }), card()] }), true],
    ['a blank destination, which is the registration URL', carousel({ carouselCards: [card({ destinationUrl: '  ' }), card()] }), true],
    ['not an object', null, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInCarouselRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['the format without the flag', carousel(), false, 'format', 'cannot create LinkedIn carousel ads'],
    ['cards without the flag', { carouselCards: [] }, false, 'carouselCards', 'cannot create LinkedIn carousel ads'],
    ['an intro without the flag', { carouselIntroText: 'Hi' }, false, 'carouselIntroText', 'cannot create LinkedIn carousel ads'],
    ['a null intro', carousel({ carouselIntroText: null }), true, 'carouselIntroText', 'as text'],
    ['null cards', carousel({ carouselCards: null }), true, 'carouselCards', 'as a list'],
    ['a card that is not an object', carousel({ carouselCards: ['x', card()] }), true, 'carouselCards', 'as a list'],
    ['a null headline', carousel({ carouselCards: [card({ headline: null }), card()] }), true, 'carouselCards', 'as a list'],
    ['a number link', carousel({ carouselCards: [card({ destinationUrl: 7 }), card()] }), true, 'carouselCards', 'as a list'],
    ['cards without the format', { carouselCards: [card(), card()] }, true, 'carouselCards', 'only with the carousel format'],
    ['an intro with the single image format', { format: 'single_image', carouselIntroText: 'Hi' }, true, 'carouselIntroText', 'only with the carousel format'],
    ['text ads beside the cards', carousel({ textAds: [] }), true, 'textAds', 'text ad format'],
    ['a null text ads list beside the cards', carousel({ textAds: null }), true, 'textAds', 'text ad format'],
    [
      'single image or video ads beside the cards',
      carousel({ variants: [{ introText: 'a', headline: 'b', videoAssetId: A }] }),
      true,
      'variants',
      'Send no single image or video ads',
    ],
    ['the lead generation objective', carousel({ objective: 'lead_generation' }), true, 'objective', 'cannot be carousels'],
    ['one card', carousel({ carouselCards: [card()] }), true, 'carouselCards', '2 to 10 cards'],
    ['eleven cards', carousel({ carouselCards: Array.from({ length: 11 }, () => card()) }), true, 'carouselCards', '2 to 10 cards'],
    ['no cards', { format: 'carousel', carouselIntroText: 'Hi', variants: [] }, true, 'carouselCards', '2 to 10 cards'],
    ['a dash-only intro', carousel({ carouselIntroText: ' — ' }), true, 'carouselIntroText', 'Enter the carousel intro text'],
    ['a 256-character intro', carousel({ carouselIntroText: 'i'.repeat(256) }), true, 'carouselIntroText', 'at most 255'],
    [
      'a card without an image',
      carousel({ carouselCards: [card(), card({ imageAssetId: ' ' })] }),
      true,
      'carouselCards[1].imageAssetId',
      'Card 2 needs an image',
    ],
    [
      'an image that is not an asset id',
      carousel({ carouselCards: [card({ imageAssetId: 'urn:li:image:C4E' }), card()] }),
      true,
      'carouselCards[0].imageAssetId',
      'stored for this brief',
    ],
    ['a blank headline', carousel({ carouselCards: [card({ headline: '\u0085' }), card()] }), true, 'carouselCards[0].headline', "card 1's headline"],
    ['a 46-character headline', carousel({ carouselCards: [card({ headline: 'h'.repeat(46) }), card()] }), true, 'carouselCards[0].headline', 'at most 45'],
    [
      'a link that is not http(s)',
      carousel({ carouselCards: [card({ destinationUrl: 'ftp://events.example.org' }), card()] }),
      true,
      'carouselCards[0].destinationUrl',
      'full http',
    ],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInCarouselRefusal(raw, enabled);
    expect(refusal?.field).toBe(`linkedInConfig.${field}`);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    const refusal = linkedInCarouselRefusal(carousel({ carouselCards: [card({ imageAssetId: 'SECRET_ID' }), card()] }), true);
    expect(refusal?.message).not.toContain('SECRET_ID');
  });

  it('refuses a card key the create does not send, spelled differently or unknown', () => {
    expect(linkedInConfigKeyRefusal(carousel({ carouselCards: [card({ DestinationUrl: 'https://a.example' }), card()] }))?.field).toBe(
      'linkedInConfig.carouselCards[0].destinationUrl'
    );
    expect(linkedInConfigKeyRefusal(carousel({ carouselCards: [card(), card({ utm_content: 'x' })] }))?.field).toBe('linkedInConfig.carouselCards[1]');
    expect(linkedInConfigKeyRefusal(carousel())).toBeNull();
  });
});

describe('linkedInCarouselDestinationProblem', () => {
  it.each(['https://events.example.org', 'HTTP://events.example.org:8080/a?x=1&y=%20#top', ' https://events.example.org/schedule '])('accepts %s', (url) => {
    expect(linkedInCarouselDestinationProblem(url)).toBeNull();
  });

  it.each([
    ['events.example.org', 'full http'],
    ['https://', 'full http'],
    ['https://:443/a', 'full http'],
    ['javascript:alert(1)', 'full http'],
    ['https://user:pw@events.example.org', 'user name or password'],
    ['https://events.example.org/?a=%zz', 'malformed query'],
    ['https://events.example.org/?a=1;b=2', 'malformed query'],
    [`https://events.example.org/${'p'.repeat(2000)}`, 'at most 2000'],
  ])('refuses %s', (url, problem) => {
    expect(linkedInCarouselDestinationProblem(url)).toContain(problem);
  });
});
