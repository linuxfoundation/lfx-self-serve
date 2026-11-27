// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_REDDIT_AD_VARIANTS, MAX_REDDIT_HEADLINE_LENGTH } from '../constants/campaign.constants';
import type { RedditConfigRefusal } from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * One ad per variant on a Reddit create (#6108 row 6), held to campaign-service's `checkRedditAdPerVariant` /
 * `redditAdPerVariantApplies` (`internal/dispatch/reddit_ad_per_variant.go`) and `ValidateAdVariants`
 * (`internal/platform/reddit/ad_variants.go`, #549), so a create campaign-service would refuse is refused here first, with
 * the variant to point at. It refuses only what campaign-service is sure to refuse: wherever its reading of the config
 * could differ from Go's `encoding/json`, it steps aside and leaves the create to campaign-service. Messages never echo
 * a caller value.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The value of `key` in `record`, or `undefined` when absent. `null` when the reading is ambiguous: Go matches keys
 * ignoring case with its own folding and merges or skips repeated ones, so a key that several spellings fold to, or a
 * spelling that is not ASCII (where JavaScript's case folding is not Go's), is not read here. The form never sends one.
 */
function plainValue(record: Record<string, unknown>, key: string): { value: unknown } | null {
  const spellings = Object.keys(record).filter((k) => foldKey(k) === foldKey(key));
  if (spellings.length > 1 || spellings.some((k) => /[^\x20-\x7e]/.test(k))) return null;
  return { value: spellings.length === 0 ? undefined : record[spellings[0]] };
}

/** A string field as Go decodes it: absent and `null` are blank; any other non-string fails campaign-service's decode, so `null` here. */
function goString(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : null;
}

/**
 * Each variant's headline as campaign-service decodes `variants` (`[]reddit.AdVariant`), or `null` when the list would
 * fail that decode. Absent and `null` are no variants, a `null` entry is a variant with a blank headline, and a `body`
 * must decode too even though it is never read.
 */
function decodedHeadlines(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const headlines: string[] = [];
  for (const entry of value) {
    if (entry === null) {
      headlines.push('');
      continue;
    }
    const variant = plainRecord(entry);
    if (!variant) return null;
    const headline = plainValue(variant, 'headline');
    const body = plainValue(variant, 'body');
    if (!headline || !body) return null;
    const text = goString(headline.value);
    if (text === null || goString(body.value) === null) return null;
    headlines.push(text);
  }
  return headlines;
}

/**
 * Why `raw`'s variants cannot be sent, or `null` (#6108 row 6). Typed runtime checks, since the create route forwards
 * `redditConfig` as it comes. Nothing is refused while this deployment does not offer one ad per variant (`enabled`
 * false): creates already carry the brief's variants, and campaign-service applies its own rules only while its
 * `REDDIT_AD_PER_VARIANT_ENABLED` is on. With `enabled`, in campaign-service's order:
 *
 * - nothing is refused unless the create authors its post (`imageUrl` or `imageAssetId` not blank, `postUrl` blank) with
 *   at least 2 variants: a create that promotes an existing post, or with fewer variants, makes one ad as before;
 * - more than 5 variants;
 * - then, variant by variant, a blank headline, or one longer than 300 characters once trimmed as Go trims, counted in
 *   code points as campaign-service counts runes.
 *
 * Left to campaign-service, never refused here: a `postUrl`, `imageUrl`, `imageAssetId`, `variants`, `headline` or
 * `body` it could not decode (a non-string headline, say), or one sent under several spellings; and `imageUrl` together
 * with `imageAssetId`, which campaign-service refuses first (`checkRedditAssetChoice`). Only `headline` is checked:
 * campaign-service never reads `body`.
 */
export function redditAdPerVariantRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!enabled || !config) return null;
  const fields = (['postUrl', 'imageUrl', 'imageAssetId', 'variants'] as const).map((key) => plainValue(config, key));
  if (fields.some((field) => field === null)) return null;
  const [postUrl, imageUrl, imageAssetId] = fields.slice(0, 3).map((field) => goString(field?.value));
  const headlines = decodedHeadlines(fields[3]?.value);
  if (postUrl === null || imageUrl === null || imageAssetId === null || headlines === null) return null;
  // Both images: campaign-service refuses that pair before it reads the variants (`checkRedditAssetChoice`).
  if (goTrimSpace(imageUrl) !== '' && goTrimSpace(imageAssetId) !== '') return null;
  // The one-ad create (`redditAdPerVariantApplies`): an existing post, no authored image, or fewer than 2 variants.
  const authorsPost = goTrimSpace(postUrl) === '' && (goTrimSpace(imageUrl) !== '' || goTrimSpace(imageAssetId) !== '');
  if (!authorsPost || headlines.length < 2) return null;
  // More variants than one ad per variant takes (`MaxAdVariants`), refused before any headline is read.
  if (headlines.length > MAX_REDDIT_AD_VARIANTS) {
    return {
      field: 'redditConfig.variants',
      message: `${headlines.length} variants were sent. Each becomes its own Reddit ad, so send at most ${MAX_REDDIT_AD_VARIANTS}.`,
    };
  }
  for (const [i, raw] of headlines.entries()) {
    const headline = goTrimSpace(raw);
    const field = `redditConfig.variants[${i}].headline`;
    // A blank headline: each variant becomes its own promoted post, so it cannot fall back to the event name.
    if (headline === '') return { field, message: `Variant ${i + 1} has no headline. Each variant becomes its own Reddit ad, so each needs one.` };
    // Reddit's headline limit (`maxRedditHeadlineRunes`), in code points: an emoji is one character there.
    const length = [...headline].length;
    if (length > MAX_REDDIT_HEADLINE_LENGTH) {
      return { field, message: `Variant ${i + 1}'s headline is ${length} characters. Reddit allows at most ${MAX_REDDIT_HEADLINE_LENGTH}.` };
    }
  }
  return null;
}
