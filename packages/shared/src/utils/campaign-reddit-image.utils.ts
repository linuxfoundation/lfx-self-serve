// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
} from '../constants/campaign.constants';
import type {
  CampaignRedditImageAssetBlock,
  CreativeAssetUploadStatus,
  RedditImageBlockInput,
  RedditImageField,
  RedditNoAdWarningInput,
} from '../interfaces/campaign.interface';

/**
 * The Reddit image rules on the Implement tab (#5980, approach 4): which image a create sends, when a
 * held image blocks Create, the upload's pre-checks and labels, and the no-ad warning. Pure, so the full
 * matrix is tested here; the component reads them through its signals and keeps only wiring tests. The
 * upload itself (HTTP, progress, cancel, resume) stays in the component.
 */

/**
 * The Reddit image capabilities as the tab acts on them. Each is offered only on an explicit yes: an
 * unanswered (`null`) read withholds it like a no. Upload is one more way to supply the authored post's
 * image, so it also needs the authored-post capability itself.
 */
export function redditImageCapabilities(
  creativeEnabled: boolean | null,
  assetUploadEnabled: boolean | null
): { creativeAvailable: boolean; uploadAvailable: boolean } {
  const creativeAvailable = creativeEnabled === true;
  return { creativeAvailable, uploadAvailable: creativeAvailable && assetUploadEnabled === true };
}

/** Whether the draft holds an uploaded Reddit image made for the open brief: the only one ever sent. */
export function redditImageAssetForBrief(assetId: string, assetBriefId: string, briefId: string | null): boolean {
  return assetId !== '' && assetBriefId === (briefId ?? '');
}

/**
 * The image field a Reddit create carries: the uploaded asset, else the pasted URL. Exactly one, because
 * campaign-service refuses `imageAssetId` alongside `imageUrl` (or `postUrl`). The asset is withheld while
 * a post URL is set (that post already has its image) and unless the upload capability is an explicit yes
 * and the asset was made for the open brief. The pasted URL is sent while the authored-post capability is
 * a yes, and is ignored upstream when a post URL is set.
 */
export function redditImageField(input: {
  uploadAvailable: boolean;
  assetForThisBrief: boolean;
  assetId: string;
  postUrl: string;
  creativeAvailable: boolean;
  imageUrl: string;
}): RedditImageField {
  if (input.uploadAvailable && input.assetForThisBrief && !input.postUrl) return { imageAssetId: input.assetId };
  if (input.creativeAvailable && input.imageUrl) return { imageUrl: input.imageUrl };
  return {};
}

/**
 * Why Create is blocked for an uploaded Reddit image the tab still holds but cannot send, or `null`.
 * `redditImageField` withholds the asset unless the upload capability is an explicit yes, so a restored
 * upload would otherwise be silently left out of the request. Never raised while a post URL is set: the
 * asset is withheld then by design. An upload still in flight counts as the image too, since a resumed one
 * has no asset id yet and, with the upload control hidden, this block is the only place it shows.
 */
export function redditImageAssetBlock(input: RedditImageBlockInput): CampaignRedditImageAssetBlock | null {
  if (!input.showRedditSection || input.postUrl) return null;
  const { briefId } = input;
  // An upload made for another brief is never sent, whatever the capability says.
  if (input.assetId !== '' && briefId && input.assetBriefId !== briefId) {
    return {
      kind: 'otherBrief',
      message:
        'The uploaded Reddit image was uploaded for a different brief, so it cannot be sent with this one. Remove it, then upload it again or use an image URL.',
    };
  }
  if (redditImageCapabilities(input.creativeEnabled, input.assetUploadEnabled).uploadAvailable) return null;
  // A failed upload's reason lives in the (now hidden) upload control, so it shows here; only for the open brief.
  if (input.uploadStatus === 'error' && briefId && input.uploadFailedBriefId === briefId) {
    return {
      kind: 'uploadFailed',
      message: `The Reddit image upload did not complete: ${input.uploadError} Remove it to create the campaign without the image.`,
    };
  }
  const hasImage = redditImageAssetForBrief(input.assetId, input.assetBriefId, briefId) || input.uploadStatus === 'uploading';
  if (!hasImage) return null;
  if (input.creativeEnabled === false || input.assetUploadEnabled === false) {
    return {
      kind: 'unsupported',
      message: 'Image upload is not available on this deployment, so the uploaded Reddit image cannot be sent. Remove it to create the campaign without it.',
    };
  }
  if (input.createCapabilityRead === 'pending') return { kind: 'pending', message: 'Checking Reddit image upload support…' };
  if (!briefId) {
    return {
      kind: 'unsaved',
      message: "Reddit image upload support can't be checked until this brief is saved. Save the brief, or remove the uploaded image.",
    };
  }
  return {
    kind: 'failed',
    message:
      'Could not confirm that Reddit image upload is supported, so the uploaded image cannot be sent yet. Retry the check, or remove the uploaded image.',
  };
}

