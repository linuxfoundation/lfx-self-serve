// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  CREATIVE_ASSET_VIDEO_MAX_BYTES,
  CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE,
} from '../constants/campaign.constants';
import type { CreativeAssetLibraryState, MetaAdVariant, MetaVariantVideoDraft, MetaVideoUploadState } from '../interfaces/campaign.interface';
import {
  metaImageWanted,
  metaVariantsWithMedia,
  metaVariantVideosWith,
  metaVariantVideosWithout,
  metaVariantVideoViews,
  metaVideoCreateRefusal,
  metaVideoDraftFields,
  metaVideoDraftRestore,
  metaVideoFileRefusal,
  metaVideoIdsInUse,
  metaVideosNewerThanRead,
} from './campaign-meta-video-form.utils';

const A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const B = '9b2c1e7a-0d4f-4e8b-a1c2-334455667788';
const none: MetaVariantVideoDraft = { assetId: '', assetName: '', assetBriefId: '' };
const vid = (assetId: string, assetBriefId = 'b-1', assetName = ''): MetaVariantVideoDraft => ({ assetId, assetName, assetBriefId });
const variants: MetaAdVariant[] = [
  { primaryText: 'p1', headline: 'h1' },
  { primaryText: 'p2', headline: 'h2' },
];
const library = (ids: string[]): CreativeAssetLibraryState => ({
  status: 'ready',
  assets: [],
  videos: ids.map((id, i) => ({ id, byteSize: 1, checksum: `${i}abcdef0123` })),
});
const idle: MetaVideoUploadState = { status: 'idle', variant: -1, name: '', error: '' };

describe('metaVariantsWithMedia', () => {
  it.each<[string, MetaVariantVideoDraft[], boolean, MetaAdVariant[]]>([
    ['off: every variant carries the image, a held video ignored', [vid(A)], false, variants.map((v) => ({ ...v, imageUrl: 'https://i/x.png' }))],
    ['on, no video: as before', [], true, variants.map((v) => ({ ...v, imageUrl: 'https://i/x.png' }))],
    [
      'on: the video variant drops the image',
      [none, vid(A)],
      true,
      [
        { primaryText: 'p1', headline: 'h1', imageUrl: 'https://i/x.png' },
        { primaryText: 'p2', headline: 'h2', videoAssetId: A },
      ],
    ],
    ['on: a video for another brief is not sent', [vid(A, 'b-2')], true, variants.map((v) => ({ ...v, imageUrl: 'https://i/x.png' }))],
  ])('%s', (_case, videos, available, expected) => {
    expect(metaVariantsWithMedia(variants, { imageUrl: 'https://i/x.png' }, videos, { available, briefId: 'b-1' })).toEqual(expected);
  });
});

describe('metaImageWanted', () => {
  it.each<[string, number, MetaVariantVideoDraft[], boolean, boolean]>([
    ['off', 2, [vid(A), vid(B)], false, true],
    ['no variants', 0, [], true, true],
    ['one variant without a video', 2, [vid(A)], true, true],
    ['every variant a video', 2, [vid(A), vid(B, 'b-2')], true, false],
  ])('%s', (_case, count, videos, available, expected) => {
    expect(metaImageWanted(count, videos, available)).toBe(expected);
  });
});

describe('the variant video list', () => {
  it('sets one variant, padding the earlier ones, and clears a deleted asset everywhere', () => {
    const set = metaVariantVideosWith([], 2, vid(A));
    expect(set).toEqual([none, none, vid(A)]);
    expect(metaVariantVideosWithout([vid(A), vid(B), vid(A)], A)).toEqual([none, vid(B), none]);
    expect(metaVideoIdsInUse([vid(A), vid(A, 'b-2'), vid(B)], 2)).toEqual([A]);
  });
});

describe('metaVideosNewerThanRead', () => {
  it.each<[string, CreativeAssetLibraryState, string[]]>([
    ['a read before both uploads', { ...library([]), revision: 1 }, [A, B]],
    ['a read at the first upload', { ...library([A]), revision: 2 }, [B]],
    ['a read after both', { ...library([A, B]), revision: 3 }, []],
    ['a read with no revision predates every upload', library([]), [A, B]],
  ])('%s', (_case, lib, expected) => {
    expect(
      metaVideosNewerThanRead(
        [
          { id: A, revision: 2 },
          { id: B, revision: 3 },
        ],
        lib
      )
    ).toEqual(expected);
  });
});

describe('metaVideoFileRefusal', () => {
  it.each<[string, { type: string; size: number }, string, string, string | null]>([
    ['an MP4 for a saved brief', { type: 'video/mp4', size: CREATIVE_ASSET_VIDEO_MAX_BYTES }, 'b-1', 'tlf', null],
    ['not an MP4', { type: 'video/quicktime', size: 1 }, 'b-1', 'tlf', CREATIVE_ASSET_VIDEO_WRONG_TYPE_MESSAGE],
    ['over the limit', { type: 'video/mp4', size: CREATIVE_ASSET_VIDEO_MAX_BYTES + 1 }, 'b-1', 'tlf', CREATIVE_ASSET_VIDEO_TOO_LARGE_MESSAGE],
    ['an unsaved brief', { type: 'video/mp4', size: 1 }, '', 'tlf', 'Save the brief before uploading a video for it.'],
  ])('%s', (_case, file, briefId, slug, expected) => {
    expect(metaVideoFileRefusal(file, briefId, slug)).toBe(expected);
  });
});

