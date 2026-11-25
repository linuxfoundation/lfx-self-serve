// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CREATIVE_ASSET_MAX_BYTES, CREATIVE_ASSET_TOO_LARGE_MESSAGE, CREATIVE_ASSET_WRONG_TYPE_MESSAGE } from '../constants/campaign.constants';
import type { RedditImageBlockInput, RedditNoAdWarningInput } from '../interfaces/campaign.interface';
import {
  redditImageAssetBlock,
  redditImageAssetForBrief,
  redditImageCapabilities,
  redditImageField,
  redditImageFileDescribedBy,
  redditImageFileRefusal,
  redditImageUploadHoldsCreate,
  redditImageUploadLiveMessage,
  redditImageUploadStatusMessage,
  redditNoAdWarning,
} from './campaign-reddit-image.utils';

describe('redditImageCapabilities', () => {
  it.each([
    [true, true, true, true],
    // Unanswered is withheld like a no.
    [true, null, true, false],
    [true, false, true, false],
    // The upload needs the authored-post capability too.
    [false, true, false, false],
    [null, true, false, false],
    [null, null, false, false],
  ])('creative %s, upload %s: creative available %s, upload available %s', (creative, upload, creativeAvailable, uploadAvailable) => {
    expect(redditImageCapabilities(creative, upload)).toEqual({ creativeAvailable, uploadAvailable });
  });
});

describe('redditImageAssetForBrief', () => {
  it.each([
    ['asset-1', 'brief-1', 'brief-1', true],
    // Uploaded to a different brief: never sent.
    ['asset-1', 'brief-2', 'brief-1', false],
    ['', 'brief-1', 'brief-1', false],
    ['asset-1', 'brief-1', null, false],
  ])('asset %j for %j with brief %j is for this brief: %s', (assetId, assetBriefId, briefId, expected) => {
    expect(redditImageAssetForBrief(assetId, assetBriefId, briefId)).toBe(expected);
  });
});

describe('redditImageField', () => {
  const base = {
    uploadAvailable: true,
    assetForThisBrief: true,
    assetId: 'asset-1',
    postUrl: '',
    creativeAvailable: true,
    imageUrl: 'https://cdn.example.org/promo.png',
  };

  it.each([
    // The upload wins over a pasted URL; never both.
    [{}, { imageAssetId: 'asset-1' }],
    // Removed, or upload capability not a yes, or made for another brief: fall back to the URL.
    [{ assetId: '', assetForThisBrief: false }, { imageUrl: 'https://cdn.example.org/promo.png' }],
    [{ uploadAvailable: false }, { imageUrl: 'https://cdn.example.org/promo.png' }],
    [{ assetForThisBrief: false }, { imageUrl: 'https://cdn.example.org/promo.png' }],
    // A post URL withholds the asset (refused upstream with it); the URL is ignored upstream instead.
    [{ postUrl: 'https://redd.it/abc123' }, { imageUrl: 'https://cdn.example.org/promo.png' }],
    [{ postUrl: 'https://redd.it/abc123', imageUrl: '' }, {}],
    // A remembered URL the authored-post capability withholds is not sent.
    [{ uploadAvailable: false, creativeAvailable: false }, {}],
    [{ assetForThisBrief: false, imageUrl: '' }, {}],
  ])('%j sends %j', (overrides, expected) => {
    expect(redditImageField({ ...base, ...overrides })).toEqual(expected);
  });
});

describe('redditImageAssetBlock', () => {
  const base: RedditImageBlockInput = {
    showRedditSection: true,
    postUrl: '',
    briefId: 'brief-1',
    assetId: 'asset-1',
    assetBriefId: 'brief-1',
    uploadStatus: 'idle',
    uploadFailedBriefId: '',
    uploadError: '',
    creativeEnabled: null,
    assetUploadEnabled: null,
    createCapabilityRead: 'unknown',
  };
  const uploading: Partial<RedditImageBlockInput> = { assetId: '', assetBriefId: '', uploadStatus: 'uploading' };

  it.each([
    ['support confirmed', { creativeEnabled: true, assetUploadEnabled: true }, null],
    ['Reddit not selected', { showRedditSection: false }, null],
    // The asset is withheld by design while a post URL is set.
    ['a post URL is set', { postUrl: 'https://redd.it/abc123', createCapabilityRead: 'pending' }, null],
    ['no image held', { assetId: '', assetBriefId: '' }, null],
    ['the read is pending', { createCapabilityRead: 'pending' }, 'pending'],
    ['an upload in flight while pending', { ...uploading, createCapabilityRead: 'pending' }, 'pending'],
    ['the read failed', { createCapabilityRead: 'failed' }, 'failed'],
    ['the read is unknown', {}, 'failed'],
    ['an upload in flight while unconfirmed', uploading, 'failed'],
    ['the upload capability is off', { creativeEnabled: true, assetUploadEnabled: false, createCapabilityRead: 'ready' }, 'unsupported'],
    ['the creative capability is off', { creativeEnabled: false, assetUploadEnabled: true, createCapabilityRead: 'ready' }, 'unsupported'],
    ['an upload in flight while switched off', { ...uploading, assetUploadEnabled: false, createCapabilityRead: 'ready' }, 'unsupported'],
    // Whatever the capability says: an asset for another brief is never sent.
    ['an asset for another brief', { assetBriefId: 'brief-2', creativeEnabled: true, assetUploadEnabled: true }, 'otherBrief'],
    ['an unsaved brief', { briefId: null, assetBriefId: '' }, 'unsaved'],
    [
      'a failed upload for the open brief',
      { assetId: '', assetBriefId: '', uploadStatus: 'error', uploadFailedBriefId: 'brief-1', uploadError: 'busy.' },
      'uploadFailed',
    ],
    // A failure for the brief left behind could never have been sent with this one.
    ['a failed upload for another brief', { assetId: '', assetBriefId: '', uploadStatus: 'error', uploadFailedBriefId: 'brief-2' }, null],
    // With the upload control shown, its own alert names the failure.
    [
      'a failed upload while support is confirmed',
      { assetId: '', uploadStatus: 'error', uploadFailedBriefId: 'brief-1', creativeEnabled: true, assetUploadEnabled: true },
      null,
    ],
  ] as const)('%s: %s', (_label, overrides, kind) => {
    expect(redditImageAssetBlock({ ...base, ...overrides })?.kind ?? null).toBe(kind);
  });

  it('words each block for the operator', () => {
    expect(redditImageAssetBlock({ ...base, createCapabilityRead: 'pending' })?.message).toBe('Checking Reddit image upload support…');
    expect(redditImageAssetBlock(base)?.message).toContain('Could not confirm that Reddit image upload is supported');
    expect(redditImageAssetBlock({ ...base, assetBriefId: 'brief-2' })?.message).toContain('uploaded for a different brief');
    expect(
      redditImageAssetBlock({ ...base, assetId: '', uploadStatus: 'error', uploadFailedBriefId: 'brief-1', uploadError: 'The image service is busy.' })?.message
    ).toBe('The Reddit image upload did not complete: The image service is busy. Remove it to create the campaign without the image.');
  });
});

