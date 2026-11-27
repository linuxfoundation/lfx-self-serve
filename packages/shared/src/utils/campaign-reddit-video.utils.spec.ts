// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CreativeAssetLibraryState, RedditVideoPostDraft } from '../interfaces/campaign.interface';
import {
  goParseUuid,
  redditVariantsSent,
  redditVideoPostChosen,
  redditVideoPostCreateRefusal,
  redditVideoPostField,
  redditVideoPostFromDraft,
  redditVideoPostVariantsNote,
  redditVideoPostView,
  redditVideoPostWithout,
  redditVideoPostWithThumbnail,
  redditVideoPostWithVideo,
  redditVideoRefusal,
} from './campaign-reddit-video.utils';

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
    ['a thumbnail without a video', { videoAssetId: ' ', thumbnailAssetId: THUMB }, true, false, 'redditConfig.videoAssetId', 'Add the video'],
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
    // `Parse` strips any one-byte wrapper without checking it.
    [`(${VIDEO})`, VIDEO],
    [`x${VIDEO}y`, VIDEO],
    [`é${VIDEO}}`, null],
    [VIDEO.replace('-', '_'), null],
    [VIDEO.replace('3f', 'zz'), null],
    ['', null],
  ])('reads %j as %j', (text, expected) => {
    expect(goParseUuid(text)).toBe(expected);
  });
});

// === The Implement tab's video post editor (#6108 row 8) ===

const NONE: RedditVideoPostDraft = { videoAssetId: '', videoBriefId: '', thumbnailAssetId: '', thumbnailBriefId: '' };
const PICKED: RedditVideoPostDraft = { videoAssetId: VIDEO, videoBriefId: 'b1', thumbnailAssetId: THUMB, thumbnailBriefId: 'b1' };
const LIBRARY: CreativeAssetLibraryState = {
  status: 'ready',
  assets: [{ id: THUMB, projectId: 'p', briefId: 'b1', mimeType: 'image/png', byteSize: 2048, checksum: 'cd'.repeat(32), width: 1200, height: 628 }],
  videos: [{ id: VIDEO, byteSize: 5 * 1024 * 1024, checksum: 'ab'.repeat(32) }],
};

describe('redditVideoPostChosen', () => {
  it.each<[string, RedditVideoPostDraft, boolean | null, boolean]>([
    ['both picked, on an explicit yes', PICKED, true, true],
    ['only the thumbnail picked', { ...NONE, thumbnailAssetId: THUMB, thumbnailBriefId: 'b1' }, true, true],
    ['nothing picked', NONE, true, false],
    ['picked while unanswered', PICKED, null, false],
    ['picked, kept after the capability went off', PICKED, false, false],
  ])('%s', (_name, draft, enabled, expected) => {
    expect(redditVideoPostChosen(draft, enabled)).toBe(expected);
  });
});

describe('redditVideoPostField', () => {
  it.each<[string, RedditVideoPostDraft, boolean | null, Record<string, string>]>([
    ['both ids, picked for the open brief', PICKED, true, { videoAssetId: VIDEO, thumbnailAssetId: THUMB }],
    ['nothing while the capability is off', PICKED, false, {}],
    ['nothing while unanswered', PICKED, null, {}],
    ['nothing with nothing picked', NONE, true, {}],
    ['not a pick made for another brief', { ...PICKED, videoBriefId: 'b0' }, true, { thumbnailAssetId: THUMB }],
  ])('sends %s', (_name, draft, enabled, expected) => {
    expect(redditVideoPostField(draft, 'b1', enabled)).toEqual(expected);
  });
});

describe('redditVariantsSent', () => {
  it.each<[string, boolean, string[]]>([
    ['variant 1 alone with a video post', true, ['a']],
    ['every variant otherwise', false, ['a', 'b']],
  ])('sends %s', (_name, videoPost, expected) => {
    expect(redditVariantsSent(['a', 'b'], videoPost)).toEqual(expected);
  });
});

describe('redditVideoPostVariantsNote', () => {
  it.each<[string, RedditVideoPostDraft, number, string]>([
    ['nothing with one variant', PICKED, 1, ''],
    ['nothing without a pick', NONE, 3, ''],
    ['the second variant left out', PICKED, 2, 'Only variant 1 is sent with a video post. Variant 2 is not sent.'],
    ['the rest left out', PICKED, 4, 'Only variant 1 is sent with a video post. Variants 2 to 4 are not sent.'],
  ])('%s', (_name, draft, count, expected) => {
    expect(redditVideoPostVariantsNote(draft, count)).toBe(expected);
  });
});

describe('redditVideoPost picks', () => {
  it('records the brief a pick was made for, and clears it with the "none" option', () => {
    const video = redditVideoPostWithVideo(NONE, VIDEO, 'b1');
    expect(video).toEqual({ ...NONE, videoAssetId: VIDEO, videoBriefId: 'b1' });
    expect(redditVideoPostWithThumbnail(video, THUMB, 'b1')).toEqual(PICKED);
    expect(redditVideoPostWithVideo(PICKED, '', 'b1')).toEqual({ ...PICKED, videoAssetId: '', videoBriefId: '' });
  });

  it.each<[string, string, RedditVideoPostDraft]>([
    ['the video', VIDEO, { ...PICKED, videoAssetId: '', videoBriefId: '' }],
    ['the thumbnail', THUMB, { ...PICKED, thumbnailAssetId: '', thumbnailBriefId: '' }],
    ['nothing for another asset', 'other', PICKED],
  ])('takes a deleted asset off: %s', (_name, assetId, expected) => {
    expect(redditVideoPostWithout(PICKED, assetId)).toEqual(expected);
  });
});

