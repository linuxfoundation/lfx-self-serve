// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_IMAGE_MAX_BYTES,
  GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_RUNE_COUNTED_CONTROLS,
  GOOGLE_DEMAND_GEN_VIDEO_CREATIVE_FIELD_SPECS,
  GOOGLE_DEMAND_GEN_VIDEO_REQUEST_KEY,
  GOOGLE_ADS_MAX_PERFORMANCE_MAX_SEARCH_THEMES,
  GOOGLE_ADS_MAX_SEARCH_THEME_RUNES,
  GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH,
  googleAdsEchoed,
  googleAdsToLower,
  googleAdsTrimSpace,
} from '../constants/campaign.constants';
import type { GoogleCreativeFieldSpec, GoogleCreativeImageShape, GoogleCreativeWireFields, StoredCreativeAsset } from '../interfaces/campaign.interface';
import { googleAdsTextWeight } from './campaign-google-search-ads.utils';
import { codePointLength } from './string.utils';

/**
 * A Google creative field value's length as campaign-service measures it for that field, to compare
 * with the field's `width` in `GOOGLE_CREATIVE_FIELD_SPECS`.
 *
 * Headlines, long headlines, descriptions and business names are bounded by `textWeight`
 * (`validateCreativeText` and the business-name checks in `pmax_creative.go`, `demandgen_creative.go`
 * and `display_creative.go`), where a double-width character counts twice, so a 46-ideograph
 * description that fits 90 code points is still refused upstream. The fields in
 * {@link GOOGLE_CREATIVE_RUNE_COUNTED_CONTROLS} are bounded by rune count, which
 * {@link codePointLength} is. The caller trims; this measures what it is given.
 */
export function googleCreativeFieldWidth(control: string, text: string): number {
  return GOOGLE_CREATIVE_RUNE_COUNTED_CONTROLS.includes(control) ? codePointLength(text) : googleAdsTextWeight(text);
}

/**
 * How far an image's aspect ratio sits from a Google slot's target, as a fraction of the target.
 *
 * campaign-service's `ShapeRule.ratioDrift` (`internal/creative/slot.go`), and the same function
 * serves as both the gate and the ranking key for the reason upstream gives: a ranking computed
 * differently from the gate could prefer an image the gate refuses. Zero for an image with no
 * recorded height, which {@link googleCreativeImageFit} reports as unknown before asking.
 */
export function googleCreativeImageDrift(asset: Pick<StoredCreativeAsset, 'width' | 'height'>, shape: GoogleCreativeImageShape): number {
  if (!asset.width || !asset.height) return 0;
  const want = shape.ratioW / shape.ratioH;
  const got = asset.width / asset.height;
  return Math.abs(got - want) / want;
}

/**
 * Whether a stored image meets a Google slot's shape — `ShapeRule.fits` over the dimensions the
 * library recorded at upload — and its byte cap, `GOOGLE_CREATIVE_IMAGE_MAX_BYTES`, which upstream's
 * `SlotSpec.Eligible` checks first and which an image of any shape can fail.
 *
 * `unknown` is its own answer, as upstream's classifier keeps it: an asset stored before
 * campaign-service recorded dimensions has none, and "not measured" is not "the wrong shape". The
 * Implement tab neither offers such an image nor blocks one already held, and campaign-service
 * still decodes the bytes and checks the shape before anything is created.
 */
export function googleCreativeImageFit(
  asset: Partial<Pick<StoredCreativeAsset, 'width' | 'height' | 'byteSize'>>,
  shape: GoogleCreativeImageShape
): 'fits' | 'misfit' | 'unknown' {
  if (asset.byteSize !== undefined && asset.byteSize > GOOGLE_CREATIVE_IMAGE_MAX_BYTES) return 'misfit';
  if (!asset.width || !asset.height) return 'unknown';
  if (asset.width < shape.minWidth || asset.height < shape.minHeight) return 'misfit';
  return googleCreativeImageDrift(asset, shape) <= GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE ? 'fits' : 'misfit';
}

