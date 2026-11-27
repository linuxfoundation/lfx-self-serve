// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_VIDEO_OFF_MESSAGE } from '../constants/campaign.constants';
import { metaVariantsToSend, metaVideoRefusal } from './campaign-meta-video.utils';

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const image = { primaryText: 'p', headline: 'h', imageUrl: 'https://cdn.example/a.png' };
const video = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ primaryText: 'p', headline: 'h', videoAssetId: ID, ...extra });
const config = (...variants: unknown[]): Record<string, unknown> => ({ variants });

describe('metaVideoRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['no config', undefined, false],
    ['image variants only, while off', config(image, { ...image, videoAssetId: null }), false],
    ['a blank id, as Go trims, while off', config({ ...image, videoAssetId: ' \t\n' }), false],
    ['a non-list variants, left to campaign-service', { variants: 'x' }, false],
    ['a video variant beside an image variant', config(video(), image), true],
    ['an upper-case id', config(video({ videoAssetId: ID.toUpperCase() })), true],
    ['an id Go trims, braced or URN', config(video({ videoAssetId: ` {${ID}} ` }), video({ videoAssetId: `urn:uuid:${ID}` })), true],
    ['an id with no hyphens', config(video({ videoAssetId: ID.replace(/-/g, '') })), true],
    ['blank images beside the video', config(video({ imageUrl: ' ', imageAssetId: '' })), true],
    ['a blank lead form', { ...config(video()), leadFormId: ' ' }, true],
    ['a lead form on an image-only create', { ...config(image), leadFormId: '123' }, true],
  ])('accepts %s', (_case, raw, enabled) => {
    expect(metaVideoRefusal(raw, enabled)).toBeNull();
  });

  // The spelling and type first, on every variant whatever the flag; then, per variant, campaign-service's order: the
  // gate, the id, the image, the lead form.
  it.each<[string, unknown, boolean, string, string]>([
    [
      'another spelling inside a variant, even while off',
      config(image, { ...image, VideoAssetId: ID }),
      false,
      'metaConfig.variants[1].videoAssetId',
      "Send variant 2's video as metaConfig.variants[1].videoAssetId, spelled exactly.",
    ],
    [
      'a Unicode-folded spelling, before an earlier variant is gated',
      config(video(), { ...image, videoaſſetid: ID }),
      false,
      'metaConfig.variants[1].videoAssetId',
      "Send variant 2's video as metaConfig.variants[1].videoAssetId, spelled exactly.",
    ],
    ['a non-text id, even while off', config(video({ videoAssetId: 7 })), false, 'metaConfig.variants[0].videoAssetId', "Variant 1's video must be text."],
    ['any id while off', config(image, video()), false, 'metaConfig.variants[1].videoAssetId', META_VIDEO_OFF_MESSAGE],
    [
      'an id that is not a UUID while off, naming the gate',
      config(video({ videoAssetId: 'x' })),
      false,
      'metaConfig.variants[0].videoAssetId',
      META_VIDEO_OFF_MESSAGE,
    ],
    [
      'an id that is not a UUID',
      config(video({ videoAssetId: `${ID}0` })),
      true,
      'metaConfig.variants[0].videoAssetId',
      "Variant 1's video must be a video uploaded to this brief.",
    ],
    [
      'an id Go does not trim',
      config(video({ videoAssetId: `﻿${ID}` })),
      true,
      'metaConfig.variants[0].videoAssetId',
      "Variant 1's video must be a video uploaded to this brief.",
    ],
    [
      'an image URL beside the video, before the lead form',
      { ...config(video({ imageUrl: 'https://cdn.example/a.png' })), leadFormId: '123' },
      true,
      'metaConfig.variants[0].videoAssetId',
      "Variant 1 is a video ad, so it carries no image: Meta uses one of the video's own thumbnails. Remove its image.",
    ],
    [
      'a stored image under another spelling beside the video',
      config(video({ ImageAssetID: ID })),
      true,
      'metaConfig.variants[0].videoAssetId',
      "Variant 1 is a video ad, so it carries no image: Meta uses one of the video's own thumbnails. Remove its image.",
    ],
    [
      'a lead form',
      { ...config(image, video()), leadFormId: '123' },
      true,
      'metaConfig.variants[1].videoAssetId',
      'A video ad cannot use a lead form. Remove the lead form, or use an image on variant 2.',
    ],
  ])('refuses %s', (_case, raw, enabled, field, message) => {
    expect(metaVideoRefusal(raw, enabled)).toEqual({ field, message });
  });
});

describe('metaVariantsToSend', () => {
  it.each<[string, unknown, boolean, unknown]>([
    ['a video, while on', [video()], true, [video()]],
    ['every spelling of the video, while off', [video({ VIDEOASSETID: ID }), image, 'x'], false, [{ primaryText: 'p', headline: 'h' }, image, 'x']],
    ['a non-list, while off', 'x', false, 'x'],
  ])('sends %s', (_case, variants, enabled, expected) => {
    expect(metaVariantsToSend(variants, enabled)).toEqual(expected);
  });

  it('returns the same list when there is nothing to drop', () => {
    const variants = [image];

    expect(metaVariantsToSend(variants, false)).toBe(variants);
  });
});