describe('metaVariantVideoViews', () => {
  it('offers no video, then the stored videos by name or library label, and a fresh upload not listed yet', () => {
    const [first] = metaVariantVideoViews(1, [vid(B, 'b-1', 'promo.mp4')], library([A]), 'b-1', idle, [B]);
    expect(first.options).toEqual([
      { value: '', label: 'No video (image ad)' },
      { value: A, label: 'Video 1 (0abcdef0)' },
      { value: B, label: 'promo.mp4' },
    ]);
    expect(first).toMatchObject({ assetId: B, status: 'Uploaded: promo.mp4', problem: '' });
  });

  it.each<[string, MetaVariantVideoDraft[], CreativeAssetLibraryState, Partial<ReturnType<typeof metaVariantVideoViews>[number]>, string[]?]>([
    [
      'another brief',
      [vid(A, 'b-2')],
      library([A]),
      { assetId: '', problem: "Stored for a different brief. Choose a video from this brief's library, or no video." },
    ],
    ['gone from a read library', [vid(A)], library([]), { assetId: A, problem: "No longer in the brief's library. Choose another video, or no video." }],
    ['library still loading', [vid(A)], { status: 'loading', assets: [] }, { assetId: A, problem: '' }],
    // An upload's file name exempts nothing: a read after it that lacks it means it is gone (a delete elsewhere).
    [
      'an uploaded video gone from a later read',
      [vid(A, 'b-1', 'a.mp4')],
      library([]),
      { assetId: A, problem: "No longer in the brief's library. Choose another video, or no video." },
    ],
    // A read made before the upload cannot list it, whichever variant picked it (with or without its name).
    ['a video stored after the read', [vid(A)], library([]), { assetId: A, problem: '' }, [A]],
  ])('names the problem: %s', (_case, videos, lib, expected, fresh = []) => {
    expect(metaVariantVideoViews(1, videos, lib, 'b-1', idle, fresh)[0]).toMatchObject(expected);
  });

  it('shows the one upload on its own variant only', () => {
    const views = metaVariantVideoViews(2, [], library([]), 'b-1', { status: 'uploading', variant: 1, name: 'a.mp4', error: '' });
    expect(views.map((view) => [view.uploading, view.status])).toEqual([
      [false, ''],
      [true, 'Uploading a.mp4…'],
    ]);
    expect(metaVariantVideoViews(2, [], library([]), 'b-1', { status: 'error', variant: 0, name: '', error: 'Too big.' })[0].error).toBe('Too big.');
  });
});

describe('metaVideoCreateRefusal', () => {
  const base = { available: true, count: 2, videos: [none, vid(A)], library: library([A]), briefId: 'b-1' };
  const sent = { variants: [variants[0], { ...variants[1], videoAssetId: A }] };

  it.each<[string, Partial<Parameters<typeof metaVideoCreateRefusal>[0]>, string | null]>([
    ['a sendable video', { config: sent }, null],
    ['off with nothing chosen: exactly today', { available: false, videos: [], config: { variants } }, null],
    [
      'off with a video chosen',
      { available: false, config: { variants } },
      'Meta Ads: video ads are not available right now. Set each ad to no video to send image ads.',
    ],
    [
      'a video for another brief',
      { videos: [vid(A, 'b-2')], config: { variants } },
      "Meta Ads: the video on variant 1 cannot be sent. Stored for a different brief. Choose a video from this brief's library, or no video.",
    ],
    [
      'a lead form, as campaign-service refuses it',
      { config: { ...sent, leadFormId: '123' } },
      'Meta Ads: A video ad cannot use a lead form. Remove the lead form, or use an image on variant 2.',
    ],
    ['a video beyond the variants is ignored', { count: 1, videos: [none, vid(A, 'b-2')], config: { variants } }, null],
    [
      'an uploaded video a later read no longer lists',
      { videos: [none, vid(A, 'b-1', 'a.mp4')], library: library([]) },
      "Meta Ads: the video on variant 2 cannot be sent. No longer in the brief's library. Choose another video, or no video.",
    ],
    ['a video stored after the read', { library: library([]), fresh: [A] }, null],
  ])('%s', (_case, overrides, expected) => {
    expect(metaVideoCreateRefusal({ ...base, config: sent, ...overrides })).toBe(expected);
  });
});

describe('metaVideoDraftRestore', () => {
  it('round-trips what metaVideoDraftFields keeps', () => {
    const fields = metaVideoDraftFields([vid(A, 'b-1', 'a.mp4')], { variant: 1, name: 'b.mp4', briefId: 'b-1' });
    expect(metaVideoDraftRestore(fields)).toEqual({ videos: [vid(A, 'b-1', 'a.mp4')], pendingUpload: { variant: 1, name: 'b.mp4', briefId: 'b-1' } });
  });

  it('restores nothing from a draft saved before #6332', () => {
    expect(metaVideoDraftRestore({})).toEqual({});
  });

  it('reads a malformed entry as no video, and resumes no upload without a file name and a position', () => {
    // @ts-expect-error -- stored drafts are untyped JSON; a malformed entry must read as no video.
    expect(metaVideoDraftRestore({ metaVariantVideos: [null, { assetId: 7 }] })).toEqual({ videos: [none, none] });
    expect(metaVideoDraftRestore({ metaVariantVideos: [], metaVideoUploadPending: { variant: -1, name: 'x', briefId: 'b-1' } })).toEqual({ videos: [] });
    expect(metaVideoDraftRestore({ metaVideoUploadPending: { variant: 0, name: '', briefId: 'b-1' } })).toEqual({});
  });
});
