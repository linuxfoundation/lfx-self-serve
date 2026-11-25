// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInVideoVariantsRefusal } from './campaign-linkedin-video.utils';

const VIDEO = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const OTHER = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
const ad = (fields: Record<string, unknown>) => ({ introText: 'Join us', headline: 'Summit', ...fields });
const config = (...variants: unknown[]) => ({ variants });

describe('linkedInVideoVariantsRefusal', () => {
  it.each([
    ['image ads only, on a deployment without video', config(ad({ imageAssetId: VIDEO })), false],
    ['a blank video, on a deployment without video', config(ad({ videoAssetId: '  ' })), false],
    ['one video ad', config(ad({ videoAssetId: VIDEO })), true],
    [
      'two video ads with a name and a call to action',
      config(ad({ videoAssetId: VIDEO, name: 'A' }), ad({ videoAssetId: OTHER, callToAction: 'REGISTER' })),
      true,
    ],
    ['a video ad with a blank image and description', config(ad({ videoAssetId: ` ${VIDEO} `, imageUrn: '', description: ' ' })), true],
    ['no variants', {}, true],
    ['a variant that is not an object', config('text'), true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInVideoVariantsRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['a video without the flag', config(ad({ videoAssetId: VIDEO })), false, 'variants[0].videoAssetId', 'cannot create LinkedIn video ads'],
    ['a null video', config(ad({ videoAssetId: null })), true, 'variants[0].videoAssetId', "uploaded video's id"],
    ['a video that is not text', config(ad({ videoAssetId: 7 })), true, 'variants[0].videoAssetId', "uploaded video's id"],
    ['a video that is not an asset id', config(ad({ videoAssetId: 'clip.mp4' })), true, 'variants[0].videoAssetId', "uploaded video's id"],
    ['a video with an uploaded image', config(ad({ videoAssetId: VIDEO, imageAssetId: OTHER })), true, 'variants[0]', 'carries no image'],
    ['a video with an image URN', config(ad({ videoAssetId: VIDEO, imageUrn: 'urn:li:image:C4E' })), true, 'variants[0]', 'carries no image'],
    ['a video with a description', config(ad({ videoAssetId: VIDEO, description: 'Talks' })), true, 'variants[0].description', 'no description'],
    ['video and image ads mixed', config(ad({ videoAssetId: VIDEO }), ad({ imageAssetId: OTHER })), true, 'variants', 'every ad a video, or none'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInVideoVariantsRefusal(raw, enabled);
    expect(refusal?.field).toBe(`linkedInConfig.${field}`);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(linkedInVideoVariantsRefusal(config(ad({ videoAssetId: 'SECRET_ID' })), true)?.message).not.toContain('SECRET_ID');
  });
});
