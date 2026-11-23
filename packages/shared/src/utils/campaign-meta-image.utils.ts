// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
} from '../constants/campaign.constants';
import type {
  CampaignMetaImageAssetBlock,
  CreativeAssetUploadStatus,
  MetaAdVariant,
  MetaImageBlockInput,
  MetaImageField,
} from '../interfaces/campaign.interface';

/**
 * The Meta ad image rules on the Implement tab (#5980, approach 4): which image a create sends, when a
 * held image blocks Create, and the upload's pre-checks and labels. Pure, so the full matrix is tested
 * here; the component reads them through its signals and keeps only wiring tests. The upload itself
 * (HTTP, progress, cancel) stays in the component.
 */

/** Whether the draft holds an uploaded Meta image made for the open brief: the only one ever sent. */
export function metaImageAssetForBrief(assetId: string, assetBriefId: string, briefId: string | null): boolean {
  return assetId !== '' && assetBriefId === (briefId ?? '');
}

/** An upload for the open brief (made, or still running) that the request cannot carry: the upload capability is not an explicit yes. */
export function metaImageAssetWithheld(assetForThisBrief: boolean, uploadStatus: CreativeAssetUploadStatus, uploadAvailable: boolean): boolean {
  return (assetForThisBrief || uploadStatus === 'uploading') && !uploadAvailable;
}

/** A pasted image URL the request cannot carry: the image capability is not an explicit yes. */
export function metaImageUrlWithheld(imageUrl: string, creativeAvailable: boolean): boolean {
  return imageUrl !== '' && !creativeAvailable;
}

/**
 * The image key every Meta variant carries. The uploaded asset wins over a pasted URL, and is sent only
 * while the upload capability is an explicit yes and the asset was made for the open brief; the URL only
 * while the image capability is. Never both, which campaign-service refuses.
 */
export function metaImageField(input: {
  uploadAvailable: boolean;
  assetForThisBrief: boolean;
  assetId: string;
  creativeAvailable: boolean;
  imageUrl: string;
}): MetaImageField {
  if (input.uploadAvailable && input.assetForThisBrief) return { imageAssetId: input.assetId };
  if (input.creativeAvailable && input.imageUrl) return { imageUrl: input.imageUrl };
  return {};
}

/** The Meta variants as sent: each carries the one image when there is one, otherwise they go unchanged. */
export function metaVariantsWithImage(variants: MetaAdVariant[], image: MetaImageField): MetaAdVariant[] {
  return Object.keys(image).length > 0 ? variants.map((variant) => ({ ...variant, ...image })) : variants;
}

/**
 * Why Create is blocked for a Meta image the tab holds but cannot send, or `null`. Two departures from
 * Reddit's block, so a chosen image is never left out without a word: a failed upload for the open brief
 * blocks whatever the capability says, and a pasted URL the request would withhold blocks like an upload.
 */
export function metaImageAssetBlock(input: MetaImageBlockInput): CampaignMetaImageAssetBlock | null {
  if (!input.showMetaSection) return null;
  const { briefId } = input;
  if (input.assetId !== '' && briefId && input.assetBriefId !== briefId) {
    return {
      kind: 'otherBrief',
      message:
        'The uploaded Meta image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again or use an image URL.',
    };
  }
  if (input.uploadStatus === 'error' && briefId && input.uploadFailedBriefId === briefId) {
    return {
      kind: 'uploadFailed',
      message: `The Meta image upload did not complete: ${input.uploadError} Remove it, or choose the image again.`,
    };
  }
  if (!input.assetWithheld && !input.urlWithheld) return null;
  if (input.creativeEnabled === false || (input.assetWithheld && input.assetUploadEnabled === false)) {
    return {
      kind: 'unsupported',
      message: 'Meta ad images are not available on this deployment, so the image cannot be sent. Remove it to create the campaign without it.',
    };
  }
  if (input.createCapabilityRead === 'pending') return { kind: 'pending', message: 'Checking Meta ad image support…' };
  if (!briefId) {
    return {
      kind: 'unsaved',
      message: "Meta ad image support can't be checked until this brief is saved. Save the brief, or remove the image.",
    };
  }
  return {
    kind: 'failed',
    message: 'Could not confirm that Meta ad images are supported, so the image cannot be sent yet. Retry the check, or remove the image.',
  };
}

/**
 * Why a chosen file cannot be uploaded as the Meta image, or `null`: a PNG or JPEG, at most
 * `CREATIVE_ASSET_MAX_BYTES`, for a saved brief in a project. Checked in this order, before any upload.
 */
export function metaImageFileRefusal(file: { type: string; size: number }, briefId: string, projectSlug: string): string | null {
  if (!isCreativeAssetMimeType(file.type)) return CREATIVE_ASSET_WRONG_TYPE_MESSAGE;
  if (file.size > CREATIVE_ASSET_MAX_BYTES) return CREATIVE_ASSET_TOO_LARGE_MESSAGE;
  if (!briefId || !projectSlug) return 'Save the brief before uploading an image for it.';
  return null;
}

/** The upload control's status line. */
export function metaImageUploadStatusMessage(uploadStatus: CreativeAssetUploadStatus, assetForThisBrief: boolean, assetName: string): string {
  if (uploadStatus === 'uploading') return 'Uploading image…';
  return assetForThisBrief ? `Uploaded: ${assetName || 'image'}` : '';
}

/** What the variant preview says about the image each ad carries, read from the same field the payload is. */
export function metaPreviewImageLabel(image: MetaImageField, assetName: string): string {
  if ('imageAssetId' in image) return `Image: ${assetName || 'uploaded image'}`;
  if ('imageUrl' in image) return `Image: ${image.imageUrl}`;
  return '';
}