describe('redditImageUploadHoldsCreate', () => {
  const base = { showRedditSection: true, uploadAvailable: true, postUrl: '', uploadStatus: 'uploading' as const };

  it.each([
    [{}, true],
    [{ uploadStatus: 'idle' as const }, false],
    [{ uploadStatus: 'error' as const }, false],
    // Hidden control: the asset block holds Create instead.
    [{ uploadAvailable: false }, false],
    // A post URL is what the campaign sends, so nothing waits for the upload.
    [{ postUrl: 'https://redd.it/abc123' }, false],
    [{ showRedditSection: false }, false],
  ])('%j holds Create: %s', (overrides, expected) => {
    expect(redditImageUploadHoldsCreate({ ...base, ...overrides })).toBe(expected);
  });
});

describe('redditImageFileRefusal', () => {
  const file = (type: string, size = 16): { type: string; size: number } => ({ type, size });

  it.each([
    [file('image/png'), 'brief-1', 'tlf', null],
    [file('image/jpeg'), 'brief-1', 'tlf', null],
    [file('image/png', CREATIVE_ASSET_MAX_BYTES), 'brief-1', 'tlf', null],
    [file('image/gif'), 'brief-1', 'tlf', CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [file('image/png', CREATIVE_ASSET_MAX_BYTES + 1), 'brief-1', 'tlf', CREATIVE_ASSET_TOO_LARGE_MESSAGE],
    // The type is checked before the size, and both before the brief.
    [file('image/gif', CREATIVE_ASSET_MAX_BYTES + 1), '', '', CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [file('image/png'), '', 'tlf', 'Save the brief before uploading an image for it.'],
    [file('image/png'), 'brief-1', '', 'Save the brief before uploading an image for it.'],
  ])('%j for brief %j in %j: %j', (chosen, briefId, projectSlug, expected) => {
    expect(redditImageFileRefusal(chosen, briefId, projectSlug)).toBe(expected);
  });
});

describe('the upload control labels', () => {
  it.each([
    ['uploading', false, '', 'Uploading image…'],
    ['idle', true, 'promo.png', 'Uploaded: promo.png'],
    ['idle', true, '', 'Uploaded: image'],
    // An asset for another brief is never shown as usable.
    ['idle', false, 'promo.png', ''],
    ['error', false, '', ''],
  ] as const)('status %s, asset for this brief %s, name %j: %j', (status, forThisBrief, name, expected) => {
    expect(redditImageUploadStatusMessage(status, forThisBrief, name)).toBe(expected);
  });

  it('announces the status only while the control is shown', () => {
    expect(redditImageUploadLiveMessage(true, 'Uploaded: promo.png')).toBe('Uploaded: promo.png');
    expect(redditImageUploadLiveMessage(false, 'Uploaded: promo.png')).toBe('');
  });

  it.each([
    ['idle', 'reddit-image-file-hint reddit-image-file-status'],
    ['uploading', 'reddit-image-file-hint reddit-image-file-status'],
    ['error', 'reddit-image-file-hint reddit-image-file-status reddit-image-file-error'],
  ] as const)('describes the file input while %s as %j', (status, expected) => {
    expect(redditImageFileDescribedBy(status)).toBe(expected);
  });
});

describe('redditNoAdWarning', () => {
  const base: RedditNoAdWarningInput = { showRedditSection: true, postUrl: '', image: {}, creativeAvailable: true };
  const tail =
    ', so this campaign is created with no ad: the campaign and its ad group are made and the create reports success, ' +
    'but nothing serves. Activating it from LFX will not change that, so either supply a post above or build and launch the campaign in Reddit Ads Manager.';

  it.each([
    [{}, `No post URL and no image URL${tail}`],
    // With the authored-post controls withheld, an image URL is not a remedy the operator can take.
    [{ creativeAvailable: false }, `No post URL${tail}`],
    [{ postUrl: 'https://redd.it/abc123' }, null],
    [{ postUrl: 'https://redd.it/abc123', creativeAvailable: false }, null],
    [{ image: { imageUrl: 'https://cdn.example.org/promo.png' } }, null],
    [{ image: { imageAssetId: 'asset-1' } }, null],
    [{ showRedditSection: false }, null],
  ] as const)('%j warns %j', (overrides, expected) => {
    expect(redditNoAdWarning({ ...base, ...overrides })).toBe(expected);
  });
});
