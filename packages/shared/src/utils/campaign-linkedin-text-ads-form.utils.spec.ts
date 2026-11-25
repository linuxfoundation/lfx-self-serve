// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { LinkedInTextAdDraft, LinkedInTextAdImageInput } from '../interfaces/campaign.interface';
import {
  linkedInTextAdImageFileRefusal,
  linkedInTextAdImageSizeRefusal,
  linkedInTextAdViews,
  linkedInTextAdsCreateRefusal,
  linkedInTextAdsForCreate,
  newLinkedInTextAdDraft,
  nextLinkedInTextAdKey,
} from './campaign-linkedin-text-ads-form.utils';

const ad = (key: string, headline = 'KubeCon NA', description = 'Join cloud native engineers.'): LinkedInTextAdDraft => ({ key, headline, description });

describe('nextLinkedInTextAdKey', () => {
  it.each([
    [[], 'text-ad-1'],
    [[ad('text-ad-1'), ad('text-ad-4')], 'text-ad-5'],
    [[ad('restored'), ad('text-ad-x'), ad('text-ad-2')], 'text-ad-3'],
  ])('after %j is %s', (drafts, expected) => {
    expect(nextLinkedInTextAdKey(drafts)).toBe(expected);
  });

  it('starts a new ad empty, under a fresh key', () => {
    expect(newLinkedInTextAdDraft([ad('text-ad-1')])).toEqual({ key: 'text-ad-2', headline: '', description: '' });
  });
});

describe('linkedInTextAdViews', () => {
  it.each([
    ['valid copy', ad('a'), '', ''],
    ['blank copy', ad('a', '  ', ' — '), 'Enter the headline.', 'Enter the description.'],
    ['copy at the limits', ad('a', 'h'.repeat(25), 'd'.repeat(75)), '', ''],
    [
      'copy over the limits',
      ad('a', 'h'.repeat(26), 'd'.repeat(76)),
      'The headline can be at most 25 characters.',
      'The description can be at most 75 characters.',
    ],
    ['emoji counted as characters', ad('a', '🚀'.repeat(25)), '', ''],
  ])('shows %s', (_name, draft, headlineError, descriptionError) => {
    expect(linkedInTextAdViews([draft])[0]).toMatchObject({ headlineError, descriptionError });
  });

  it('counts each field after normalization', () => {
    expect(linkedInTextAdViews([ad('a', '  Summit — 2099 ', 'Go')])[0]).toMatchObject({ headlineLength: 12, descriptionLength: 2 });
  });
});

describe('linkedInTextAdViews image state', () => {
  const withImage = (key: string, briefId = 'brief-1'): LinkedInTextAdDraft => ({ ...ad(key), imageAssetId: 'asset-1', imageAssetName: 'logo.png', imageAssetBriefId: briefId });
  const image = (over: Partial<LinkedInTextAdImageInput> = {}): LinkedInTextAdImageInput => ({
    slot: { variantKey: '', status: 'idle', failedBriefId: '', error: '' },
    briefId: 'brief-1',
    briefSaving: false,
    showSection: true,
    uploadEnabled: true,
    capabilityRead: 'ready',
    ...over,
  });

  it.each([
    ['no image', [ad('a')], image(), { imageStatusMessage: '', imageHeld: false, imagePickerDisabled: false, imageBlock: null }],
    ['an upload for this brief', [withImage('a')], image(), { imageStatusMessage: 'Uploaded: logo.png', imageHeld: true, imageBlock: null }],
    ['an upload running', [ad('a')], image({ slot: { variantKey: 'a', status: 'uploading', failedBriefId: '', error: '' } }), { imageStatusMessage: 'Uploading image…', imageUploading: true }],
    ['an unsaved brief', [ad('a')], image({ briefId: '' }), { imagePickerDisabled: true }],
    ['an upload for another brief', [withImage('a', 'brief-0')], image(), { imageStatusMessage: '', imageBlock: expect.objectContaining({ kind: 'otherBrief' }) }],
    ['uploads switched off', [withImage('a')], image({ uploadEnabled: false }), { imageBlock: expect.objectContaining({ kind: 'unsupported', message: expect.stringContaining('text ad 1') }) }],
    [
      'a failed upload',
      [ad('a')],
      image({ slot: { variantKey: 'a', status: 'error', failedBriefId: 'brief-1', error: 'Too big.' } }),
      { imageError: 'Too big.', imageBlock: expect.objectContaining({ kind: 'uploadFailed' }) },
    ],
  ])('shows %s', (_name, drafts, input, expected) => {
    expect(linkedInTextAdViews(drafts, input)[0]).toMatchObject(expected);
  });

  it.each([
    ['another text ad', 'b', true, 'Finish or remove the image for text ad 2 first.'],
    ['a hidden single image variant', 'linkedin-variant-1', false, ''],
  ])('holds the picker while %s uploads: %s', (_name, holder, disabled, note) => {
    const views = linkedInTextAdViews([ad('a'), ad('b')], image({ slot: { variantKey: holder, status: 'uploading', failedBriefId: '', error: '' } }));
    expect(views[0]).toMatchObject({ imagePickerDisabled: disabled, imagePickerNote: note });
  });
});

