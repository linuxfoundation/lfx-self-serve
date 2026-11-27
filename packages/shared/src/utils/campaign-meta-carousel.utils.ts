// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { META_AD_FORMATS, META_CAROUSEL_MAX_CARDS, META_CAROUSEL_MIN_CARDS, META_CAROUSEL_OFF_MESSAGE } from '../constants/campaign.constants';
import type { MetaAdFormat, MetaConfigRefusal } from '../interfaces/campaign.interface';
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
