// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * LinkedIn video ads (#5764 row 18), mirroring campaign-service's synchronous checks (`checkVariantsShape` in
 * `internal/dispatch/linkedin.go`, `checkLinkedInVideoVariants` in `internal/dispatch/linkedin_creative.go`, #586), so a
 * create campaign-service would refuse is refused here first, with a field to point at.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const HEX = /^[0-9a-fA-F]+$/;

/**
 * Whether `value` is an id Go's `uuid.Parse` (github.com/google/uuid) accepts: the 36-character form, that form in braces
 * or after a case-insensitive `urn:uuid:`, or 32 hex digits with no dashes.
 */
function isGoUuid(value: string): boolean {
  let id = value;
  if (id.length === 45 && id.slice(0, 9).toLowerCase() === 'urn:uuid:') id = id.slice(9);
  else if (id.length === 38 && id.startsWith('{') && id.endsWith('}')) id = id.slice(1, 37);
  else if (id.length === 32) return HEX.test(id);
  if (id.length !== 36 || id[8] !== '-' || id[13] !== '-' || id[18] !== '-' || id[23] !== '-') return false;
  return HEX.test(id.slice(0, 8) + id.slice(9, 13) + id.slice(14, 18) + id.slice(19, 23) + id.slice(24));
}

/** Whether a variant's field holds something campaign-service reads as set: anything but absent, `null` or a blank string. */
function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || goTrimSpace(value) !== '';
}

/**
 * Why `raw`'s variant videos cannot be sent, or `null` (#5764 row 18). Typed runtime checks, since the create route has
 * no body validator. A config whose variants carry no video (absent or blank `videoAssetId`) needs nothing here. In
 * campaign-service's order:
 *
 * 1. shape: a `videoAssetId` that is not text, an explicit `null` included, whatever the flag;
 * 2. flag: any video while this deployment cannot send one (`enabled`): refused, never dropped, since the legacy creator
 *    would make an image campaign instead and campaign-service refuses it while its own flag is off;
 * 3. rules, per video variant: an id `uuid.Parse` would refuse, an image (`imageUrn` or `imageAssetId`) or a
 *    `description` beside the video (the description is the article's, and a video post has none);
 * 4. a mix of video and non-video variants: the campaign is created as SINGLE_VIDEO, which takes only video creatives.
 *
 * Whether the asset exists on the brief, is an MP4 and is 76,800 to 500,000,000 bytes is decided by campaign-service at
 * dispatch. Messages never echo a caller value.
 */
export function linkedInVideoRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const variants = plainRecord(raw)?.['variants'];
  if (!Array.isArray(variants)) return null;
  const videos: number[] = [];
  for (const [index, item] of variants.entries()) {
    const variant = plainRecord(item);
    if (!variant || !('videoAssetId' in variant)) continue;
    const value = variant['videoAssetId'];
    if (typeof value !== 'string') {
      return { field: `linkedInConfig.variants[${index}].videoAssetId`, message: `Ad ${index + 1}'s video must be the id of an uploaded video.` };
    }
    if (goTrimSpace(value) !== '') videos.push(index);
  }
  if (videos.length === 0) return null;
  if (!enabled) {
    return {
      field: `linkedInConfig.variants[${videos[0]}].videoAssetId`,
      message: 'This deployment cannot create LinkedIn video ads. Use images to create the campaign.',
    };
  }
  for (const index of videos) {
    const variant = variants[index] as Record<string, unknown>;
    const path = `linkedInConfig.variants[${index}]`;
    if (!isGoUuid(goTrimSpace(variant['videoAssetId'] as string))) {
      return { field: `${path}.videoAssetId`, message: `Ad ${index + 1}'s video is not an uploaded video. Upload it again.` };
    }
    if (isSet(variant['imageUrn']) || isSet(variant['imageAssetId'])) {
      return { field: `${path}.videoAssetId`, message: `Ad ${index + 1} has a video and an image. A video ad carries no image; remove one.` };
    }
    if (typeof variant['description'] === 'string' && goTrimSpace(variant['description']) !== '') {
      return { field: `${path}.description`, message: `Ad ${index + 1} is a video ad, which has no description. Remove it.` };
    }
  }
  if (videos.length !== variants.length) {
    return {
      field: 'linkedInConfig.variants',
      message: 'A LinkedIn video campaign takes only video ads. Give every ad a video, or none.',
    };
  }
  return null;
}