describe('linkedInTextAdImageFileRefusal', () => {
  it.each([
    ['a 2 MB PNG', { type: 'image/png', size: 2_000_000 }, null],
    ['a JPEG over 2 MB', { type: 'image/jpeg', size: 2_000_001 }, 'LinkedIn text ad images can be up to 2 MB. Choose a smaller PNG or JPEG.'],
    ['a GIF', { type: 'image/gif', size: 10 }, 'Only PNG and JPEG images can be uploaded.'],
  ])('answers %s', (_name, file, expected) => {
    expect(linkedInTextAdImageFileRefusal(file)).toBe(expected);
  });
});

describe('linkedInTextAdImageSizeRefusal', () => {
  it.each([
    ['100x100', { width: 100, height: 100 }, null],
    ['120x120', { width: 120, height: 120 }, 'LinkedIn text ad images must be 100x100 pixels; this one is 120x120.'],
    ['100x99', { width: 100, height: 99 }, 'LinkedIn text ad images must be 100x100 pixels; this one is 100x99.'],
    ['an unreadable size', null, "Could not read this image's size. LinkedIn text ad images must be 100x100 pixels; choose another PNG or JPEG."],
  ])('answers %s', (_name, size, expected) => {
    expect(linkedInTextAdImageSizeRefusal(size)).toBe(expected);
  });
});

describe('linkedInTextAdsForCreate', () => {
  const withImage = (briefId: string): LinkedInTextAdDraft => ({ ...ad('a', ' Summit ', 'Go'), imageAssetId: 'asset-1', imageAssetName: 'x.png', imageAssetBriefId: briefId });

  it.each([
    ['the copy as typed, without the key', ad('a', ' Summit ', 'Go'), true, 'brief-1', { headline: ' Summit ', description: 'Go' }],
    ['the upload made for this brief', withImage('brief-1'), true, 'brief-1', { headline: ' Summit ', description: 'Go', imageAssetId: 'asset-1' }],
    ['no upload made for another brief', withImage('brief-0'), true, 'brief-1', { headline: ' Summit ', description: 'Go' }],
    ['no upload without an explicit yes', withImage('brief-1'), false, 'brief-1', { headline: ' Summit ', description: 'Go' }],
  ])('sends %s', (_name, draft, uploadAvailable, briefId, expected) => {
    expect(linkedInTextAdsForCreate([draft], uploadAvailable, briefId)).toEqual([expected]);
  });
});

describe('linkedInTextAdsCreateRefusal', () => {
  const ok = { count: 1, textInvalid: false, manualBid: true };

  it.each([
    ['ready Text Ads', ok, null],
    ['no manual bid', { ...ok, manualBid: false }, 'LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.'],
    ['no text ads', { ...ok, count: 0 }, 'LinkedIn Ads: add at least one text ad.'],
    ['101 text ads', { ...ok, count: 101 }, 'LinkedIn Ads: remove text ads until there are at most 100.'],
    ['invalid text', { ...ok, textInvalid: true }, 'LinkedIn Ads: fix the text ad text.'],
  ])('holds Create for %s', (_name, input, expected) => {
    expect(linkedInTextAdsCreateRefusal(input)).toBe(expected);
  });
});
