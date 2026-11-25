// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CreativeAssetLibraryState, LinkedInCarouselCardDraft, StoredCreativeAsset } from '../interfaces/campaign.interface';
import {
  linkedInCarouselCardViews,
  linkedInCarouselCreateRefusal,
  linkedInCarouselFieldsForCreate,
  linkedInCarouselImageMisfit,
  linkedInCarouselImageOptions,
  linkedInCarouselImagesNote,
  moveLinkedInCarouselCard,
  newLinkedInCarouselCardDraft,
} from './campaign-linkedin-carousel-form.utils';

const SQUARE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const WIDE = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
const asset = (id: string, width?: number, height?: number, byteSize = 1000): StoredCreativeAsset => ({
  id,
  projectId: 'tlf',
  briefId: 'b1',
  mimeType: 'image/png',
  byteSize,
  checksum: 'c',
  width,
  height,
});
const ready: CreativeAssetLibraryState = { status: 'ready', assets: [asset(SQUARE, 1080, 1080), asset(WIDE, 1200, 628)] };
const card = (fields: Partial<LinkedInCarouselCardDraft> = {}): LinkedInCarouselCardDraft => ({
  key: 'card-1',
  imageAssetId: SQUARE,
  imageAssetBriefId: 'b1',
  headline: 'Keynote',
  destinationUrl: '',
  ...fields,
});
const two = (first: Partial<LinkedInCarouselCardDraft> = {}) => [card(first), card({ key: 'card-2' })];

describe('linkedInCarouselImageMisfit', () => {
  it.each([
    [asset(SQUARE, 1080, 1080), ''],
    // Not recorded: campaign-service reads the image and refuses it by name.
    [asset(SQUARE), ''],
    [asset(WIDE, 1200, 628), 'square (1:1)'],
    [asset(SQUARE, 5000, 5000), 'at most 4320x4320'],
    [asset(SQUARE, 1080, 1080, 10_000_001), 'over 10 MB'],
  ])('judges %o', (stored, problem) => {
    const misfit = linkedInCarouselImageMisfit(stored);
    expect(problem === '' ? misfit === '' : misfit.includes(problem)).toBe(true);
  });
});

describe('linkedInCarouselCardViews', () => {
  it.each([
    ['a square image of the brief', card(), ready, ''],
    ['a wide image', card({ imageAssetId: WIDE }), ready, '1200x628'],
    ['an image of another brief', card({ imageAssetBriefId: 'b0' }), ready, 'different brief'],
    ['an image the library no longer lists', card({ imageAssetId: 'gone' }), ready, 'No longer'],
    // A library not read yet is no evidence the image is gone or misshapen.
    ['an image while the library loads', card({ imageAssetId: WIDE }), { status: 'loading', assets: [] } as CreativeAssetLibraryState, ''],
  ])('names the image problem of %s', (_name, draft, library, problem) => {
    const view = linkedInCarouselCardViews([draft], library, 'b1')[0];
    expect(problem === '' ? view.imageProblem === '' : view.imageProblem.includes(problem)).toBe(true);
  });

  it('counts the headline as campaign-service does and checks the link', () => {
    const [view] = linkedInCarouselCardViews([card({ headline: `${'h'.repeat(22)}—${'h'.repeat(22)}`, destinationUrl: 'events.example.org' })], ready, 'b1');
    expect(view.headlineLength).toBe(46);
    expect(view.headlineError).toContain('45 characters');
    expect(view.destinationError).toContain('full http');
  });
});

describe('linkedInCarouselImageOptions', () => {
  it('offers every image, marking a misfit, and no clear option while nothing is held', () => {
    expect(linkedInCarouselImageOptions(ready, '').map((o) => [o.value, o.label.endsWith('(not usable)')])).toEqual([
      [SQUARE, false],
      [WIDE, true],
    ]);
  });

  it('keeps a held image the library does not list, after a clear option, so a single option is still clearable', () => {
    expect(linkedInCarouselImageOptions({ status: 'ready', assets: [] }, 'held-id').map((o) => o.value)).toEqual(['', 'held-id']);
  });
});

describe('linkedInCarouselImagesNote', () => {
  it.each([
    [{ status: 'idle', assets: [] }, 'Save the brief'],
    [{ status: 'error', assets: [] }, "Couldn't load"],
    [{ status: 'ready', assets: [] }, 'No images are stored'],
    [ready, ''],
  ] as [CreativeAssetLibraryState, string][])('explains a %o library', (library, note) => {
    const text = linkedInCarouselImagesNote(library);
    expect(note === '' ? text === '' : text.includes(note)).toBe(true);
  });
});

describe('linkedInCarouselFieldsForCreate', () => {
  it('sends the format, intro and cards in order with no variants, a link only when typed, and an image only of the open brief', () => {
    const fields = linkedInCarouselFieldsForCreate(
      [card({ destinationUrl: ' https://events.example.org/a ' }), card({ key: 'card-2', imageAssetBriefId: 'b0' })],
      'Meet the speakers',
      'b1'
    );
    expect(fields).toEqual({
      format: 'carousel',
      carouselIntroText: 'Meet the speakers',
      carouselCards: [
        { imageAssetId: SQUARE, headline: 'Keynote', destinationUrl: 'https://events.example.org/a' },
        { imageAssetId: '', headline: 'Keynote' },
      ],
      variants: [],
    });
  });
});

describe('linkedInCarouselCreateRefusal', () => {
  it.each([
    ['two good cards', two(), 'Intro', null],
    ['a wide image', two({ imageAssetId: WIDE }), 'Intro', 'choose another image for card 1'],
    ['a card with no image', two({ imageAssetId: '', imageAssetBriefId: '' }), 'Intro', 'Card 1 needs an image'],
    ['one card', [card()], 'Intro', '2 to 10 cards'],
    ['no intro', two(), ' ', 'intro text'],
    ['a long headline', two({ headline: 'h'.repeat(46) }), 'Intro', 'at most 45'],
  ])('holds %s', (_name, cards, intro, message) => {
    const refusal = linkedInCarouselCreateRefusal(cards, intro, ready, 'b1');
    if (message === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(message);
  });
});

describe('newLinkedInCarouselCardDraft and moveLinkedInCarouselCard', () => {
  it('keys a new card after the highest one, and moves a card within the list', () => {
    expect(newLinkedInCarouselCardDraft([card({ key: 'card-4' }), card({ key: 'card-2' })]).key).toBe('card-5');
    const cards = [card({ key: 'a' }), card({ key: 'b' }), card({ key: 'c' })];
    expect(moveLinkedInCarouselCard(cards, 'c', -1).map((c) => c.key)).toEqual(['a', 'c', 'b']);
    expect(moveLinkedInCarouselCard(cards, 'a', -1).map((c) => c.key)).toEqual(['a', 'b', 'c']);
  });
});
