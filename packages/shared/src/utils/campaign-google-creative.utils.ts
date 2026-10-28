// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE } from '../constants/campaign.constants';
import type { GoogleCreativeImageShape, StoredCreativeAsset } from '../interfaces/campaign.interface';

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
 * library recorded at upload.
 *
 * `unknown` is its own answer, as upstream's classifier keeps it: an asset stored before
 * campaign-service recorded dimensions has none, and "not measured" is not "the wrong shape". The
 * Implement tab neither offers such an image nor blocks one already held, and campaign-service
 * still decodes the bytes and checks the shape before anything is created.
 */
export function googleCreativeImageFit(asset: Pick<StoredCreativeAsset, 'width' | 'height'>, shape: GoogleCreativeImageShape): 'fits' | 'misfit' | 'unknown' {
  if (!asset.width || !asset.height) return 'unknown';
  if (asset.width < shape.minWidth || asset.height < shape.minHeight) return 'misfit';
  return googleCreativeImageDrift(asset, shape) <= GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE ? 'fits' : 'misfit';
}

/**
 * A Google slot's shape as a sentence, e.g. `1.91:1 (within 1%), at least 600x314 px`.
 *
 * The 1.91:1 marketing ratio is stated upstream as 191:100 and rendered in the form Google and the
 * catalogue labels use; every other ratio is already in lowest terms.
 */
export function googleCreativeImageRequirement(shape: GoogleCreativeImageShape): string {
  const ratio = shape.ratioH === 100 ? `${shape.ratioW / 100}:1` : `${shape.ratioW}:${shape.ratioH}`;
  const tolerance = Math.round(GOOGLE_CREATIVE_IMAGE_RATIO_TOLERANCE * 100);
  return `${ratio} (within ${tolerance}%), at least ${shape.minWidth}x${shape.minHeight} px`;
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
