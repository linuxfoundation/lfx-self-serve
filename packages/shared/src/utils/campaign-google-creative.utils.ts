// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_CREATIVE_IMAGE_MAX_BYTES,
  GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE,
  GOOGLE_CREATIVE_RUNE_COUNTED_CONTROLS,
  GOOGLE_PERFORMANCE_MAX_SHORT_DESCRIPTION_WIDTH,
  googleAdsTrimSpace,
} from '../constants/campaign.constants';
import type { GoogleCreativeImageShape, StoredCreativeAsset } from '../interfaces/campaign.interface';
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
