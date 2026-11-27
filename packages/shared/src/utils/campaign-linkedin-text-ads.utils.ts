// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_AD_FORMATS, LINKEDIN_IMAGE_URN_PATTERN, LINKEDIN_TEXT_AD_LIMITS, LINKEDIN_TEXT_AD_REQUEST_KEYS } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * LinkedIn Text Ads (#5764 row 19), mirroring campaign-service's checks (`linkedinFormat` and `checkFormatShape` in
 * `internal/dispatch/linkedin_text_ads.go`, `ValidateTextAds` in `internal/platform/linkedin/text_ads.go`, #586), so a
 * create campaign-service would refuse is refused here first, with a field to point at.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Why text ad `index` cannot be sent, or `null`. Every field must be text; a key outside the four is left to `linkedInConfigKeyRefusal`. */
function textAdRefusal(item: unknown, index: number): LinkedInConfigKeyRefusal | null {
  const path = `linkedInConfig.textAds[${index}]`;
  const ad = plainRecord(item);
  if (!ad) return { field: path, message: `Text ad ${index + 1} must be an object with a headline and a description.` };
  for (const key of LINKEDIN_TEXT_AD_REQUEST_KEYS) {
    if (key in ad && typeof ad[key] !== 'string') return { field: `${path}.${key}`, message: `Text ad ${index + 1}'s ${key} must be text.` };
  }
  const fields = [
    ['headline', LINKEDIN_TEXT_AD_LIMITS.headline],
    ['description', LINKEDIN_TEXT_AD_LIMITS.description],
  ] as const;
  for (const [key, limit] of fields) {
    const length = linkedInCreativeTextLength(typeof ad[key] === 'string' ? (ad[key] as string) : '');
    if (length === 0) return { field: `${path}.${key}`, message: `Enter text ad ${index + 1}'s ${key}.` };
    if (length > limit) return { field: `${path}.${key}`, message: `Text ad ${index + 1}'s ${key} can be at most ${limit} characters.` };
  }
  const urn = ad['imageUrn'] ?? '';
  const asset = ad['imageAssetId'] ?? '';
  if (urn !== '' && asset !== '') return { field: `${path}.imageUrn`, message: `Text ad ${index + 1} can have one image. Remove one of them.` };
  if (typeof urn === 'string' && urn !== '' && !LINKEDIN_IMAGE_URN_PATTERN.test(urn)) {
    return { field: `${path}.imageUrn`, message: `Text ad ${index + 1}'s image must be a LinkedIn image (urn:li:image:…).` };
  }
  return null;
}

/**
 * Why `raw`'s ad format or text ads cannot be sent, or `null` (#5764 row 19). Typed runtime checks, since the create route
 * has no body validator. Absent `format` (or `'single_image'`) is the single-image create and needs nothing here.
 *
 * - `format` not one of `LINKEDIN_AD_FORMATS`, or `textAds` without `format: 'text'`;
 * - `format: 'text'` while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy creator
 *   would make a single-image campaign instead and campaign-service refuses it while its own flag is off;
 * - a text create without a manual bid (LinkedIn offers Text Ads no automated bidding), with variants, or with no text
 *   ads or more than `LINKEDIN_TEXT_AD_LIMITS.ads`;
 * - a text ad that is not an object of text fields, with a headline or description blank or too long once normalized,
 *   both image fields, or a malformed image URN.
 *
 * Messages never echo a caller value.
 */
export function linkedInTextAdsRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const format = config['format'];
  if (format !== undefined && !(typeof format === 'string' && (LINKEDIN_AD_FORMATS as readonly string[]).includes(format))) {
    return { field: 'linkedInConfig.format', message: `The ad format must be one of ${LINKEDIN_AD_FORMATS.join(', ')}.` };
  }
  const textAds = config['textAds'];
  if (format !== 'text') {
    return textAds === undefined ? null : { field: 'linkedInConfig.textAds', message: 'Text ads go only with the text ad format.' };
  }
  if (!enabled)
    return { field: 'linkedInConfig.format', message: 'This deployment cannot create LinkedIn Text Ads. Choose single image ads to create the campaign.' };
  if (plainRecord(config['bidding'])?.['strategy'] !== 'manual') {
    return { field: 'linkedInConfig.bidding', message: 'LinkedIn Text Ads need a manual bid. Set a maximum cost per click.' };
  }
  const variants = config['variants'];
  if (Array.isArray(variants) && variants.length > 0) {
    return { field: 'linkedInConfig.variants', message: 'A Text Ads campaign takes its ads from the text ads. Send no single image ads.' };
  }
  if (!Array.isArray(textAds) || textAds.length === 0) return { field: 'linkedInConfig.textAds', message: 'Add at least one text ad.' };
  if (textAds.length > LINKEDIN_TEXT_AD_LIMITS.ads) {
    return { field: 'linkedInConfig.textAds', message: `A LinkedIn campaign holds at most ${LINKEDIN_TEXT_AD_LIMITS.ads} text ads.` };
  }
  for (const [index, item] of textAds.entries()) {
    const refusal = textAdRefusal(item, index);
    if (refusal !== null) return refusal;
  }
  return null;
}

/** The first `linkedInConfig.textAds[i].imageAssetId` key, as that field path, or `null`. `in`: an explicit `null` is still the field. */
export function linkedInTextAdAssetField(raw: unknown): string | null {
  const textAds = plainRecord(raw)?.['textAds'];
  if (!Array.isArray(textAds)) return null;
  const index = textAds.findIndex((ad: unknown) => plainRecord(ad) !== null && 'imageAssetId' in (ad as object));
  return index === -1 ? null : `linkedInConfig.textAds[${index}].imageAssetId`;
}
