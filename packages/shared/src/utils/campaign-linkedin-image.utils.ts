// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
  LINKEDIN_IMAGE_MAX_BYTES,
  LINKEDIN_IMAGE_TOO_LARGE_MESSAGE,
  LINKEDIN_MAX_VARIANTS,
  LINKEDIN_MIN_VARIANTS,
} from '../constants/campaign.constants';
import type {
  CampaignLinkedInImageAssetBlock,
  LinkedInImageHolder,
  LinkedInImageSlot,
  LinkedInTextAdImageInput,
  LinkedInVariantDraft,
  LinkedInVariantView,
  LinkedInVariantViewsInput,
} from '../interfaces/campaign.interface';
import { linkedInCreativeTextLength, linkedInVariantTextError } from './campaign-linkedin.utils';
import { linkedInVariantFieldErrors } from './campaign-linkedin-variant-fields.utils';

/**
 * The Implement tab's LinkedIn variant and image rules (#5547, #5980): the one upload slot, the picker, the image notice
 * that holds Create, and the add and remove limits. The component keeps the upload itself and wires its signals here.
 */

/** Whether another variant may be added: fewer than `LINKEDIN_MAX_VARIANTS` on screen. */
export function linkedInCanAddVariant(count: number): boolean {
  return count < LINKEDIN_MAX_VARIANTS;
}

/** Whether a variant may be removed: more than `LINKEDIN_MIN_VARIANTS` on screen. */
export function linkedInCanRemoveVariant(count: number): boolean {
  return count > LINKEDIN_MIN_VARIANTS;
}

/**
 * Why a picked file cannot be uploaded for LinkedIn, or `null`: not PNG or JPEG, or over LinkedIn's 5,000,000-byte
 * limit, which campaign-service would refuse at dispatch.
 */
export function linkedInImageFileRefusal(file: { type: string; size: number }): string | null {
  if (!isCreativeAssetMimeType(file.type)) return CREATIVE_ASSET_WRONG_TYPE_MESSAGE;
  if (file.size > LINKEDIN_IMAGE_MAX_BYTES) return LINKEDIN_IMAGE_TOO_LARGE_MESSAGE;
  return null;
}

/** A variant's video (#5764 row 18) in the shape the image rules read, so one set of slot and notice rules serves both. */
export function linkedInVariantVideoHolder(variant: LinkedInVariantDraft): LinkedInImageHolder & { imageAssetName: string } {
  return {
    key: variant.key,
    imageAssetId: variant.videoAssetId ?? '',
    imageAssetName: variant.videoAssetName ?? '',
    imageAssetBriefId: variant.videoAssetBriefId ?? '',
  };
}

/**
 * Whether the variant or text ad holds an upload made for the brief now open (`briefId`, `''` for none): the only one
 * sent. A text ad saved before images existed has no `imageAssetId` and holds none.
 */
export function linkedInVariantImageForBrief(holder: Omit<LinkedInImageHolder, 'key'>, briefId: string): boolean {
  return (holder.imageAssetId ?? '') !== '' && holder.imageAssetBriefId === briefId;
}

/**
 * Whether the upload belongs to no variant or text ad on screen (`holders`): the brief re-seeded the variants (new keys)
 * while it ran. It is not cancelled, because a draft restore that follows brings that variant back; until then it holds
 * nothing.
 */
export function linkedInImageUploadOrphaned(slot: LinkedInImageSlot, holders: readonly { key: string }[]): boolean {
  return slot.variantKey !== '' && !holders.some((holder) => holder.key === slot.variantKey);
}

/**
 * Whether the upload belongs to ANOTHER variant than `key` and must not be replaced: still running, or failed for the
 * open brief (whose notice holds Create until it is removed). An orphaned upload holds nothing.
 */
export function linkedInImageSlotHeldByOther(key: string, slot: LinkedInImageSlot, orphaned: boolean, briefId: string): boolean {
  if (slot.variantKey === '' || slot.variantKey === key || orphaned) return false;
  if (slot.status === 'uploading') return true;
  return slot.status === 'error' && briefId !== '' && slot.failedBriefId === briefId;
}

/** Whether a running upload holds Create: the section is shown, uploads are an explicit yes, and the upload has a variant. */
export function linkedInImageUploadHoldsCreate(showSection: boolean, uploadAvailable: boolean, slot: LinkedInImageSlot, orphaned: boolean): boolean {
  return showSection && uploadAvailable && slot.status === 'uploading' && !orphaned;
}

/**
 * Why one LinkedIn image holds Create, or `null`: `metaImageAssetBlock`'s sibling for one upload alone. Shared by the
 * single image variants, the Text Ads (#5764 row 19) and the video ads (#5764 row 18); `label` names the ad in each
 * message ("variant 2", "text ad 2"), and `media` what was uploaded.
 */
