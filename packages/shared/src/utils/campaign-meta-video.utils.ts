// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { META_VIDEO_OFF_MESSAGE } from '../constants/campaign.constants';
import type { MetaConfigRefusal } from '../interfaces/campaign.interface';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';
import { goParseUuid } from './campaign-reddit-video.utils';

/**
 * Meta video ads on create (#6332): `metaConfig.variants[].videoAssetId`, held to campaign-service's
 * `checkMetaVideoVariants` (`internal/dispatch/meta.go`, campaign-service#550 gap 9, v1.0.44) in its order, so a create
 * campaign-service would refuse is refused here first, with the field to point at. A video card in a carousel is
 * `metaCarouselRefusal`'s, which campaign-service checks after this. Messages never echo a caller value: a variant is
 * named by its position only.
 */

const VIDEO_KEY = 'videoAssetId';
const IMAGE_KEYS = ['imageUrl', 'imageAssetId'] as const;

/** The variants of `record` as a list, or none: campaign-service fails to decode any other shape on its own. */
function variantList(record: Record<string, unknown> | undefined): unknown[] {
  const variants = record?.['variants'];
  return Array.isArray(variants) ? variants : [];
}

/** Whether `value` is a string that is not blank once trimmed as Go's `strings.TrimSpace` trims. */
function goText(value: unknown): value is string {
  return typeof value === 'string' && goTrimSpace(value) !== '';
}

/** Whether `variant` carries an image under any spelling Go's `encoding/json` reads as `imageUrl` or `imageAssetId`. */
function hasImage(variant: Record<string, unknown>): boolean {
  const images = IMAGE_KEYS.map(foldKey);
  return Object.entries(variant).some(([key, value]) => images.includes(foldKey(key)) && goText(value));
}

/**
 * Why `raw`'s video variants cannot be sent, or `null`. Typed runtime checks, since the create route forwards each
 * variant as it comes. `enabled` is `canSetMetaVideo()`. Refused, naming `metaConfig.variants[i].videoAssetId`:
 *
 * 1. on any variant, `videoAssetId` under another spelling, whatever the flag: campaign-service decodes keys ignoring
 *    case, so `VideoAssetId` would reach it past every check here (`metaConfigKeyVariant` reads top-level keys only);
 * 2. a present value that is not a string (`null` is absent); then nothing more for a variant whose id is blank;
 * 3. in campaign-service's order, per variant: any id while video ads are off (refused, never dropped, since the legacy
 *    creator ignores it), an id that is not a UUID as Go's `uuid.Parse` reads it, an image on the same variant (Meta
 *    uses one of the video's own thumbnails), then a non-blank `metaConfig.leadFormId` (video lead ads are not built).
 *
 * Left to campaign-service: whether the asset exists for this brief and is an MP4, which it checks before any Meta call.
 */
export function metaVideoRefusal(raw: unknown, enabled: boolean): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const variants = variantList(record).map((entry) => metaConfigRecord(entry));
  const field = (i: number): string => `metaConfig.variants[${i}].${VIDEO_KEY}`;

  for (const [i, variant] of variants.entries()) {
    if (variant && Object.keys(variant).some((key) => key !== VIDEO_KEY && foldKey(key) === foldKey(VIDEO_KEY))) {
      return { field: field(i), message: `Send variant ${i + 1}'s video as ${field(i)}, spelled exactly.` };
    }
    const value = variant?.[VIDEO_KEY];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { field: field(i), message: `Variant ${i + 1}'s video must be text.` };
    }
  }

  for (const [i, variant] of variants.entries()) {
    const value = variant?.[VIDEO_KEY];
    if (!variant || !goText(value)) continue;
    if (!enabled) return { field: field(i), message: META_VIDEO_OFF_MESSAGE };
    if (goParseUuid(goTrimSpace(value)) === null) {
      return { field: field(i), message: `Variant ${i + 1}'s video must be a video uploaded to this brief.` };
    }
    if (hasImage(variant)) {
      return {
        field: field(i),
        message: `Variant ${i + 1} is a video ad, so it carries no image: Meta uses one of the video's own thumbnails. Remove its image.`,
      };
    }
    if (goText(record?.['leadFormId'])) {
      return { field: field(i), message: `A video ad cannot use a lead form. Remove the lead form, or use an image on variant ${i + 1}.` };
    }
  }
  return null;
}

/**
 * `variants` as a create forwards them: as they are while video ads are on (`enabled`, `canSetMetaVideo()`), and
 * otherwise with every key Go would read as `videoAssetId` removed, so a video reaches campaign-service only while the
 * gate is on. The create route already refuses a video on a create that selects Meta while off (`metaVideoRefusal`);
 * this covers a `metaConfig` riding along on a create that does not. The same list is returned when nothing is removed.
 */
export function metaVariantsToSend<T>(variants: T, enabled: boolean): T {
  if (enabled || !Array.isArray(variants)) return variants;
  let changed = false;
  const kept = variants.map((entry: unknown) => {
    const variant = metaConfigRecord(entry);
    if (!variant || !Object.keys(variant).some((key) => foldKey(key) === foldKey(VIDEO_KEY))) return entry;
    changed = true;
    return Object.fromEntries(Object.entries(variant).filter(([key]) => foldKey(key) !== foldKey(VIDEO_KEY)));
  });
  return (changed ? kept : variants) as T;
}