/**
 * A Google slot's shape as a sentence, e.g. `1.91:1 (within 1%), at least 600x314 px, up to 5 MB`.
 *
 * The 1.91:1 marketing ratio is stated upstream as 191:100 and rendered in the form Google and the
 * catalogue labels use; every other ratio is already in lowest terms.
 */
export function googleCreativeImageRequirement(shape: GoogleCreativeImageShape): string {
  const ratio = shape.ratioH === 100 ? `${shape.ratioW / 100}:1` : `${shape.ratioW}:${shape.ratioH}`;
  const tolerance = Math.round(GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE * 100);
  return `${ratio} (within ${tolerance}%), at least ${shape.minWidth}x${shape.minHeight} px, up to ${GOOGLE_CREATIVE_IMAGE_MAX_BYTES / (1024 * 1024)} MB`;
}

/**
 * A stored image as an operator can tell it apart from its neighbours: its size, its type and the
 * head of its id. The library records no file name, so the id is what separates two images of the
 * same size; eight characters is the first uuid group.
 */
export function storedCreativeAssetLabel(asset: Pick<StoredCreativeAsset, 'id' | 'mimeType' | 'width' | 'height'>): string {
  const size = asset.width && asset.height ? `${asset.width}x${asset.height}` : 'Size unknown';
  const type = asset.mimeType === 'image/png' ? 'PNG' : 'JPEG';
  return `${size} ${type} · ${asset.id.slice(0, 8)}`;
}

/**
 * Whether a Performance Max creative's descriptions lack the short one Google requires (#5219).
 *
 * campaign-service's `validatePerformanceMaxCreative` (`pmax_creative.go`) refuses a started
 * Performance Max creative unless at least one description has a display width of
 * {@link GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH} or less, measured by `textWeight` — the same
 * double-width count {@link googleAdsTextWeight} mirrors — on the trimmed line. It refuses before the
 * budget, but the job then reports only "platform campaign creation failed".
 *
 * Judged only once a non-blank description is present: a list with none is the minimum-count rule's
 * business, and a creative with nothing in it is a create upstream accepts. A non-string entry and a
 * blank line are skipped, as the request builders drop both before the wire.
 */
export function googlePerformanceMaxShortDescriptionMissing(descriptions: unknown): boolean {
  if (!Array.isArray(descriptions)) return false;
  const lines = descriptions
    .filter((line): line is string => typeof line === 'string')
    .map((line) => googleAdsTrimSpace(line))
    .filter((line) => line !== '');
  if (lines.length === 0) return false;
  return !lines.some((line) => googleAdsTextWeight(line) <= GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH);
}

/**
 * Why campaign-service would refuse a Performance Max search-theme list, or `null` when it would not.
 * One judge for the Implement tab, which holds Create on it, and the BFF, which refuses with the same
 * sentence.
 *
 * `validatePerformanceMaxSignals` (`pmax_signals.go`, v1.0.31) in its own order: the cap on the
 * SUBMITTED list ({@link GOOGLE_ADS_MAX_PERFORMANCE_MAX_SEARCH_THEMES}) before any entry, then each
 * entry, first bad one wins — blank, over {@link GOOGLE_ADS_MAX_SEARCH_THEME_RUNES} runes, or a repeat
 * keyed on Go's `strings.ToLower`. A repeat is REFUSED, not collapsed, as upstream refuses it.
 *
 * The entries are judged as given: both callers normalise them with `googleAdsDecodedText` first (a lone
 * surrogate becomes U+FFFD, as Go decodes it, then Go's trim), so they judge the same strings. The
 * channel and the asset-group rule are the caller's, because they need the request around the list.
 * `index` is reported from 1; upstream numbers from 0.
 */
