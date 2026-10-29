// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GOOGLE_CHANNELS_WITH_CREATIVE, GOOGLE_CREATIVE_FIELD_SPECS } from '../constants/campaign.constants';
import type { GoogleCreativeFieldSpec } from '../interfaces/campaign.interface';
import { googleCreativeImageFit, googleCreativeImageRequirement, storedCreativeAssetLabel } from './campaign-google-creative.utils';

const LANDSCAPE = { ratioW: 191, ratioH: 100, minWidth: 600, minHeight: 314 };
const SQUARE_LOGO = { ratioW: 1, ratioH: 1, minWidth: 128, minHeight: 128 };

describe('googleCreativeImageFit', () => {
  it('accepts an image on the ratio and at the minimum size', () => {
    expect(googleCreativeImageFit({ width: 1200, height: 628 }, LANDSCAPE)).toBe('fits');
    expect(googleCreativeImageFit({ width: 600, height: 314 }, LANDSCAPE)).toBe('fits');
  });

  /** ±1% on the ratio, measured against the target, as `ShapeRule.ratioDrift` measures it. */
  it('holds the ratio to within one percent', () => {
    expect(googleCreativeImageFit({ width: 1000, height: 1009 }, SQUARE_LOGO)).toBe('fits');
    expect(googleCreativeImageFit({ width: 1000, height: 1020 }, SQUARE_LOGO)).toBe('misfit');
  });

  it('refuses an image below either minimum even on the exact ratio', () => {
    expect(googleCreativeImageFit({ width: 382, height: 200 }, LANDSCAPE)).toBe('misfit');
    expect(googleCreativeImageFit({ width: 127, height: 127 }, SQUARE_LOGO)).toBe('misfit');
  });

  /** campaign-service holds at most 5 MiB per Google image, whatever its shape. */
  it('refuses an image over the Google byte cap even on the exact shape', () => {
    expect(googleCreativeImageFit({ width: 1200, height: 628, byteSize: 5 * 1024 * 1024 }, LANDSCAPE)).toBe('fits');
    expect(googleCreativeImageFit({ width: 1200, height: 628, byteSize: 5 * 1024 * 1024 + 1 }, LANDSCAPE)).toBe('misfit');
    expect(googleCreativeImageFit({ byteSize: 6 * 1024 * 1024 }, LANDSCAPE)).toBe('misfit');
  });

  /** Absent dimensions mean NOT MEASURED (an asset stored before they were recorded), never 0x0. */
  it('reports an image with no recorded dimensions as unknown', () => {
    expect(googleCreativeImageFit({}, LANDSCAPE)).toBe('unknown');
    expect(googleCreativeImageFit({ width: 1200 }, LANDSCAPE)).toBe('unknown');
  });
});

describe('googleCreativeImageRequirement', () => {
  it('states the ratio, its tolerance and the minimum size', () => {
    expect(googleCreativeImageRequirement(LANDSCAPE)).toBe('1.91:1 (within 1%), at least 600x314 px, up to 5 MB');
    expect(googleCreativeImageRequirement({ ratioW: 9, ratioH: 16, minWidth: 600, minHeight: 1067 })).toBe(
      '9:16 (within 1%), at least 600x1067 px, up to 5 MB'
    );
  });
});

describe('storedCreativeAssetLabel', () => {
  it('names the size, the type and the head of the id', () => {
    expect(storedCreativeAssetLabel({ id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', mimeType: 'image/png', width: 1200, height: 628 })).toBe(
      '1200x628 PNG · 3f2504e0'
    );
    expect(storedCreativeAssetLabel({ id: 'abcdef12-0000', mimeType: 'image/jpeg' })).toBe('Size unknown JPEG · abcdef12');
  });
});

/**
 * Pins the catalogue's image shapes to campaign-service's slot tables (`demandGenImageSlots`,
 * `performanceMaxImageSlots`, `displayImageSlots`), so an edit here cannot drift from them quietly.
 */
describe('GOOGLE_CREATIVE_FIELD_SPECS image shapes', () => {
  const shapes = (channel: (typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number]): Record<string, GoogleCreativeFieldSpec['image']> =>
    Object.fromEntries((GOOGLE_CREATIVE_FIELD_SPECS[channel] as readonly GoogleCreativeFieldSpec[]).filter((f) => f.image).map((f) => [f.control, f.image]));

  it('carries every image slot, and only image slots', () => {
    expect(Object.keys(shapes('demand-gen'))).toEqual(['marketingImages', 'squareMarketingImages', 'portraitImages', 'tallPortraitImages', 'logoImages']);
    expect(Object.keys(shapes('performance-max'))).toEqual(['marketingImages', 'squareMarketingImages', 'portraitImages', 'logoImages', 'landscapeLogoImages']);
    expect(Object.keys(shapes('display'))).toEqual(['marketingImages', 'squareMarketingImages', 'logoImages', 'squareLogoImages']);
  });

  /** The one trap the shared names hide: Display's logo is 4:1, the other channels' are square. */
  it("gives display's logoImages the 4:1 landscape shape and the other channels' a square one", () => {
    expect(shapes('display')['logoImages']).toEqual({ ratioW: 4, ratioH: 1, minWidth: 512, minHeight: 128 });
    expect(shapes('demand-gen')['logoImages']).toEqual(SQUARE_LOGO);
    expect(shapes('performance-max')['logoImages']).toEqual(SQUARE_LOGO);
    expect(shapes('demand-gen')['tallPortraitImages']).toEqual({ ratioW: 9, ratioH: 16, minWidth: 600, minHeight: 1067 });
  });
});
