// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CAROUSEL_LIMITS } from '../constants/campaign.constants';
import type {
  CreativeAssetLibraryState,
  LinkedInCampaignCreateRequest,
  LinkedInCarouselCard,
  LinkedInCarouselCardDraft,
  LinkedInCarouselCardView,
  LinkedInCarouselImageOption,
  StoredCreativeAsset,
} from '../interfaces/campaign.interface';
import { linkedInCarouselDestinationProblem, linkedInCarouselRefusal } from './campaign-linkedin-carousel.utils';
import { goTrimSpace, linkedInCreativeTextLength } from './campaign-linkedin.utils';
import { storedCreativeAssetLabel } from './campaign-google-creative.utils';

/**
 * The Implement tab's LinkedIn carousel rules (linuxfoundation/lfx-v2-campaign-service#665): the cards as the editor
 * shows them, the image each may pick from the brief's library, the request a carousel create sends, and why Create
 * waits. The same rules the create route holds a request to (`linkedInCarouselRefusal`), so Create is held rather than
 * refused.
 */

/** A new empty card, keyed after the highest `card-<n>` already in `cards`. */
export function newLinkedInCarouselCardDraft(cards: readonly LinkedInCarouselCardDraft[]): LinkedInCarouselCardDraft {
  const next = cards.reduce((max, card) => Math.max(max, Number(/^card-(\d+)$/.exec(card.key)?.[1] ?? 0)), 0) + 1;
  return { key: `card-${next}`, imageAssetId: '', imageAssetBriefId: '', headline: '', destinationUrl: '' };
}

