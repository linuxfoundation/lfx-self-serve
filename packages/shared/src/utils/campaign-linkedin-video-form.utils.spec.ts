// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { LinkedInVariantDraft } from '../interfaces/campaign.interface';
import {
  linkedInVideoAssetToDelete,
  linkedInVideoFileRefusal,
  linkedInVideoMissing,
  linkedInVideoVariantsForCreate,
} from './campaign-linkedin-video-form.utils';
import { linkedInVideoVariantsRefusal } from './campaign-linkedin-video.utils';

const BRIEF = 'b1';
const VIDEO = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const variant = (key: string, over: Partial<LinkedInVariantDraft> = {}): LinkedInVariantDraft => ({
  key,
  introText: 'Join us',
  headline: 'KubeCon',
  imageAssetId: '',
  imageAssetName: '',
  imageAssetBriefId: '',
  ...over,
});
const withVideo = (key: string, over: Partial<LinkedInVariantDraft> = {}): LinkedInVariantDraft =>
  variant(key, { videoAssetId: VIDEO, videoAssetName: 'promo.mp4', videoAssetBriefId: BRIEF, ...over });

describe('linkedInVideoFileRefusal', () => {
  it.each([
    ['an MP4 of 100 KB', { type: 'video/mp4', size: 100 * 1024 }, null],
    ['an MP4 of exactly 30 MB', { type: 'video/mp4', size: 30 * 1024 * 1024 }, null],
    ['a QuickTime movie', { type: 'video/quicktime', size: 100 * 1024 }, 'Only MP4 videos can be uploaded.'],
    ['a PNG', { type: 'image/png', size: 100 * 1024 }, 'Only MP4 videos can be uploaded.'],
    [
      'an MP4 under 75 KB',
      { type: 'video/mp4', size: 75 * 1024 - 1 },
      'LinkedIn video ads need a video of at least 75 KB. Choose a longer or higher-quality MP4.',
    ],
    ['an MP4 over 30 MB', { type: 'video/mp4', size: 30 * 1024 * 1024 + 1 }, 'The video is larger than 30 MB. Choose a smaller MP4.'],
  ])('%s: %s', (_label, file, expected) => {
    expect(linkedInVideoFileRefusal(file)).toBe(expected);
  });
});

describe('linkedInVideoMissing', () => {
  it.each([
    ['every ad has a video for this brief', [withVideo('a'), withVideo('b')], false],
    ['an ad has none', [withVideo('a'), variant('b')], true],
    ['an ad has one for another brief', [withVideo('a'), withVideo('b', { videoAssetBriefId: 'b0' })], true],
  ])('%s: %s', (_label, variants, missing) => {
    expect(linkedInVideoMissing(variants, BRIEF)).toBe(missing);
  });
});

describe('linkedInVideoVariantsForCreate', () => {
  it('sends each video with the copy, and never an image or a description', () => {
    const sent = linkedInVideoVariantsForCreate(
      [
        withVideo('a', {
          imageUrn: 'urn:li:image:C4E',
          imageAssetId: 'img',
          imageAssetBriefId: BRIEF,
          description: 'Talks',
          name: 'Ad A',
          callToAction: 'REGISTER',
        }),
      ],
      BRIEF,
      { copy: true, callToAction: true }
    );
    expect(sent).toEqual([{ introText: 'Join us', headline: 'KubeCon', videoAssetId: VIDEO, name: 'Ad A', callToAction: 'REGISTER' }]);
  });

  it('drops the name and call to action where this deployment sends neither', () => {
    expect(linkedInVideoVariantsForCreate([withVideo('a', { name: 'Ad A', callToAction: 'REGISTER' })], BRIEF)).toEqual([
      { introText: 'Join us', headline: 'KubeCon', videoAssetId: VIDEO },
    ]);
  });

  it('sends what the create route accepts: no refusal for a full video create', () => {
    const sent = linkedInVideoVariantsForCreate([withVideo('a', { description: 'Talks' }), withVideo('b')], BRIEF, { copy: true, callToAction: true });
    expect(linkedInVideoVariantsRefusal({ variants: sent }, true)).toBeNull();
  });
});

describe('linkedInVideoAssetToDelete', () => {
  const OTHER = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
  it.each([
    ['a video no ad uses', [withVideo('a', { videoAssetId: OTHER })], VIDEO, '', VIDEO],
    ['a video another ad still uses', [withVideo('a')], VIDEO, '', null],
    ['the id the replacement came back as', [variant('a')], VIDEO, VIDEO, null],
    ['no video', [variant('a')], '', '', null],
  ])('%s: %s', (_label, variants, assetId, keepId, expected) => {
    expect(linkedInVideoAssetToDelete(variants, assetId, keepId)).toBe(expected);
  });
});
