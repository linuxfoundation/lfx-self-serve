// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_VIDEO_KEYS } from '../constants/campaign.constants';
import type { RedditConfigRefusal } from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';

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