export function googlePerformanceMaxSearchThemesRefusal(themes: readonly string[]): string | null {
  if (themes.length > GOOGLE_ADS_MAX_PERFORMANCE_MAX_SEARCH_THEMES) {
    return `Google Ads accepts at most ${GOOGLE_ADS_MAX_PERFORMANCE_MAX_SEARCH_THEMES} search themes on a Performance Max asset group, and this one has ${themes.length}. Remove some and create again.`;
  }
  const seen = new Set<string>();
  for (const [index, theme] of themes.entries()) {
    if (theme === '') return `Google Ads search themes cannot include a blank entry (search theme ${index + 1}). Remove it and create again.`;
    const runes = [...theme].length;
    if (runes > GOOGLE_ADS_MAX_SEARCH_THEME_RUNES) {
      return `Google Ads accepts search themes of at most ${GOOGLE_ADS_MAX_SEARCH_THEME_RUNES} characters, and search theme ${index + 1} (${googleAdsEchoed(theme)}) has ${runes}. Shorten it and create again.`;
    }
    const key = googleAdsToLower(theme);
    if (seen.has(key)) {
      return `Google Ads refuses a Performance Max asset group that lists the search theme ${googleAdsEchoed(theme)} more than once. Remove the repeat and create again.`;
    }
    seen.add(key);
  }
  return null;
}

/** One creative catalogue, reduced to what the BFF's normalizer needs: its request key and each field's shape. */
export function googleCreativeWireFields(key: string, fields: readonly GoogleCreativeFieldSpec[]): GoogleCreativeWireFields {
  return {
    key,
    lists: fields.filter((f) => f.kind === 'list').map((f) => f.control),
    images: fields.filter((f) => f.image !== undefined).map((f) => f.control),
    scalars: fields.filter((f) => f.kind === 'text').map((f) => f.control),
  };
}

/**
 * Which `googleAdsConfig` creative key each Google channel uses, and which of its fields are lists
 * rather than scalars — derived from the shared catalogue, never restated.
 *
 * The BFF's normalizer needs exactly two things per field: its name, and whether an array or a
 * string is the valid shape. Both are already stated in `GOOGLE_CREATIVE_FIELD_SPECS`, which the
 * Implementation tab reads to build the form that produces these bodies. Restating them — which the
 * controller's table used to do — meant the form and the normalizer could disagree about a field's
 * shape, and the disagreement would surface as a body Google rejects after the campaign already
 * exists. `display.longHeadline` is the live example: a **scalar** where Performance Max's
 * `longHeadlines` is a list.
 *
 * `images` is the subset of `lists` whose entries may also be a stored-asset ref
 * (`{ imageAssetId }`) — the fields the catalogue gives an image shape. `youtubeVideoIds` is a list
 * but not an image slot, so an object there is dropped as before.
 *
 * One entry per channel's image creative. Demand Gen's second creative, its video ad, is
 * {@link GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS}. `video` has no entry on purpose — see
 * `GOOGLE_VIDEO_CREATE_SUPPORTED`. `search` has none either: its copy rides as top-level
 * `headlines`/`descriptions`/`keywords`, not under a creative key.
 */
export const GOOGLE_CREATIVE_WIRE_FIELDS: Readonly<Record<string, GoogleCreativeWireFields>> = Object.fromEntries(
  GOOGLE_CHANNELS_WITH_CREATIVE.map((channel) => [
    channel,
    googleCreativeWireFields(GOOGLE_CREATIVE_REQUEST_KEYS[channel], GOOGLE_CREATIVE_FIELD_SPECS[channel]),
  ])
);

/**
 * The Demand Gen VIDEO ad's wire shape (#5226): the second creative Demand Gen can carry, under its own
 * key, sent INSTEAD of `demandGenCreative`. Kept out of {@link GOOGLE_CREATIVE_WIRE_FIELDS} because that
 * table is one image creative per channel.
 */
export const GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS: GoogleCreativeWireFields = googleCreativeWireFields(
  GOOGLE_DEMAND_GEN_VIDEO_REQUEST_KEY,
  GOOGLE_DEMAND_GEN_VIDEO_CREATIVE_FIELD_SPECS
);
