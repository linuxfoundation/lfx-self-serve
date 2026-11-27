// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  META_AD_FORMATS,
  META_CAROUSEL_MAX_CARDS,
  META_CAROUSEL_MIN_CARDS,
  META_CAROUSEL_OFF_MESSAGE,
  META_CHAR_LIMITS,
} from '../constants/campaign.constants';
import type {
  CreativeAssetLibraryState,
  LinkedInCarouselImageOption,
  MetaAdFormat,
  MetaAdVariant,
  MetaCarouselCardDraft,
  MetaCarouselCardView,
  MetaCarouselImageContext,
  MetaConfigRefusal,
} from '../interfaces/campaign.interface';
import { storedCreativeAssetLabel } from './campaign-google-creative.utils';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * Meta carousel ads (#6331): `metaConfig.format`, and a carousel's cards in `metaConfig.variants`. One set of rules for
 * the create route (which answers a refusal with a 400), mirroring campaign-service's `checkMetaFormat`,
 * `meta.NormalizeFormat`, `meta.CheckCarouselLeadForm` and `meta.ValidateCarousel` (campaign-service#550 gap 10, v1.0.44),
 * in their order. No message repeats what the caller sent: a card is named by its position only.
 */

/** A non-blank string, trimmed, as campaign-service's `strings.TrimSpace(...) != ""`. */
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** `format` trimmed and lower-cased, as `meta.NormalizeFormat` reads it; blank for an absent or blank one. */
function normalizedFormat(raw: Record<string, unknown> | undefined): string {
  const format = raw?.['format'];
  return typeof format === 'string' ? format.trim().toLowerCase() : '';
}

/**
 * Why `raw`'s format cannot be sent, or `null`. `carouselEnabled` is `canSetMetaCarousel()`. In campaign-service's order:
 *
 * 1. a `format` of another JSON type than text (null is absent);
 * 2. while carousel ads are off, any format but blank or single, with a message that names no format;
 * 3. a format other than single or carousel;
 * 4. for a carousel: a `leadFormId`; then 2 to 10 variants; variant 1's `primaryText` (the one message); then per card,
 *    in order, no video, an image (`imageUrl` or `imageAssetId`), and a `primaryText` empty or identical to card 1's.
 */
export function metaCarouselRefusal(raw: unknown, carouselEnabled: boolean): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const format = record?.['format'];
  if (format !== undefined && format !== null && typeof format !== 'string') {
    return { field: 'metaConfig.format', message: 'The Meta ad format must be text.' };
  }
  const value = normalizedFormat(record);
  if (value === '' || value === 'single') return null;
  if (!carouselEnabled) return { field: 'metaConfig.format', message: META_CAROUSEL_OFF_MESSAGE };
  if (value !== 'carousel') return { field: 'metaConfig.format', message: `The Meta ad format must be one of ${META_AD_FORMATS.join(', ')}.` };

  if (hasText(record?.['leadFormId'])) {
    return { field: 'metaConfig.format', message: 'A carousel ad cannot use a lead form. Create single-image ads, or remove the lead form.' };
  }
  const cards: unknown = record?.['variants'];
  const variants: unknown[] = Array.isArray(cards) ? cards : [];
  if (variants.length < META_CAROUSEL_MIN_CARDS || variants.length > META_CAROUSEL_MAX_CARDS) {
    return { field: 'metaConfig.format', message: `A carousel needs ${META_CAROUSEL_MIN_CARDS} to ${META_CAROUSEL_MAX_CARDS} variants, one per card.` };
  }
  const first = metaConfigRecord(variants[0])?.['primaryText'];
  if (!hasText(first)) {
    return { field: 'metaConfig.variants[0].primaryText', message: "A carousel's message is card 1's primary text, which is required." };
  }
  const message = first.trim();
  for (const [i, entry] of variants.entries()) {
    const card = metaConfigRecord(entry);
    if (hasText(card?.['videoAssetId'])) {
      return { field: `metaConfig.variants[${i}].videoAssetId`, message: `Card ${i + 1} of a carousel carries an image, not a video.` };
    }
    if (!hasText(card?.['imageUrl']) && !hasText(card?.['imageAssetId'])) {
      return { field: `metaConfig.variants[${i}]`, message: `Card ${i + 1} of a carousel needs an image.` };
    }
    const text = card?.['primaryText'];
    if (i > 0 && hasText(text) && text.trim() !== message) {
      return {
        field: `metaConfig.variants[${i}].primaryText`,
        message: `A carousel has one message, card 1's primary text. Leave card ${i + 1}'s primary text empty or make it identical.`,
      };
    }
  }
  return null;
}

/**
 * The `format` a create sends for an ACCEPTED config ({@link metaCarouselRefusal} is `null`): the normalized value, or
 * `null` to send none for an absent or blank one (campaign-service reads that as single).
 */
export function metaAdFormatToSend(raw: unknown): MetaAdFormat | null {
  const value = normalizedFormat(metaConfigRecord(raw));
  return (META_AD_FORMATS as readonly string[]).includes(value) ? (value as MetaAdFormat) : null;
}

/*
 * The Implement tab's carousel (#6331): whether it is chosen and sent, the cards the editor starts from and shows, what a
 * create sends, why Create waits, and a stored draft's cards. Create is held to `metaCarouselRefusal`, as the create
 * route holds it.
 */

/** Whether this create is a carousel: chosen, and offered on an explicit yes (`CampaignListResult.metaCarouselEnabled`). */
export function metaCarouselChosen(format: MetaAdFormat, enabled: boolean | null): boolean {
  return format === 'carousel' && enabled === true;
}

/** Whether a carousel is chosen while this deployment does not offer it (off, or not read yet): Create is held, never sent as single ads. */
export function metaCarouselUnavailable(format: MetaAdFormat, enabled: boolean | null): boolean {
  return format === 'carousel' && enabled !== true;
}

/**
 * Whether this deployment offers a Meta carousel: its own capability AND the Meta image capability, since every card
 * needs an image and none can carry one without it. An explicit no from either is no; both unread or one unread is
 * `null` (not yet known), so a restored carousel is held rather than sent or offered.
 */
export function metaCarouselOffered(carouselEnabled: boolean | null, creativeEnabled: boolean | null): boolean | null {
  if (carouselEnabled === false || creativeEnabled === false) return false;
  if (carouselEnabled === true && creativeEnabled === true) return true;
  return null;
}

/** A new empty card, keyed after the highest `card-<n>` already in `cards`. */
export function newMetaCarouselCardDraft(cards: readonly MetaCarouselCardDraft[]): MetaCarouselCardDraft {
  const next = cards.reduce((max, card) => Math.max(max, Number(/^card-(\d+)$/.exec(card.key)?.[1] ?? 0)), 0) + 1;
  return { key: `card-${next}`, imageAssetId: '', imageAssetBriefId: '', imageUrl: '', headline: '', description: '' };
}

/**
 * The cards and message a first switch to carousel starts from: a card per brief variant (its headline and description),
 * at most 10 and padded with empty cards to 2, and the first variant's primary text as the one message.
 */
export function metaCarouselSeed(variants: readonly MetaAdVariant[]): { cards: MetaCarouselCardDraft[]; message: string } {
  const cards: MetaCarouselCardDraft[] = [];
  for (const variant of variants.slice(0, META_CAROUSEL_MAX_CARDS)) {
    cards.push({ ...newMetaCarouselCardDraft(cards), headline: variant.headline ?? '', description: variant.description ?? '' });
  }
  while (cards.length < META_CAROUSEL_MIN_CARDS) cards.push(newMetaCarouselCardDraft(cards));
  return { cards, message: variants.find((variant) => hasText(variant.primaryText))?.primaryText ?? '' };
}

/**
 * The stored images a card's picker offers, a held image the library does not list kept by id, and, while one is held, a
 * first "No image" option (`''`) that clears it.
 */
function metaCarouselImageOptions(library: CreativeAssetLibraryState, held: string): LinkedInCarouselImageOption[] {
  const options = library.assets.map((asset) => ({ value: asset.id, label: storedCreativeAssetLabel(asset) }));
  if (held !== '' && !library.assets.some((asset) => asset.id === held)) options.unshift({ value: held, label: `Stored image ${held.slice(0, 8)}` });
  if (held !== '') options.unshift({ value: '', label: 'No image (choose again)' });
  return options;
}

/** Why a card's picked image cannot be sent, or `''`: stored for another brief, or no longer in a library that was read. */
function metaCarouselImageProblem(card: MetaCarouselCardDraft, library: CreativeAssetLibraryState, briefId: string): string {
  if (card.imageAssetId === '' || briefId === '') return '';
  if (card.imageAssetBriefId !== briefId) return "Stored for a different brief. Choose an image from this brief's library.";
  if (library.status === 'ready' && !library.assets.some((asset) => asset.id === card.imageAssetId))
    return "No longer in the brief's library. Choose another image.";
  return '';
}

/** Each card as the editor shows it. */
export function metaCarouselCardViews(cards: readonly MetaCarouselCardDraft[], library: CreativeAssetLibraryState, briefId: string): MetaCarouselCardView[] {
  return cards.map((card, index) => ({
    ...card,
    position: index + 1,
    imageProblem: metaCarouselImageProblem(card, library, briefId),
    imageOptions: metaCarouselImageOptions(library, card.imageAssetId),
  }));
}

/**
 * The cards as `metaConfig.variants`, in order: card 1 carries the one message as its primary text and later cards none;
 * each its headline, its description when one was typed, and ONE image: a stored image picked for the open brief while
 * uploads are offered, else its pasted URL while images are, never both (campaign-service refuses the two).
 */
export function metaCarouselVariantsForCreate(cards: readonly MetaCarouselCardDraft[], message: string, context: MetaCarouselImageContext): MetaAdVariant[] {
  return cards.map((card, index) => {
    const variant: MetaAdVariant = { primaryText: index === 0 ? message.trim() : '', headline: card.headline.trim() };
    if (hasText(card.description)) variant.description = card.description.trim();
    const stored = context.uploadAvailable && context.briefId !== '' && card.imageAssetId !== '' && card.imageAssetBriefId === context.briefId;
    if (stored) variant.imageAssetId = card.imageAssetId;
    else if (context.creativeAvailable && hasText(card.imageUrl)) variant.imageUrl = card.imageUrl.trim();
    return variant;
  });
}

/**
 * Why a carousel create waits, or `null`: a picked image that cannot be sent (the message is under the card), only while
 * stored images can be sent at all; then the request the tab would send, with the lead form it would carry, checked by
 * `metaCarouselRefusal` as the create route will; then, as campaign-service's `CreateCampaign` checks every variant after
 * the carousel's own rules (`internal/platform/meta/client.go`, v1.0.44), each card's headline (required), then each
 * card's lengths in order: the message (`META_CHAR_LIMITS.primaryText`, card 1's), headline and description. A card is
 * named by its position only.
 */
export function metaCarouselCreateRefusal(
  cards: readonly MetaCarouselCardDraft[],
  message: string,
  library: CreativeAssetLibraryState,
  context: MetaCarouselImageContext,
  leadFormId: string | null
): string | null {
  // Without uploads only a card's URL is sent, and its picker is hidden: a stored pick is not a reason to wait.
  const misfit = context.uploadAvailable ? metaCarouselCardViews(cards, library, context.briefId).find((view) => view.imageProblem !== '') : undefined;
  if (misfit) return `Meta Ads: choose another image for card ${misfit.position}.`;
  const variants = metaCarouselVariantsForCreate(cards, message, context);
  const request = { format: 'carousel', variants, ...(leadFormId ? { leadFormId } : {}) };
  const refused = metaCarouselRefusal(request, true);
  if (refused !== null) return `Meta Ads: ${refused.message}`;
  const blank = variants.findIndex((variant) => variant.headline === '');
  if (blank !== -1) return `Meta Ads: give card ${blank + 1} a headline.`;
  // Then each card's copy lengths, counted by code point (Go's RuneCountInString), in campaign-service's order.
  for (const [index, variant] of variants.entries()) {
    const card = index + 1;
    if ([...variant.primaryText].length > META_CHAR_LIMITS.primaryText) return `Meta Ads: keep the message to ${META_CHAR_LIMITS.primaryText} characters.`;
    if ([...variant.headline].length > META_CHAR_LIMITS.headline) return `Meta Ads: keep card ${card}'s headline to ${META_CHAR_LIMITS.headline} characters.`;
    if ([...(variant.description ?? '')].length > META_CHAR_LIMITS.description) {
      return `Meta Ads: keep card ${card}'s description to ${META_CHAR_LIMITS.description} characters.`;
    }
  }
  return null;
}

/** A stored draft's format, or `undefined` for none or one this tab does not know. */
export function metaFormatFromStored(stored: unknown): MetaAdFormat | undefined {
  return (META_AD_FORMATS as readonly unknown[]).includes(stored) ? (stored as MetaAdFormat) : undefined;
}

/** A stored draft's cards, each with a key not seen before and every field as text: a draft is replayed from unvalidated JSON. */
export function metaCarouselCardsFromStored(stored: unknown): MetaCarouselCardDraft[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const seen = new Set<string>();
  const cards: MetaCarouselCardDraft[] = [];
  for (const entry of stored) {
    const card = metaConfigRecord(entry);
    const key = card?.['key'];
    if (card === undefined || typeof key !== 'string' || seen.has(key)) continue;
    seen.add(key);
    cards.push({
      key,
      imageAssetId: text(card['imageAssetId']),
      imageAssetBriefId: text(card['imageAssetBriefId']),
      imageUrl: text(card['imageUrl']),
      headline: text(card['headline']),
      description: text(card['description']),
    });
  }
  return cards;
}
