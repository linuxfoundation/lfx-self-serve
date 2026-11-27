// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
  LINKEDIN_TEXT_AD_IMAGE_LIMITS,
  LINKEDIN_TEXT_AD_IMAGE_TOO_LARGE_MESSAGE,
  LINKEDIN_TEXT_AD_LIMITS,
} from '../constants/campaign.constants';
import type {
  LinkedInTextAd,
  LinkedInTextAdDraft,
  LinkedInTextAdImageInput,
  LinkedInTextAdsRefusalInput,
  LinkedInTextAdView,
} from '../interfaces/campaign.interface';
import { linkedInImageBlock, linkedInImageSlotHeldByOther, linkedInImageUploadOrphaned, linkedInVariantImageForBrief } from './campaign-linkedin-image.utils';
import { linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * The Implement tab's LinkedIn Text Ads editor rules (#5764 row 19): each ad's counters and errors, what the create
 * sends, and why Create is held. The same limits as the create route (`campaign-linkedin-text-ads.utils.ts`), counted
 * the way campaign-service counts them.
 */

const KEY_PREFIX = 'text-ad-';

/** A key no ad in `drafts` has: one past the highest `text-ad-<n>`, so a restored list never collides with a new ad. */
export function nextLinkedInTextAdKey(drafts: readonly LinkedInTextAdDraft[]): string {
  const highest = drafts.reduce((max, draft) => {
    const n = draft.key.startsWith(KEY_PREFIX) ? Number(draft.key.slice(KEY_PREFIX.length)) : Number.NaN;
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  return `${KEY_PREFIX}${highest + 1}`;
}

/** An empty text ad for `drafts`, with a key none of them has. */
export function newLinkedInTextAdDraft(drafts: readonly LinkedInTextAdDraft[]): LinkedInTextAdDraft {
  return { key: nextLinkedInTextAdKey(drafts), headline: '', description: '' };
}

function fieldError(label: 'headline' | 'description', length: number): string {
  if (length === 0) return `Enter the ${label}.`;
  const limit = LINKEDIN_TEXT_AD_LIMITS[label];
  return length > limit ? `The ${label} can be at most ${limit} characters.` : '';
}

/** No upload slot, brief or capability: the image state a view shows when the caller gives none. */
const NO_IMAGE: LinkedInTextAdImageInput = {
  slot: { variantKey: '', status: 'idle', failedBriefId: '', error: '' },
  briefId: '',
  briefSaving: false,
  showSection: false,
  uploadEnabled: null,
  capabilityRead: 'unknown',
};

/**
 * Each ad as the editor shows it: its lengths after normalization, the error under each field, and the state of its own
 * image in the one LinkedIn upload slot (`image`), on the single image variants' rules (`linkedInVariantViews`).
 */
export function linkedInTextAdViews(drafts: readonly LinkedInTextAdDraft[], image: LinkedInTextAdImageInput = NO_IMAGE): LinkedInTextAdView[] {
  const { slot, briefId } = image;
  // The picker is offered only for a saved brief that is not mid-save, since an upload belongs to one brief.
  const pickerBlocked = !briefId || image.briefSaving;
  const orphaned = linkedInImageUploadOrphaned(slot, drafts);
  // An upload for a single image variant (hidden while Text Ads are chosen) is orphaned here and holds no picker.
  const slotIndex = drafts.findIndex((draft) => draft.key === slot.variantKey);
  return drafts.map((draft, index) => {
    const headlineLength = linkedInCreativeTextLength(draft.headline);
    const descriptionLength = linkedInCreativeTextLength(draft.description);
    const ownsSlot = slot.variantKey === draft.key;
    const imageUploading = ownsSlot && slot.status === 'uploading';
    const heldByOther = linkedInImageSlotHeldByOther(draft.key, slot, orphaned, briefId);
    let imageStatusMessage = '';
    if (imageUploading) imageStatusMessage = 'Uploading image…';
    else if (linkedInVariantImageForBrief(draft, briefId)) imageStatusMessage = `Uploaded: ${draft.imageAssetName || 'image'}`;
    return {
      ...draft,
      headlineLength,
      descriptionLength,
      headlineError: fieldError('headline', headlineLength),
      descriptionError: fieldError('description', descriptionLength),
      imageStatusMessage,
      imageUploading,
      imageHeld: (draft.imageAssetId ?? '') !== '',
      imageError: ownsSlot && slot.status === 'error' ? slot.error : '',
      imagePickerDisabled: pickerBlocked || heldByOther,
      imagePickerNote: heldByOther ? `Finish or remove the image for text ad ${slotIndex + 1} first.` : '',
      imageBlock: linkedInImageBlock(image, draft, `text ad ${index + 1}`, imageUploading),
    };
  });
}

/**
 * Why a picked file cannot be a text ad's image, or `null`: not PNG or JPEG, or over campaign-service's 2,000,000 bytes.
 * The pixel size is checked once it is read (`linkedInTextAdImageSizeRefusal`).
 */
export function linkedInTextAdImageFileRefusal(file: { type: string; size: number }): string | null {
  if (!isCreativeAssetMimeType(file.type)) return CREATIVE_ASSET_WRONG_TYPE_MESSAGE;
  if (file.size > LINKEDIN_TEXT_AD_IMAGE_LIMITS.maxBytes) return LINKEDIN_TEXT_AD_IMAGE_TOO_LARGE_MESSAGE;
  return null;
}

/**
 * Why an image of `size` pixels cannot be a text ad's image, or `null`: LinkedIn takes exactly 100x100. A size the
 * browser could not read (`null`) is refused too, because campaign-service checks it only after the campaign group exists.
 */
export function linkedInTextAdImageSizeRefusal(size: { width: number; height: number } | null): string | null {
  const side = LINKEDIN_TEXT_AD_IMAGE_LIMITS.side;
  if (size === null) return `Could not read this image's size. LinkedIn text ad images must be ${side}x${side} pixels; choose another PNG or JPEG.`;
  if (size.width === side && size.height === side) return null;
  return `LinkedIn text ad images must be ${side}x${side} pixels; this one is ${size.width}x${size.height}.`;
}

/**
 * The text ads as sent: the copy as typed, which campaign-service normalizes itself, and each ad's upload only when the
 * upload capability is an explicit yes (`uploadAvailable`) and it was made for the open brief. `key` and the asset's name
 * and brief are never sent.
 */
export function linkedInTextAdsForCreate(drafts: readonly LinkedInTextAdDraft[], uploadAvailable = false, briefId = ''): LinkedInTextAd[] {
  return drafts.map((draft) => {
    const { headline, description } = draft;
    if (uploadAvailable && linkedInVariantImageForBrief(draft, briefId)) return { headline, description, imageAssetId: draft.imageAssetId };
    return { headline, description };
  });
}

/** Why the Text Ads hold Create, or `null`. The first failing check wins; each message names its fix. */
export function linkedInTextAdsCreateRefusal(input: LinkedInTextAdsRefusalInput): string | null {
  if (!input.manualBid) return 'LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.';
  if (input.count === 0) return 'LinkedIn Ads: add at least one text ad.';
  if (input.count > LINKEDIN_TEXT_AD_LIMITS.ads) return `LinkedIn Ads: remove text ads until there are at most ${LINKEDIN_TEXT_AD_LIMITS.ads}.`;
  if (input.textInvalid) return 'LinkedIn Ads: fix the text ad text.';
  return null;
}
