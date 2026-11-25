// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_VIDEO_MAX_BYTES,
  CREATIVE_ASSET_VIDEO_MIME_TYPE,
  CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE,
  LINKEDIN_VIDEO_MIN_BYTES,
  LINKEDIN_VIDEO_TOO_SMALL_MESSAGE,
} from '../constants/campaign.constants';
import type { LinkedInCreativeVariant, LinkedInVariantDraft, LinkedInVariantFieldsEnabled } from '../interfaces/campaign.interface';
import { linkedInVariantImageForBrief, linkedInVariantVideoHolder } from './campaign-linkedin-image.utils';
import { normalizeLinkedInCreativeName } from './campaign-linkedin.utils';

/**
 * The Implement tab's LinkedIn video ad rules (#5764 row 18): the file a video upload takes, the variants a video create
 * sends, and whether every ad has its video. The same rules the create route holds a request to
 * (`linkedInVideoVariantsRefusal`), so Create is held rather than refused.
 */

/**
 * Why a picked file cannot be uploaded as a LinkedIn video, or `null`: not an MP4, smaller than LinkedIn's 75 KB minimum
 * (campaign-service checks it only at dispatch, after the campaign exists), or over the upload route's 30 MB limit.
 */
export function linkedInVideoFileRefusal(file: { type: string; size: number }): string | null {
  if (file.type !== CREATIVE_ASSET_VIDEO_MIME_TYPE) return CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE;
  if (file.size < LINKEDIN_VIDEO_MIN_BYTES) return LINKEDIN_VIDEO_TOO_SMALL_MESSAGE;
  if (file.size > CREATIVE_ASSET_VIDEO_MAX_BYTES) return CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE;
  return null;
}

/** Whether the variant holds a video uploaded for the brief now open (`briefId`), the only one a create sends. */
export function linkedInVariantVideoForBrief(variant: LinkedInVariantDraft, briefId: string): boolean {
  return linkedInVariantImageForBrief(linkedInVariantVideoHolder(variant), briefId);
}

/** Whether any ad lacks a video for the open brief, which holds a video create: every ad carries one, or none does. */
export function linkedInVideoMissing(variants: readonly LinkedInVariantDraft[], briefId: string): boolean {
  return variants.some((variant) => !linkedInVariantVideoForBrief(variant, briefId));
}

/**
 * The variants a video create sends: each one's copy, its video, and its ad name and call to action where this
 * deployment sends them (`fields`). Never an image (a video ad carries none) or a description (it belongs to an article),
 * which campaign-service refuses beside a video. A variant with no video for the open brief sends none, so the create
 * route refuses the mix rather than this quietly sending image ads.
 */
export function linkedInVideoVariantsForCreate(
  variants: readonly LinkedInVariantDraft[],
  briefId: string,
  fields: LinkedInVariantFieldsEnabled = { copy: false, callToAction: false }
): LinkedInCreativeVariant[] {
  return variants.map((variant) => {
    const out: LinkedInCreativeVariant = { introText: variant.introText, headline: variant.headline };
    if (linkedInVariantVideoForBrief(variant, briefId)) out.videoAssetId = variant.videoAssetId;
    if (fields.copy && normalizeLinkedInCreativeName(variant.name ?? '') !== '') out.name = variant.name;
    if (fields.callToAction && (variant.callToAction ?? '') !== '') out.callToAction = variant.callToAction;
    return out;
  });
}

/**
 * The stored video to delete once an ad no longer uses it, or `null` (#5764 row 18). The library does not list videos, so
 * a removed or replaced one would otherwise hold its bytes against the brief's quota for good. Kept: an empty id, the
 * one the replacement upload came back as (identical bytes are stored once), and any id another ad still uses.
 */
export function linkedInVideoAssetToDelete(variants: readonly LinkedInVariantDraft[], assetId: string, keepId = ''): string | null {
  if (assetId === '' || assetId === keepId) return null;
  return variants.some((variant) => variant.videoAssetId === assetId) ? null : assetId;
}
