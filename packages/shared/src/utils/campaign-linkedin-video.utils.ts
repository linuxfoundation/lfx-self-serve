// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UUID_REGEX } from '../constants/regex.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * LinkedIn video ads, LF's "Motion" (#5764 row 18), mirroring campaign-service's `checkLinkedInVideoVariants` and the
 * `videoAssetId` entry of `variantStringFields` (`internal/dispatch/linkedin_creative.go`, `linkedin.go`, #586), so a
 * create campaign-service would refuse is refused here first, with a field to point at.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Whether `value` is a string campaign-service reads as set: non-blank once Go's `strings.TrimSpace` ran. */
function isSet(value: unknown): boolean {
  return typeof value === 'string' && goTrimSpace(value) !== '';
}

/**
 * Why `raw`'s variants cannot carry their `videoAssetId`, or `null`. Typed runtime checks, since the create route has no
 * body validator. A variant with no `videoAssetId`, or a blank one, is an image variant and needs nothing here.
 *
 * - a `videoAssetId` that is not text, `null` included (campaign-service's `checkVariantsShape`);
 * - a video while this deployment cannot send one (`enabled`): refused, never dropped, since the legacy creator would
 *   make an image campaign instead and campaign-service refuses it while its own `LINKEDIN_ADS_VIDEO_ENABLED` is off;
 * - an id that is not a creative asset id (a UUID);
 * - a video variant with an image (`imageUrn` or `imageAssetId`) or a description, which belongs to an article;
 * - some variants with a video and some without: a SINGLE_VIDEO campaign takes only video ads.
 *
 * Messages never echo a caller value.
 */
export function linkedInVideoVariantsRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const variants = plainRecord(raw)?.['variants'];
  if (!Array.isArray(variants)) return null;
  let videos = 0;
  for (const [index, item] of variants.entries()) {
    const variant = plainRecord(item);
    if (!variant || !('videoAssetId' in variant)) continue;
    const field = `linkedInConfig.variants[${index}].videoAssetId`;
    const value = variant['videoAssetId'];
    if (typeof value !== 'string') return { field, message: `Ad ${index + 1}'s video must be an uploaded video's id.` };
    if (!isSet(value)) continue;
    videos++;
    if (!enabled) return { field, message: 'This deployment cannot create LinkedIn video ads. Remove the video to create the campaign.' };
    if (!UUID_REGEX.test(goTrimSpace(value))) return { field, message: `Ad ${index + 1}'s video must be an uploaded video's id.` };
    if (isSet(variant['imageUrn']) || isSet(variant['imageAssetId'])) {
      return { field: `linkedInConfig.variants[${index}]`, message: `Ad ${index + 1} has a video and an image. A video ad carries no image.` };
    }
    if (isSet(variant['description'])) {
      return {
        field: `linkedInConfig.variants[${index}].description`,
        message: `Ad ${index + 1} has a video and a description. A video ad has no description; clear it.`,
      };
    }
  }
  if (videos > 0 && videos !== variants.length) {
    return { field: 'linkedInConfig.variants', message: 'Give every ad a video, or none. A LinkedIn video campaign takes only video ads.' };
  }
  return null;
}
