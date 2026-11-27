// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { goParseUuid, redditVideoRefusal } from './campaign-reddit-video.utils';

const VIDEO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const THUMB = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const post = (extra: Record<string, unknown> = {}) => ({ videoAssetId: VIDEO, thumbnailAssetId: THUMB, ...extra });
const two = [{ headline: 'a' }, { headline: 'b' }];

describe('redditVideoRefusal', () => {
  it.each<[string, unknown, boolean, boolean]>([
    ['not an object', null, true, true],
    ['no video fields, flag off', { imageUrl: 'https://img.example/a.png' }, false, false],
    // Blank is absent, as campaign-service reads it: nothing to refuse whatever the flag.
    ['both null, flag off', { videoAssetId: null, thumbnailAssetId: null }, false, false],
    ['both blank once trimmed as Go trims, flag off', { videoAssetId: ' \u0085 ', thumbnailAssetId: '' }, false, false],
    ['a video and its thumbnail', post(), true, false],
    ['ids padded with spaces', post({ videoAssetId: ` ${VIDEO} `, thumbnailAssetId: `\t${THUMB}\n` }), true, false],
    ['ids in every form uuid.Parse takes', post({ videoAssetId: `urn:UUID:${VIDEO}`, thumbnailAssetId: `{${THUMB.toUpperCase()}}` }), true, false],
    ['blank neighbours', post({ postUrl: ' ', imageUrl: '', imageAssetId: null }), true, false],
    // campaign-service's best-effort decode reads a non-string neighbour as blank, and its decode failure is its own.
    ['a non-string imageUrl', post({ imageUrl: 7 }), true, false],
    // Where Go could read a neighbour differently, that rule is left to campaign-service.
    ['postUrl under two spellings', post({ postUrl: null, PostURL: 'https://reddit.example/p' }), true, false],
    ['one variant with one ad per variant on', post({ variants: [{ headline: 'a' }] }), true, true],
    ['two variants with one ad per variant off', post({ variants: two }), true, false],
    ['variants that are not a list', post({ variants: 'ab' }), true, true],
    ['variants under two spellings', post({ variants: [], Variants: two }), true, true],
  ])('accepts %s', (_name, raw, enabled, adPerVariant) => {
    expect(redditVideoRefusal(raw, enabled, adPerVariant)).toBeNull();
  });

  it.each<[string, unknown, boolean, boolean, string, string]>([
    // Shape first, whatever the flag.
    ['a case variant of videoAssetId', { VideoAssetID: VIDEO, thumbnailAssetId: THUMB }, true, false, 'redditConfig.videoAssetId', 'spelled exactly'],
    ['a case variant of thumbnailAssetId, flag off', { thumbnailassetid: '' }, false, false, 'redditConfig.thumbnailAssetId', 'spelled exactly'],
    ['a numeric videoAssetId, flag off', { videoAssetId: 1 }, false, false, 'redditConfig.videoAssetId', 'as text'],
    ['an empty-list thumbnailAssetId', post({ thumbnailAssetId: [] }), true, false, 'redditConfig.thumbnailAssetId', 'as text'],
    // The flag, before any rule on the values.
    ['a video while off', { videoAssetId: 'not-a-uuid', imageUrl: 'https://img.example/a.png' }, false, false, 'redditConfig.videoAssetId', 'not enabled'],
    ['only a thumbnail while off', { thumbnailAssetId: THUMB }, false, false, 'redditConfig.thumbnailAssetId', 'not enabled'],
    ['a thumbnail without a video', { videoAssetId: ' ', thumbnailAssetId: THUMB }, true, false, 'redditConfig.thumbnailAssetId', 'Add the video'],
    ['a video without a thumbnail', { videoAssetId: VIDEO }, true, false, 'redditConfig.thumbnailAssetId', 'requires a thumbnail'],
    ['a video with postUrl', post({ postUrl: 'https://reddit.example/p' }), true, false, 'redditConfig.videoAssetId', 'Keep only the video'],
    ['a video with imageUrl', post({ imageUrl: 'https://img.example/a.png' }), true, false, 'redditConfig.videoAssetId', 'Keep only the video'],
    ['a video with imageAssetId', post({ imageAssetId: THUMB }), true, false, 'redditConfig.videoAssetId', 'Keep only the video'],
    [
      'a video with a case variant of imageUrl',
      post({ ImageURL: 'https://img.example/a.png' }),
      true,
      false,
      'redditConfig.videoAssetId',
      'Keep only the video',
    ],
    // Before the ids are parsed, as campaign-service orders it.
    ['two variants with one ad per variant on', post({ videoAssetId: 'bad', variants: two }), true, true, 'redditConfig.variants', 'one variant'],
    ['two null variants with one ad per variant on', post({ variants: [null, null] }), true, true, 'redditConfig.variants', 'one variant'],
    [
      'a video id that is not a UUID',
      post({ videoAssetId: 'asset-1', thumbnailAssetId: 'bad' }),
      true,
      false,
      'redditConfig.videoAssetId',
      'not a valid asset id',
    ],
    ['a thumbnail id that is not a UUID', post({ thumbnailAssetId: `${THUMB}0` }), true, false, 'redditConfig.thumbnailAssetId', 'not a valid asset id'],
    [
      'the same asset twice, spelled differently',
      post({ thumbnailAssetId: VIDEO.replace(/-/g, '').toUpperCase() }),
      true,
      false,
      'redditConfig.thumbnailAssetId',
      'separate',
    ],
  ])('refuses %s', (_name, raw, enabled, adPerVariant, field, message) => {
    const refusal = redditVideoRefusal(raw, enabled, adPerVariant);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(redditVideoRefusal(post({ videoAssetId: '<script>' }), true, false)?.message).not.toContain('<');
  });
});

describe('goParseUuid', () => {
  it.each<[string, string | null]>([
    [VIDEO, VIDEO],
    [VIDEO.toUpperCase(), VIDEO],
    [`{${VIDEO}}`, VIDEO],
    [`URN:uuid:${VIDEO}`, VIDEO],
    [VIDEO.replace(/-/g, ''), VIDEO],
    [`{${VIDEO.replace(/-/g, '')}}`, null],
    [`urn:uuid:${VIDEO.replace(/-/g, '')}`, null],
    [`(${VIDEO})`, null],
    [VIDEO.replace('-', '_'), null],
    [VIDEO.replace('3f', 'zz'), null],
    ['', null],
  ])('reads %j as %j', (text, expected) => {
    expect(goParseUuid(text)).toBe(expected);
  });
});