export function linkedInImageBlock(
  input: LinkedInTextAdImageInput,
  holder: LinkedInImageHolder,
  label: string,
  imageUploading: boolean,
  media: 'image' | 'video' = 'image'
): CampaignLinkedInImageAssetBlock | null {
  if (!input.showSection) return null;
  const { briefId, slot } = input;
  if ((holder.imageAssetId ?? '') !== '' && briefId && holder.imageAssetBriefId !== briefId) {
    return {
      kind: 'otherBrief',
      message: `The ${media} for LinkedIn ${label} was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again.`,
    };
  }
  if (slot.variantKey === holder.key && slot.status === 'error' && briefId && slot.failedBriefId === briefId) {
    return {
      kind: 'uploadFailed',
      message: `The ${media} upload for LinkedIn ${label} did not complete: ${slot.error} Remove it, or choose the image again.`,
    };
  }
  // An upload for the open brief (made, or still running) the request cannot carry: the upload capability is not an explicit yes.
  const withheld = (linkedInVariantImageForBrief(holder, briefId) || imageUploading) && input.uploadEnabled !== true;
  if (!withheld) return null;
  if (input.uploadEnabled === false) {
    return {
      kind: 'unsupported',
      message:
        media === 'video'
          ? `LinkedIn video ads are not available on this deployment, so the video for ${label} cannot be sent. Choose single image ads as the ad format.`
          : `LinkedIn ad images are not available on this deployment, so the image for ${label} cannot be sent. Remove it to create the campaign without it.`,
    };
  }
  const support = media === 'video' ? 'video ad' : 'ad image';
  if (input.capabilityRead === 'pending') return { kind: 'pending', message: `Checking LinkedIn ${support} support…` };
  if (!briefId) {
    return { kind: 'unsaved', message: `LinkedIn ${support} support can't be checked until this brief is saved. Save the brief, or remove the ${media}.` };
  }
  return {
    kind: 'failed',
    message: `Could not confirm that LinkedIn ${support}s are supported, so the ${media} for ${label} cannot be sent yet. Retry the check, or remove the ${media}.`,
  };
}

/**
 * What the Implement tab shows for each LinkedIn variant: its copy with campaign-service's lengths and refusals, and the
 * state of its own image (status line, error, picker, and the notice that holds Create).
 */
export function linkedInVariantViews(input: LinkedInVariantViewsInput): LinkedInVariantView[] {
  const { variants, slot, briefId } = input;
  // While video ads are chosen (#5764 row 18) the upload fields describe each variant's video, in the same one slot.
  const media = input.media ?? 'image';
  const uploading = slot.status === 'uploading';
  const failed = slot.status === 'error';
  // The picker is offered only for a saved brief that is not mid-save, since an upload belongs to one brief.
  const pickerBlocked = !briefId || input.briefSaving;
  const orphaned = linkedInImageUploadOrphaned(slot, variants);
  const slotIndex = variants.findIndex((variant) => variant.key === slot.variantKey);
  const fieldErrors = linkedInVariantFieldErrors(variants, input.eventName ?? '');
  return variants.map((variant, index): LinkedInVariantView => {
    const ownsSlot = slot.variantKey === variant.key;
    const imageUploading = ownsSlot && uploading;
    const holder = media === 'video' ? linkedInVariantVideoHolder(variant) : variant;
    const forThisBrief = linkedInVariantImageForBrief(holder, briefId);
    const heldByOther = linkedInImageSlotHeldByOther(variant.key, slot, orphaned, briefId);
    let imageStatusMessage = '';
    if (imageUploading) imageStatusMessage = `Uploading ${media}…`;
    else if (forThisBrief) imageStatusMessage = `Uploaded: ${holder.imageAssetName || media}`;
    return {
      key: variant.key,
      introText: variant.introText,
      headline: variant.headline,
      introTextLength: linkedInCreativeTextLength(variant.introText),
      headlineLength: linkedInCreativeTextLength(variant.headline),
      introTextError: linkedInVariantTextError('introText', variant.introText) ?? '',
      headlineError: linkedInVariantTextError('headline', variant.headline) ?? '',
      name: variant.name ?? '',
      description: variant.description ?? '',
      callToAction: variant.callToAction ?? '',
      descriptionLength: linkedInCreativeTextLength(variant.description ?? ''),
      nameError: fieldErrors[index].name,
      descriptionError: fieldErrors[index].description,
      imageStatusMessage,
      imageUploading,
      imageHeld: (holder.imageAssetId ?? '') !== '',
      imageError: ownsSlot && failed ? slot.error : '',
      imagePickerDisabled: pickerBlocked || heldByOther,
      imagePickerNote: heldByOther ? `Finish or remove the ${media} for variant ${slotIndex + 1} first.` : '',
      imageBlock: linkedInImageBlock(input, holder, `variant ${index + 1}`, imageUploading, media),
    };
  });
}
