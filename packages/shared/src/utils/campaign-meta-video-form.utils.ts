// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CREATIVE_ASSET_VIDEO_MAX_BYTES,
  CREATIVE_ASSET_VIDEO_MIME_TYPE,
  CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE,
} from '../constants/campaign.constants';
import type {
  CampaignImplementationDraft,
  CreativeAssetLibraryState,
  LinkedInCarouselImageOption,
  MetaAdVariant,
  MetaImageField,
  MetaVariantVideoDraft,
  MetaVariantVideoView,
  MetaVideoUploadPending,
  MetaVideoUploadState,
} from '../interfaces/campaign.interface';
import { metaVariantsWithImage } from './campaign-meta-image.utils';
import { metaVideoRefusal } from './campaign-meta-video.utils';

/**
 * The Meta video ad controls on the Implement tab (#6332, #5980 approach 4): which variant sends which stored MP4, the
 * picker and upload each variant shows, when the videos hold Create, and what the draft keeps. Pure, so the matrix is
 * tested here; the component reads them through its signals and keeps the upload itself (HTTP, cancel, resume).
 *
 * The variants come from the brief's copy and are not edited on the tab, so each video is held by the variant's
 * position. The rules campaign-service enforces on the request are `metaVideoRefusal`'s, read here, never restated.
 */

const NO_VIDEO: MetaVariantVideoDraft = { assetId: '', assetName: '', assetBriefId: '' };

/** Whether variant `index` holds a video stored for the open brief (`briefId`): the only one a create sends. */
export function metaVariantVideoForBrief(videos: readonly MetaVariantVideoDraft[], index: number, briefId: string): boolean {
  const video = videos[index];
  return briefId !== '' && video !== undefined && video.assetId !== '' && video.assetBriefId === briefId;
}

/** `videos` with variant `index` set to `video` (or, with `''` ids, cleared), padded so every earlier variant has an entry. */
export function metaVariantVideosWith(videos: readonly MetaVariantVideoDraft[], index: number, video: MetaVariantVideoDraft): MetaVariantVideoDraft[] {
  const next = Array.from({ length: Math.max(videos.length, index + 1) }, (_, i) => ({ ...(videos[i] ?? NO_VIDEO) }));
  next[index] = { ...video };
  return next;
}

/** `videos` with every variant naming `assetId` cleared: a stored video deleted, or taken off the ads in the library. */
export function metaVariantVideosWithout(videos: readonly MetaVariantVideoDraft[], assetId: string): MetaVariantVideoDraft[] {
  return videos.map((video) => (video.assetId === assetId ? { ...NO_VIDEO } : { ...video }));
}

/** The stored videos the first `count` variants name, whatever their brief: the library will not delete them. */
export function metaVideoIdsInUse(videos: readonly MetaVariantVideoDraft[], count: number): string[] {
  return [
    ...new Set(
      videos
        .slice(0, count)
        .map((video) => video.assetId)
        .filter((id) => id !== '')
    ),
  ];
}

/** Whether any of the first `count` variants has a video chosen, for this brief or another. */
function anyVideoChosen(videos: readonly MetaVariantVideoDraft[], count: number): boolean {
  return videos.slice(0, count).some((video) => video.assetId !== '');
}

/**
 * Whether the one Meta image is used by a variant: always while video ads are not offered (`available`), else while a
 * variant has no video chosen. When every variant is a video ad the image goes nowhere, so its input is hidden.
 */
export function metaImageWanted(count: number, videos: readonly MetaVariantVideoDraft[], available: boolean): boolean {
  if (!available || count === 0) return true;
  return Array.from({ length: count }, (_, i) => videos[i]?.assetId ?? '').some((id) => id === '');
}

/**
 * The Meta variants as a create sends them. While video ads are not offered, exactly as before: each carries the one
 * image (`metaVariantsWithImage`). While they are, a variant with a video stored for the open brief carries that
 * `videoAssetId` and no image (Meta uses one of the video's own thumbnails); every other variant carries the image.
 */
export function metaVariantsWithMedia(
  variants: readonly MetaAdVariant[],
  image: MetaImageField,
  videos: readonly MetaVariantVideoDraft[],
  context: { available: boolean; briefId: string }
): MetaAdVariant[] {
  const withImage = metaVariantsWithImage([...variants], image);
  if (!context.available) return withImage;
  return variants.map((variant, i) => (metaVariantVideoForBrief(videos, i, context.briefId) ? { ...variant, videoAssetId: videos[i].assetId } : withImage[i]));
}

/**
 * Why a picked file cannot be uploaded as a Meta video, or `null`: an MP4, at most `CREATIVE_ASSET_VIDEO_MAX_BYTES` (the
 * upload route's limit), for a saved brief in a project. Checked in this order, before any upload.
 */
export function metaVideoFileRefusal(file: { type: string; size: number }, briefId: string, projectSlug: string): string | null {
  if (file.type !== CREATIVE_ASSET_VIDEO_MIME_TYPE) return CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE;
  if (file.size > CREATIVE_ASSET_VIDEO_MAX_BYTES) return CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE;
  if (!briefId || !projectSlug) return 'Save the brief before uploading a video for it.';
  return null;
}

/**
 * Why variant `index`'s chosen video cannot be sent, or `''`: stored for another brief, or a picked video gone from a
 * library that was read. A video uploaded on this tab (it has a file name) is not judged by a read that may predate it;
 * a delete in the library clears it from the ads, and campaign-service checks the asset exists before any Meta call.
 */