/** `cards` with the card `key` moved one place up (`-1`) or down (`1`); unchanged at either end. */
export function moveLinkedInCarouselCard(cards: readonly LinkedInCarouselCardDraft[], key: string, step: -1 | 1): LinkedInCarouselCardDraft[] {
  const from = cards.findIndex((card) => card.key === key);
  const to = from + step;
  if (from === -1 || to < 0 || to >= cards.length) return [...cards];
  const out = [...cards];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

/**
 * Why a stored image cannot be a carousel card, or `''`, from what the library recorded: not exactly square (decision
 * 2026-11-25), a side over 4320 pixels, or over 10 MB. An image whose size was never recorded passes here, and
 * campaign-service reads the image itself and refuses it by name before anything is created.
 */
export function linkedInCarouselImageMisfit(asset: Pick<StoredCreativeAsset, 'width' | 'height' | 'byteSize'>): string {
  const { width, height } = asset;
  if (width && height && width !== height) return `This image is ${width}x${height}. A LinkedIn carousel card needs a square (1:1) image.`;
  if (width && height && Math.max(width, height) > LINKEDIN_CAROUSEL_LIMITS.imageMaxSide) {
    return `This image is ${width}x${height}. LinkedIn carousel images can be at most ${LINKEDIN_CAROUSEL_LIMITS.imageMaxSide}x${LINKEDIN_CAROUSEL_LIMITS.imageMaxSide}.`;
  }
  if (asset.byteSize > LINKEDIN_CAROUSEL_LIMITS.imageBytes) return 'This image is over 10 MB, the most LinkedIn takes for a carousel card.';
  return '';
}

/**
 * What is wrong with the card's picked image, or `''`. Judged against the library only once it was read, and against the
 * brief only while its id is known: the tab has none while a save runs, which is no evidence of another brief.
 */
function cardImageProblem(card: LinkedInCarouselCardDraft, library: CreativeAssetLibraryState, briefId: string): string {
  if (card.imageAssetId === '' || briefId === '') return '';
  if (card.imageAssetBriefId !== briefId) return "Stored for a different brief. Choose an image from this brief's library.";
  if (library.status !== 'ready') return '';
  const asset = library.assets.find((stored) => stored.id === card.imageAssetId);
  if (!asset) return "No longer in the brief's library. Choose another image.";
  return linkedInCarouselImageMisfit(asset);
}

/**
 * The images a card's picker offers: every image stored for the brief, a misfit one marked so it can still be picked and
 * explained, and a held image the library does not list kept by id. While an image is held, a first "No image" option
 * (value `''`) clears it: the select does not re-emit the value it holds, so without it an image held for another brief
 * could not be picked again when it is the only one.
 */
export function linkedInCarouselImageOptions(library: CreativeAssetLibraryState, held: string): LinkedInCarouselImageOption[] {
  const options = library.assets.map((asset) => {
    const label = storedCreativeAssetLabel(asset);
    return { value: asset.id, label: linkedInCarouselImageMisfit(asset) === '' ? label : `${label} (not usable)` };
  });
  if (held !== '' && !library.assets.some((asset) => asset.id === held)) options.unshift({ value: held, label: `Stored image ${held.slice(0, 8)}` });
  if (held !== '') options.unshift({ value: '', label: 'No image (choose again)' });
  return options;
}

/** Why the card pickers offer nothing, or `''`. The library is not read (`idle`) while the brief is unsaved. */
export function linkedInCarouselImagesNote(library: CreativeAssetLibraryState): string {
  switch (library.status) {
    case 'idle':
      return 'Save the brief to pick or upload its images.';
    case 'loading':
      return "Loading the brief's images…";
    case 'error':
      return "Couldn't load the brief's images. Upload them again, or reload the page.";
    case 'ready':
      return library.assets.length === 0 ? 'No images are stored for this brief yet. Upload square images to pick from.' : '';
  }
}

/** Each card as the editor shows it: its counter, the error under each field, and the image picker's options. */
export function linkedInCarouselCardViews(
  cards: readonly LinkedInCarouselCardDraft[],
  library: CreativeAssetLibraryState,
  briefId: string
): LinkedInCarouselCardView[] {
  return cards.map((card, index) => {
    const headlineLength = linkedInCreativeTextLength(card.headline);
    let headlineError = '';
    if (headlineLength > LINKEDIN_CAROUSEL_LIMITS.headline) headlineError = `Keep the headline to ${LINKEDIN_CAROUSEL_LIMITS.headline} characters.`;
    const destination = goTrimSpace(card.destinationUrl);
    const problem = destination === '' ? null : linkedInCarouselDestinationProblem(destination);
    return {
      ...card,
      position: index + 1,
      headlineLength,
      headlineError,
      destinationError: problem === null ? '' : `The link ${problem}.`,
      imageProblem: cardImageProblem(card, library, briefId),
      imageOptions: linkedInCarouselImageOptions(library, card.imageAssetId),
    };
  });
}

/**
 * The request fields a carousel create sends: the format, the intro text and each card in order with its image (only one
 * stored for the open brief), headline and link (only when one was typed; omitted it is the registration URL), and no
 * variants. No `utm_content`: campaign-service tags each card's link `card-<k>` itself.
 */
export function linkedInCarouselFieldsForCreate(
  cards: readonly LinkedInCarouselCardDraft[],
  introText: string,
  briefId: string
): Pick<LinkedInCampaignCreateRequest, 'format' | 'carouselCards' | 'carouselIntroText' | 'variants'> {
  const carouselCards = cards.map((card): LinkedInCarouselCard => {
    const out: LinkedInCarouselCard = { imageAssetId: card.imageAssetBriefId === briefId ? card.imageAssetId : '', headline: card.headline };
    const destination = goTrimSpace(card.destinationUrl);
    if (destination !== '') out.destinationUrl = destination;
    return out;
  });
  return { format: 'carousel', carouselIntroText: introText, carouselCards, variants: [] };
}

/**
 * Why a carousel create waits, or `null`: no brief id (the cards' images are the saved brief's), then a picked image that
 * cannot be used (the message is under the card), then the request the tab would send checked by
 * `linkedInCarouselRefusal`, as the create route will. A save in flight is the caller's to hold first.
 */
export function linkedInCarouselCreateRefusal(
  cards: readonly LinkedInCarouselCardDraft[],
  introText: string,
  library: CreativeAssetLibraryState,
  briefId: string
): string | null {
  if (briefId === '') return "LinkedIn Ads: save the brief, so the carousel cards can use its library's images.";
  const misfit = linkedInCarouselCardViews(cards, library, briefId).find((view) => view.imageProblem !== '');
  if (misfit) return `LinkedIn Ads: choose another image for card ${misfit.position}.`;
  const refused = linkedInCarouselRefusal(linkedInCarouselFieldsForCreate(cards, introText, briefId), true);
  return refused === null ? null : `LinkedIn Ads: ${refused.message}`;
}

/**
 * A draft's stored cards, kept only where the card has a key not seen before (the editor tracks cards by it), with every
 * field as text: a draft is replayed from stored JSON whose inner shape is not validated.
 */
export function linkedInCarouselCardsFromStored(stored: unknown): LinkedInCarouselCardDraft[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const seen = new Set<string>();
  return stored
    .filter((card): card is Record<string, unknown> => {
      const key = card !== null && typeof card === 'object' ? (card as Record<string, unknown>)['key'] : undefined;
      if (typeof key !== 'string' || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((card) => ({
      key: card['key'] as string,
      imageAssetId: text(card['imageAssetId']),
      imageAssetBriefId: text(card['imageAssetBriefId']),
      headline: text(card['headline']),
      destinationUrl: text(card['destinationUrl']),
    }));
}