/**
 * Whether an upload in flight holds Create: only while the upload control (with its status and Cancel) is
 * shown. While it is hidden `redditImageAssetBlock` holds Create instead; with a post URL set the asset is
 * not sent, so nothing waits for it.
 */
export function redditImageUploadHoldsCreate(input: {
  showRedditSection: boolean;
  uploadAvailable: boolean;
  postUrl: string;
  uploadStatus: CreativeAssetUploadStatus;
}): boolean {
  return input.showRedditSection && input.uploadAvailable && !input.postUrl && input.uploadStatus === 'uploading';
}

/**
 * Why a chosen file cannot be uploaded as the Reddit image, or `null`: a PNG or JPEG, at most
 * `CREATIVE_ASSET_MAX_BYTES`, for a saved brief in a project. Checked in this order, before any upload.
 */
export function redditImageFileRefusal(file: { type: string; size: number }, briefId: string, projectSlug: string): string | null {
  if (!isCreativeAssetMimeType(file.type)) return CREATIVE_ASSET_WRONG_TYPE_MESSAGE;
  if (file.size > CREATIVE_ASSET_MAX_BYTES) return CREATIVE_ASSET_TOO_LARGE_MESSAGE;
  if (!briefId || !projectSlug) return 'Save the brief before uploading an image for it.';
  return null;
}

/** The upload control's status line: progress, or the uploaded file for the open brief; empty otherwise. */
export function redditImageUploadStatusMessage(uploadStatus: CreativeAssetUploadStatus, assetForThisBrief: boolean, assetName: string): string {
  if (uploadStatus === 'uploading') return 'Uploading image…';
  return assetForThisBrief ? `Uploaded: ${assetName || 'image'}` : '';
}

/** What the always-mounted live region announces: the status line while the control is shown, else nothing (the block's region speaks). */
export function redditImageUploadLiveMessage(uploadAvailable: boolean, statusMessage: string): string {
  return uploadAvailable ? statusMessage : '';
}

/** The file input's `aria-describedby`: hint and live status always, and the refusal while there is one. */
export function redditImageFileDescribedBy(uploadStatus: CreativeAssetUploadStatus): string {
  return ['reddit-image-file-hint', 'reddit-image-file-status', ...(uploadStatus === 'error' ? ['reddit-image-file-error'] : [])].join(' ');
}

/**
 * The pre-submit warning that a Reddit create would make no ad, or `null`. Judged on the payload's own
 * gates (a post URL, or the image `redditImageField` sends), so it never disagrees with the request. It
 * names only the fields the operator can see: with the authored-post controls withheld, an image URL is
 * not a remedy. "Will not change that", not "stays refused": the clause has to hold on both creators (#3451).
 */
export function redditNoAdWarning(input: RedditNoAdWarningInput): string | null {
  if (!input.showRedditSection || input.postUrl) return null;
  if (Object.keys(input.image).length > 0) return null;
  const missing = input.creativeAvailable ? 'No post URL and no image URL' : 'No post URL';
  return `${missing}, so this campaign is created with no ad: the campaign and its ad group are made and the create reports success, but nothing serves. Activating it from LFX will not change that, so either supply a post above or build and launch the campaign in Reddit Ads Manager.`;
}