function videoProblem(video: MetaVariantVideoDraft | undefined, library: CreativeAssetLibraryState, briefId: string): string {
  if (video === undefined || video.assetId === '' || briefId === '') return '';
  if (video.assetBriefId !== briefId) return "Stored for a different brief. Choose a video from this brief's library, or no video.";
  if (video.assetName === '' && library.status === 'ready' && !(library.videos ?? []).some((stored) => stored.id === video.assetId))
    return "No longer in the brief's library. Choose another video, or no video.";
  return '';
}

/**
 * The picker's options: no video, then the brief's stored MP4s, named as the library lists them (or by the file name
 * when uploaded on this tab), then any video held for this brief that a read has not listed yet (a fresh upload).
 */
function videoOptions(videos: readonly MetaVariantVideoDraft[], library: CreativeAssetLibraryState, briefId: string): LinkedInCarouselImageOption[] {
  const names = new Map(videos.filter((video) => video.assetBriefId === briefId && video.assetName !== '').map((video) => [video.assetId, video.assetName]));
  const stored = library.status === 'ready' ? (library.videos ?? []) : [];
  const options = stored.map((video, i) => ({ value: video.id, label: names.get(video.id) ?? `Video ${i + 1} (${video.checksum.slice(0, 8)})` }));
  for (const video of videos) {
    if (video.assetId === '' || video.assetBriefId !== briefId || options.some((option) => option.value === video.assetId)) continue;
    options.push({ value: video.assetId, label: video.assetName || `Stored video ${video.assetId.slice(0, 8)}` });
  }
  return [{ value: '', label: 'No video (image ad)' }, ...options];
}

/** Each of the first `count` variants' video control: its pick, its options, why it cannot be sent, and the upload's state. */
export function metaVariantVideoViews(
  count: number,
  videos: readonly MetaVariantVideoDraft[],
  library: CreativeAssetLibraryState,
  briefId: string,
  upload: MetaVideoUploadState
): MetaVariantVideoView[] {
  const options = videoOptions(videos.slice(0, count), library, briefId);
  return Array.from({ length: count }, (_, i) => {
    const video = videos[i];
    const mine = upload.variant === i;
    const uploading = mine && upload.status === 'uploading';
    let status = '';
    if (uploading) status = `Uploading ${upload.name || 'video'}…`;
    else if (metaVariantVideoForBrief(videos, i, briefId) && video.assetName !== '') status = `Uploaded: ${video.assetName}`;
    return {
      assetId: metaVariantVideoForBrief(videos, i, briefId) ? video.assetId : '',
      options,
      problem: videoProblem(video, library, briefId),
      uploading,
      status,
      error: mine && upload.status === 'error' ? upload.error : '',
    };
  });
}

/**
 * Why the variants' videos hold Create, or `null`. A video chosen while video ads are not offered is held, never sent
 * as an image ad instead; then each variant's chosen video that cannot be sent; then the request the tab would send
 * (`config`, its `variants` and `leadFormId` as they go out), checked by `metaVideoRefusal` as the create route will.
 */
export function metaVideoCreateRefusal(input: {
  available: boolean;
  count: number;
  videos: readonly MetaVariantVideoDraft[];
  library: CreativeAssetLibraryState;
  briefId: string;
  config: { variants: readonly MetaAdVariant[]; leadFormId?: string };
}): string | null {
  if (!input.available) {
    return anyVideoChosen(input.videos, input.count) ? 'Meta Ads: video ads are not available right now. Set each ad to no video to send image ads.' : null;
  }
  for (let i = 0; i < input.count; i++) {
    const problem = videoProblem(input.videos[i], input.library, input.briefId);
    if (problem !== '') return `Meta Ads: the video on variant ${i + 1} cannot be sent. ${problem}`;
  }
  const refusal = metaVideoRefusal(input.config, true);
  return refusal === null ? null : `Meta Ads: ${refusal.message}`;
}

/** What the draft keeps: each variant's video as values, and the upload in flight, if any. */
export function metaVideoDraftFields(
  videos: readonly MetaVariantVideoDraft[],
  pending: MetaVideoUploadPending | null
): Pick<CampaignImplementationDraft, 'metaVariantVideos' | 'metaVideoUploadPending'> {
  return { metaVariantVideos: videos.map((video) => ({ ...video })), metaVideoUploadPending: pending === null ? null : { ...pending } };
}

/** A stored string, or `''`. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * What a restored draft sets back: the videos only when the draft carries a list (each entry read field by field, so a
 * malformed one is no video), and an upload to resume only with a file name and a variant position.
 */
export function metaVideoDraftRestore(draft: Pick<CampaignImplementationDraft, 'metaVariantVideos' | 'metaVideoUploadPending'>): {
  videos?: MetaVariantVideoDraft[];
  pendingUpload?: MetaVideoUploadPending;
} {
  const raw: unknown = draft.metaVariantVideos;
  const pending = draft.metaVideoUploadPending as Partial<Record<keyof MetaVideoUploadPending, unknown>> | null | undefined;
  const videos = Array.isArray(raw)
    ? raw.map((entry: unknown) => {
        const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
        return { assetId: text(record['assetId']), assetName: text(record['assetName']), assetBriefId: text(record['assetBriefId']) };
      })
    : undefined;
  const resumable = pending && text(pending.name) !== '' && Number.isInteger(pending.variant) && (pending.variant as number) >= 0;
  return {
    ...(videos === undefined ? {} : { videos }),
    ...(resumable ? { pendingUpload: { variant: pending.variant as number, name: text(pending.name), briefId: text(pending.briefId) } } : {}),
  };
}
