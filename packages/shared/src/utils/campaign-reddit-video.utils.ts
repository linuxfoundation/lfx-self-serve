// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_VIDEO_KEYS } from '../constants/campaign.constants';
import type {
  CreativeAssetLibraryState,
  RedditCampaignCreateRequest,
  RedditConfigRefusal,
  RedditVideoPostDraft,
  RedditVideoPostOption,
  RedditVideoPostView,
} from '../interfaces/campaign.interface';
import { storedCreativeAssetLabel } from './campaign-google-creative.utils';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';
import { formatFileSize } from './file.utils';

/**
 * A Reddit video post from stored assets on create (#6108 row 8): `redditConfig.videoAssetId` and `thumbnailAssetId`,
 * held to campaign-service's `checkRedditVideoShape` and `checkRedditVideoChoice` (`internal/dispatch/reddit_video.go`,
 * #549), so a create campaign-service would refuse is refused here first, with the field to point at. Where its reading
 * of a neighbouring field could differ from Go's `encoding/json`, that one rule steps aside and leaves the create to
 * campaign-service. Messages never echo a caller value.
 */

const VIDEO_FIELD = 'redditConfig.videoAssetId';
const THUMBNAIL_FIELD = 'redditConfig.thumbnailAssetId';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The value of `key` in `record` as Go matches keys (ignoring case), or `undefined` when absent. `null` when the reading
 * is ambiguous: several spellings that fold to `key`, or a spelling that is not ASCII (where JavaScript's case folding is
 * not Go's). The form never sends one.
 */
function goValue(record: Record<string, unknown>, key: string): { value: unknown } | null {
  const spellings = Object.keys(record).filter((k) => foldKey(k) === foldKey(key));
  if (spellings.length > 1 || spellings.some((k) => /[^\x20-\x7e]/.test(k))) return null;
  return { value: spellings.length === 0 ? undefined : record[spellings[0]] };
}

/**
 * Whether `key` is set to a non-blank string. campaign-service's best-effort decode reads anything that is not a string
 * as blank, and an ambiguous spelling is read as blank too, so this never refuses what campaign-service might accept.
 */
function setText(record: Record<string, unknown>, key: string): boolean {
  const read = goValue(record, key);
  return typeof read?.value === 'string' && goTrimSpace(read.value) !== '';
}

/** How many variants campaign-service decodes: a list's length, `0` for anything else, `null` when ambiguous. */
function variantCount(record: Record<string, unknown>): number | null {
  const read = goValue(record, 'variants');
  if (read === null) return null;
  return Array.isArray(read.value) ? read.value.length : 0;
}

/**
 * `text` as Go's `github.com/google/uuid` `Parse` reads it, in canonical lower-case form, or `null` when it would refuse
 * it. `Parse` takes the hyphenated 36-character form, that form after `urn:uuid:` (any case) or between any two
 * one-byte characters (meant for braces, but `Parse` checks neither), and the 32 hex digits without hyphens. A
 * non-ASCII wrapper is more than one byte in Go, so it is refused.
 */
export function goParseUuid(text: string): string | null {
  let body = text;
  if (text.length === 45) {
    if (text.slice(0, 9).toLowerCase() !== 'urn:uuid:') return null;
    body = text.slice(9);
  } else if (text.length === 38) {
    if (text.charCodeAt(0) > 0x7f || text.charCodeAt(37) > 0x7f) return null;
    body = text.slice(1, 37);
  }
  let hex: string;
  if (body.length === 36) {
    if (body[8] !== '-' || body[13] !== '-' || body[18] !== '-' || body[23] !== '-') return null;
    hex = body.slice(0, 8) + body.slice(9, 13) + body.slice(14, 18) + body.slice(19, 23) + body.slice(24);
  } else if (body.length === 32 && body === text) {
    hex = body;
  } else {
    return null;
  }
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const lower = hex.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

/**
 * Why `raw`'s video post cannot be sent, or `null` (#6108 row 8). Typed runtime checks, since the create route forwards
 * `redditConfig` as it comes. `enabled` is whether this deployment can send a video post (`canSetRedditVideo`: URL
 * signing configured and campaign-service's `REDDIT_VIDEO_ENABLED` on); `adPerVariantEnabled` whether one ad per
 * variant is on (`canSetRedditAdPerVariant`). In campaign-service's order, refused:
 *
 * - a different spelling of either key, whatever the flag, since it would reach campaign-service past the checks here;
 * - a present value that is not a string (`null` is absent);
 * - then nothing more when both are blank once trimmed as Go trims: blank is absent;
 * - either one while this deployment cannot send a video post (`enabled` false): refused, never dropped, since the
 *   legacy creator ignores them and campaign-service refuses them;
 * - a thumbnail without a video, then a video without a thumbnail (Reddit requires one);
 * - a video beside `postUrl`, `imageUrl` or `imageAssetId`: one creative per ad;
 * - a video with 2 or more variants while one ad per variant is on: a video post is one post and one ad;
 * - an id that is not a UUID as Go's `uuid.Parse` reads it, the video's first;
 * - the same asset named twice: the thumbnail must be a separate image.
 *
 * Left to campaign-service: whether each asset exists for this brief and is an MP4 or a PNG/JPEG, which it checks
 * before any Reddit call.
 */
export function redditVideoRefusal(raw: unknown, enabled: boolean, adPerVariantEnabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const key of REDDIT_VIDEO_KEYS) {
    if (Object.keys(config).some((other) => other !== key && foldKey(other) === foldKey(key))) {
      return { field: `redditConfig.${key}`, message: `Send it as "${key}", spelled exactly.` };
    }
    const value = config[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { field: `redditConfig.${key}`, message: 'Send the asset id as text.' };
    }
  }
  const text = (key: string): string => (typeof config[key] === 'string' ? goTrimSpace(config[key] as string) : '');
  const video = text('videoAssetId');
  const thumbnail = text('thumbnailAssetId');
  if (video === '' && thumbnail === '') return null;
  if (!enabled) {
    return {
      field: video !== '' ? VIDEO_FIELD : THUMBNAIL_FIELD,
      message: 'Reddit video posts are not enabled on this deployment. Remove the video and its thumbnail and create again.',
    };
  }
  if (video === '') return { field: VIDEO_FIELD, message: 'A thumbnail belongs to a video post. Add the video, or remove the thumbnail.' };
  if (thumbnail === '') return { field: THUMBNAIL_FIELD, message: 'Reddit requires a thumbnail for a video post. Upload a PNG or JPEG for it.' };
  if (['postUrl', 'imageUrl', 'imageAssetId'].some((key) => setText(config, key))) {
    return { field: VIDEO_FIELD, message: 'A video post cannot also promote an existing post or carry an image. Keep only the video.' };
  }
  const variants = variantCount(config);
  if (adPerVariantEnabled && variants !== null && variants >= 2) {
    return { field: 'redditConfig.variants', message: 'A video post makes one Reddit ad, so send one variant with it.' };
  }
  const videoId = goParseUuid(video);
  if (videoId === null) return { field: VIDEO_FIELD, message: 'The video is not a valid asset id. Upload it again.' };
  const thumbnailId = goParseUuid(thumbnail);
  if (thumbnailId === null) return { field: THUMBNAIL_FIELD, message: 'The thumbnail is not a valid asset id. Upload it again.' };
  if (videoId === thumbnailId) return { field: THUMBNAIL_FIELD, message: 'The thumbnail names the video itself. Upload a separate PNG or JPEG.' };
  return null;
}

// === The Implement tab's video post editor (#6108 row 8) ===

/** Whether the video post is offered: only an explicit yes from `CampaignListResult.redditVideoEnabled`. */
export function redditVideoPostCapability(enabled: boolean | null): boolean {
  return enabled === true;
}

/** A video post with nothing picked. */
export function emptyRedditVideoPostDraft(): RedditVideoPostDraft {
  return { videoAssetId: '', videoBriefId: '', thumbnailAssetId: '', thumbnailBriefId: '' };
}

/** Whether the video post holds a pick, the video or its thumbnail. Only then does the draft carry it. */
export function redditVideoPostHeld(draft: RedditVideoPostDraft): boolean {
  return draft.videoAssetId !== '' || draft.thumbnailAssetId !== '';
}

/**
 * Whether a create is a video post: offered on an explicit yes, and the video or its thumbnail picked. Then the post is
 * authored from the video, variant 1 alone heads it, and Create waits until the pair is complete. A pick restored after
 * the capability went off is kept, but sends nothing: the create is exactly as before row 8.
 */
export function redditVideoPostChosen(draft: RedditVideoPostDraft, enabled: boolean | null): boolean {
  return redditVideoPostCapability(enabled) && redditVideoPostHeld(draft);
}

/**
 * The request's video fields: nothing unless a video post is chosen, and each id only when it was picked for the brief
 * now open. A pick for another brief is not sent; it holds Create instead (`redditVideoPostCreateRefusal`).
 */
export function redditVideoPostField(
  draft: RedditVideoPostDraft,
  briefId: string,
  enabled: boolean | null
): Pick<RedditCampaignCreateRequest, 'videoAssetId' | 'thumbnailAssetId'> {
  if (!redditVideoPostChosen(draft, enabled)) return {};
  return {
    ...(draft.videoAssetId !== '' && draft.videoBriefId === briefId ? { videoAssetId: draft.videoAssetId } : {}),
    ...(draft.thumbnailAssetId !== '' && draft.thumbnailBriefId === briefId ? { thumbnailAssetId: draft.thumbnailAssetId } : {}),
  };
}

/** The variants a create sends: variant 1 alone with a video post, which is one post and one ad; otherwise all of them. */
export function redditVariantsSent<T>(variants: readonly T[], videoPost: boolean): T[] {
  return videoPost ? variants.slice(0, 1) : [...variants];
}

/**
 * What the video post says about the variants it leaves out, or `''`: a video post is one post and one ad, so only
 * variant 1 is sent (`redditVariantsSent`), and the operator is told rather than left to find the others missing.
 */
export function redditVideoPostVariantsNote(draft: RedditVideoPostDraft, variantCount: number): string {
  if (!redditVideoPostHeld(draft) || variantCount < 2) return '';
  return variantCount === 2
    ? 'Only variant 1 is sent with a video post. Variant 2 is not sent.'
    : `Only variant 1 is sent with a video post. Variants 2 to ${variantCount} are not sent.`;
}

/** The draft with `assetId` picked as the video (`''` clears it), recorded with the brief it was picked for. */
export function redditVideoPostWithVideo(draft: RedditVideoPostDraft, assetId: string, briefId: string): RedditVideoPostDraft {
  return { ...draft, videoAssetId: assetId, videoBriefId: assetId === '' ? '' : briefId };
}

/** The draft with `assetId` picked as the thumbnail (`''` clears it), recorded with the brief it was picked for. */
export function redditVideoPostWithThumbnail(draft: RedditVideoPostDraft, assetId: string, briefId: string): RedditVideoPostDraft {
  return { ...draft, thumbnailAssetId: assetId, thumbnailBriefId: assetId === '' ? '' : briefId };
}

/** The draft without `assetId` wherever it is picked: a stored video the library deleted, or one taken off the ads there. */
export function redditVideoPostWithout(draft: RedditVideoPostDraft, assetId: string): RedditVideoPostDraft {
  if (assetId === '') return draft;
  const video = draft.videoAssetId === assetId ? redditVideoPostWithVideo(draft, '', '') : draft;
  return video.thumbnailAssetId === assetId ? redditVideoPostWithThumbnail(video, '', '') : video;
}

/** The video post a stored draft carries, or `undefined` when it carries none. Not type-checked when stored, so a field that is not text reads as blank. */
export function redditVideoPostFromDraft(value: unknown): RedditVideoPostDraft | undefined {
  const stored = plainRecord(value);
  if (!stored) return undefined;
  const text = (key: keyof RedditVideoPostDraft): string => (typeof stored[key] === 'string' ? (stored[key] as string) : '');
  return {
    videoAssetId: text('videoAssetId'),
    videoBriefId: text('videoBriefId'),
    thumbnailAssetId: text('thumbnailAssetId'),
    thumbnailBriefId: text('thumbnailBriefId'),
  };
}

/** The options of one picker: every listed asset, a held one the library does not list kept by id, and a first "none" option while one is held. */
function pickerOptions(listed: RedditVideoPostOption[], held: string, noun: 'video' | 'image'): RedditVideoPostOption[] {
  const options = [...listed];
  if (held !== '' && !listed.some((option) => option.value === held)) options.unshift({ value: held, label: `Stored ${noun} ${held.slice(0, 8)}` });
  if (held !== '') options.unshift({ value: '', label: `No ${noun} (choose again)` });
  return options;
}

/**
 * The videos the picker offers: every MP4 stored for the brief, labelled by the library's order, the checksum's start and
 * the size (campaign-service records no file name). One whose delete is running (`deletingId`) is not offered, so it
 * cannot be picked for a create that would name it once it is gone. See `pickerOptions` for the held and "none" options.
 */
export function redditVideoPostVideoOptions(library: CreativeAssetLibraryState, held: string, deletingId = ''): RedditVideoPostOption[] {
  const listed = (library.videos ?? [])
    .map((video, index) => ({ value: video.id, label: `Video ${index + 1} (${video.checksum.slice(0, 8)}, ${formatFileSize(video.byteSize)})` }))
    .filter((option) => deletingId === '' || option.value !== deletingId);
  return pickerOptions(listed, held, 'video');
}

/** The thumbnails the picker offers: every PNG or JPEG stored for the brief, labelled as every image picker labels them. */
export function redditVideoPostThumbnailOptions(library: CreativeAssetLibraryState, held: string): RedditVideoPostOption[] {
  return pickerOptions(
    library.assets.map((asset) => ({ value: asset.id, label: storedCreativeAssetLabel(asset) })),
    held,
    'image'
  );
}

/** Why the pickers offer nothing yet, or `''`. The library is not read (`idle`) while the brief is unsaved. */
function libraryNote(library: CreativeAssetLibraryState): string {
  switch (library.status) {
    case 'idle':
      return 'Save the brief to pick or upload its video.';
    case 'loading':
      return "Loading the brief's videos and images…";
    case 'error':
      return "Couldn't load the brief's library. Reload the page, or upload the video again.";
    case 'ready':
      if ((library.videos ?? []).length === 0) return 'No video is stored for this brief yet. Upload an MP4 to pick it.';
      return library.assets.length === 0 ? 'No image is stored for this brief yet. Upload a PNG or JPEG in the library below for the thumbnail.' : '';
  }
}

/**
 * What is wrong with one pick, or `''`. Judged against the brief only while its id is known (the tab has none while a
 * save runs, which is no evidence of another brief), and against the library only once it was read.
 */
function pickProblem(
  assetId: string,
  pickedBriefId: string,
  briefId: string,
  library: CreativeAssetLibraryState,
  listed: readonly string[],
  noun: string
): string {
  if (assetId === '' || briefId === '') return '';
  if (pickedBriefId !== briefId) return `Stored for a different brief. Choose a ${noun} from this brief's library.`;
  if (library.status !== 'ready') return '';
  return listed.includes(assetId) ? '' : `No longer in the brief's library. Choose another ${noun}.`;
}

/** The video post editor's view: both pickers, what is wrong with each pick, and why the pickers offer nothing yet. */
export function redditVideoPostView(draft: RedditVideoPostDraft, library: CreativeAssetLibraryState, briefId: string, deletingId = ''): RedditVideoPostView {
  const videoIds = (library.videos ?? []).map((video) => video.id);
  const imageIds = library.assets.map((asset) => asset.id);
  return {
    videoOptions: redditVideoPostVideoOptions(library, draft.videoAssetId, deletingId),
    thumbnailOptions: redditVideoPostThumbnailOptions(library, draft.thumbnailAssetId),
    videoProblem: pickProblem(draft.videoAssetId, draft.videoBriefId, briefId, library, videoIds, 'video'),
    thumbnailProblem: pickProblem(draft.thumbnailAssetId, draft.thumbnailBriefId, briefId, library, imageIds, 'thumbnail'),
    libraryNote: libraryNote(library),
  };
}

/**
 * Why a video post create waits, or `null`; nothing unless a video post is chosen (`redditVideoPostChosen`). In order: no
 * brief id (the assets are the saved brief's); a picked video whose delete is running; a pick the editor marks; then the
 * request the tab would send (`config`: its post, image, variants and video fields), checked by `redditVideoRefusal` as
 * the create route will, which names a missing video or thumbnail and a post URL or image beside the video.
 */
export function redditVideoPostCreateRefusal(
  draft: RedditVideoPostDraft,
  enabled: boolean | null,
  library: CreativeAssetLibraryState,
  briefId: string,
  deletingId: string,
  config: Record<string, unknown>,
  adPerVariantEnabled: boolean
): string | null {
  if (!redditVideoPostChosen(draft, enabled)) return null;
  if (briefId === '') return 'Save the brief to send its video post.';
  if (deletingId !== '' && draft.videoAssetId === deletingId) return 'Wait for the video to finish deleting, or choose another.';
  const view = redditVideoPostView(draft, library, briefId);
  if (view.videoProblem !== '') return `Video: ${view.videoProblem}`;
  if (view.thumbnailProblem !== '') return `Thumbnail: ${view.thumbnailProblem}`;
  return redditVideoRefusal(config, true, adPerVariantEnabled)?.message ?? null;
}