describe('redditVideoPostFromDraft', () => {
  it.each<[string, unknown, RedditVideoPostDraft | undefined]>([
    ['nothing stored', undefined, undefined],
    ['a value that is not an object', 'v', undefined],
    ['a list', [VIDEO], undefined],
    ['the picks', PICKED, PICKED],
    ['a field that is not text, as blank', { ...PICKED, thumbnailAssetId: 7 }, { ...PICKED, thumbnailAssetId: '' }],
  ])('reads %s', (_name, stored, expected) => {
    expect(redditVideoPostFromDraft(stored)).toEqual(expected);
  });
});

describe('redditVideoPostView', () => {
  it('offers the stored video and image, with a "none" option once one is held', () => {
    const view = redditVideoPostView(PICKED, LIBRARY, 'b1');
    expect(view.videoOptions.map((option) => option.value)).toEqual(['', VIDEO]);
    expect(view.videoOptions[1].label).toBe('Video 1 (abababab, 5 MB)');
    expect(view.thumbnailOptions.map((option) => option.value)).toEqual(['', THUMB]);
    expect(redditVideoPostView(NONE, LIBRARY, 'b1').videoOptions.map((option) => option.value)).toEqual([VIDEO]);
  });

  it('keeps a held video the library no longer lists, by id, and offers none being deleted', () => {
    const gone = { ...LIBRARY, videos: [] };
    expect(redditVideoPostView(PICKED, gone, 'b1').videoOptions.map((option) => option.label)).toEqual(['No video (choose again)', 'Stored video 3f2504e0']);
    expect(redditVideoPostView(NONE, LIBRARY, 'b1', VIDEO).videoOptions).toEqual([]);
  });

  it.each<[string, RedditVideoPostDraft, CreativeAssetLibraryState, string, string, string]>([
    ['nothing wrong', PICKED, LIBRARY, 'b1', '', ''],
    [
      'a video picked for another brief',
      { ...PICKED, videoBriefId: 'b0' },
      LIBRARY,
      'b1',
      "Stored for a different brief. Choose a video from this brief's library.",
      '',
    ],
    ['a thumbnail the library no longer lists', PICKED, { ...LIBRARY, assets: [] }, 'b1', '', "No longer in the brief's library. Choose another thumbnail."],
    ['nothing judged while the library loads', PICKED, { status: 'loading', assets: [] }, 'b1', '', ''],
    ['nothing judged while a save runs (no brief id)', { ...PICKED, videoBriefId: 'b0' }, LIBRARY, '', '', ''],
  ])('%s', (_name, draft, library, briefId, videoProblem, thumbnailProblem) => {
    const view = redditVideoPostView(draft, library, briefId);
    expect([view.videoProblem, view.thumbnailProblem]).toEqual([videoProblem, thumbnailProblem]);
  });

  it.each<[string, CreativeAssetLibraryState, string]>([
    ['an unsaved brief', { status: 'idle', assets: [] }, 'Save the brief to pick or upload its video.'],
    ['a failed read', { status: 'error', assets: [] }, "Couldn't load the brief's library. Reload the page, or upload the video again."],
    ['no stored video', { ...LIBRARY, videos: [] }, 'No video is stored for this brief yet. Upload an MP4 to pick it.'],
    ['no stored image', { ...LIBRARY, assets: [] }, 'No image is stored for this brief yet. Upload a PNG or JPEG in the library below for the thumbnail.'],
    ['both stored', LIBRARY, ''],
  ])('notes %s', (_name, library, note) => {
    expect(redditVideoPostView(NONE, library, 'b1').libraryNote).toBe(note);
  });
});

describe('redditVideoPostCreateRefusal', () => {
  const config = (draft: RedditVideoPostDraft, extra: Record<string, unknown> = {}) => ({ ...redditVideoPostField(draft, 'b1', true), ...extra });
  it.each<[string, RedditVideoPostDraft, boolean | null, string, string, Record<string, unknown>, string | null]>([
    ['a complete pair', PICKED, true, 'b1', '', {}, null],
    ['nothing while the capability is off', { ...PICKED, thumbnailAssetId: '' }, false, 'b1', '', {}, null],
    ['an unsaved brief', PICKED, true, '', '', {}, 'Save the brief to send its video post.'],
    ['the picked video being deleted', PICKED, true, 'b1', VIDEO, {}, 'Wait for the video to finish deleting, or choose another.'],
    [
      'a video for another brief',
      { ...PICKED, videoBriefId: 'b0' },
      true,
      'b1',
      '',
      {},
      "Video: Stored for a different brief. Choose a video from this brief's library.",
    ],
    [
      'no thumbnail',
      { ...PICKED, thumbnailAssetId: '', thumbnailBriefId: '' },
      true,
      'b1',
      '',
      {},
      'Reddit requires a thumbnail for a video post. Upload a PNG or JPEG for it.',
    ],
    [
      'a thumbnail alone',
      { ...PICKED, videoAssetId: '', videoBriefId: '' },
      true,
      'b1',
      '',
      {},
      'A thumbnail belongs to a video post. Add the video, or remove the thumbnail.',
    ],
    [
      'an image beside the video',
      PICKED,
      true,
      'b1',
      '',
      { imageUrl: 'https://img.example/a.png' },
      'A video post cannot also promote an existing post or carry an image. Keep only the video.',
    ],
  ])('%s', (_name, draft, enabled, briefId, deletingId, extra, expected) => {
    expect(redditVideoPostCreateRefusal(draft, enabled, LIBRARY, briefId, deletingId, config(draft, extra), false)).toBe(expected);
  });
});
