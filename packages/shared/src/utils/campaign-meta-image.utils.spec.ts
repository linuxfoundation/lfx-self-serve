// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CREATIVE_ASSET_MAX_BYTES, CREATIVE_ASSET_TOO_LARGE_MESSAGE, CREATIVE_ASSET_WRONG_TYPE_MESSAGE } from '../constants/campaign.constants';
import type { MetaAdVariant, MetaImageBlockInput } from '../interfaces/campaign.interface';
import {
  metaImageAssetBlock,
  metaImageAssetForBrief,
  metaImageAssetWithheld,
  metaImageCapabilities,
  metaImageField,
  metaImageFileRefusal,
  metaImageUploadStatusMessage,
  metaImageUrlWithheld,
  metaPreviewImageLabel,
  metaVariantsWithImage,
} from './campaign-meta-image.utils';

describe('metaImageAssetForBrief', () => {
  it.each([
    ['asset-1', 'brief-1', 'brief-1', true],
    ['asset-1', 'brief-2', 'brief-1', false],
    ['', 'brief-1', 'brief-1', false],
    // An unsaved brief only matches an asset recorded with no brief, which never happens for a real upload.
    ['asset-1', 'brief-1', null, false],
    ['asset-1', '', null, true],
  ])('asset %j for %j with brief %j is for this brief: %s', (assetId, assetBriefId, briefId, expected) => {
    expect(metaImageAssetForBrief(assetId, assetBriefId, briefId)).toBe(expected);
  });
});

describe('withheld images', () => {
  it.each([
    [true, 'idle', false, true],
    [false, 'uploading', false, true],
    [true, 'idle', true, false],
    [false, 'idle', false, false],
    [false, 'error', false, false],
  ] as const)('upload for this brief %s, status %s, upload available %s: withheld %s', (forThisBrief, status, available, expected) => {
    expect(metaImageAssetWithheld(forThisBrief, status, available)).toBe(expected);
  });

  it.each([
    ['https://example.org/a.png', false, true],
    ['https://example.org/a.png', true, false],
    ['', false, false],
  ])('URL %j with image capability %s: withheld %s', (url, available, expected) => {
    expect(metaImageUrlWithheld(url, available)).toBe(expected);
  });
});

describe('metaImageField', () => {
  const base = { uploadAvailable: true, assetForThisBrief: true, assetId: 'asset-1', creativeAvailable: true, imageUrl: 'https://example.org/a.png' };

  it.each([
    // The upload wins over a pasted URL; never both.
    [{}, { imageAssetId: 'asset-1' }],
    // Upload capability not a yes, or made for another brief: fall back to the URL.
    [{ uploadAvailable: false }, { imageUrl: 'https://example.org/a.png' }],
    [{ assetForThisBrief: false }, { imageUrl: 'https://example.org/a.png' }],
    // Image capability not a yes: the URL is withheld too.
    [{ uploadAvailable: false, creativeAvailable: false }, {}],
    [{ assetForThisBrief: false, imageUrl: '' }, {}],
  ])('%j sends %j', (overrides, expected) => {
    expect(metaImageField({ ...base, ...overrides })).toEqual(expected);
  });
});

describe('metaVariantsWithImage', () => {
  const variants: MetaAdVariant[] = [
    { primaryText: 'Join us', headline: 'KubeCon' },
    { primaryText: 'Register', headline: 'OSS NA' },
  ];

  it('puts the one image on every variant', () => {
    expect(metaVariantsWithImage(variants, { imageAssetId: 'asset-1' })).toEqual([
      { primaryText: 'Join us', headline: 'KubeCon', imageAssetId: 'asset-1' },
      { primaryText: 'Register', headline: 'OSS NA', imageAssetId: 'asset-1' },
    ]);
  });

  it('sends the variants unchanged without an image', () => {
    expect(metaVariantsWithImage(variants, {})).toBe(variants);
  });
});

describe('metaImageAssetBlock', () => {
  const clear: MetaImageBlockInput = {
    showMetaSection: true,
    briefId: 'brief-1',
    assetId: '',
    assetBriefId: '',
    uploadStatus: 'idle',
    uploadFailedBriefId: '',
    uploadError: '',
    assetWithheld: false,
    urlWithheld: false,
    creativeEnabled: true,
    assetUploadEnabled: true,
    createCapabilityRead: 'ready',
  };
  const kind = (overrides: Partial<MetaImageBlockInput>) => metaImageAssetBlock({ ...clear, ...overrides })?.kind ?? null;

  it('holds nothing for a sendable image, or with Meta not selected', () => {
    expect(metaImageAssetBlock(clear)).toBeNull();
    expect(kind({ showMetaSection: false, assetId: 'asset-1', assetBriefId: 'brief-2' })).toBeNull();
  });

  it.each([
    // An upload made for another brief is never sent.
    [{ assetId: 'asset-1', assetBriefId: 'brief-2' }, 'otherBrief'],
    // A failed upload for this brief blocks whatever the capability says.
    [{ uploadStatus: 'error', uploadFailedBriefId: 'brief-1', uploadError: 'Network error.' }, 'uploadFailed'],
    [{ uploadStatus: 'error', uploadFailedBriefId: 'brief-1', creativeEnabled: false }, 'uploadFailed'],
    // A failure recorded for another brief is not this brief's notice.
    [{ uploadStatus: 'error', uploadFailedBriefId: 'brief-2' }, null],
    // Withheld: the answer is no, still being read, unreadable for an unsaved brief, or failed.
    [{ assetWithheld: true, assetUploadEnabled: false }, 'unsupported'],
    [{ urlWithheld: true, creativeEnabled: false }, 'unsupported'],
    [{ urlWithheld: true, creativeEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    [{ assetWithheld: true, assetUploadEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    [{ urlWithheld: true, creativeEnabled: null, briefId: null }, 'unsaved'],
    [{ urlWithheld: true, creativeEnabled: null, createCapabilityRead: 'failed' }, 'failed'],
    // A withheld URL is not "unsupported" just because the upload capability is no.
    [{ urlWithheld: true, creativeEnabled: null, assetUploadEnabled: false, createCapabilityRead: 'failed' }, 'failed'],
  ] as [Partial<MetaImageBlockInput>, string | null][])('%j blocks as %j', (overrides, expected) => {
    expect(kind(overrides)).toBe(expected);
  });

  it('names the upload error in the failed-upload notice', () => {
    expect(metaImageAssetBlock({ ...clear, uploadStatus: 'error', uploadFailedBriefId: 'brief-1', uploadError: 'Network error.' })?.message).toBe(
      'The Meta image upload did not complete: Network error. Remove it, or choose the image again.'
    );
  });
});

describe('metaImageFileRefusal', () => {
  it.each([
    [{ type: 'image/gif', size: 10 }, 'brief-1', 'tlf', CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [{ type: 'image/png', size: CREATIVE_ASSET_MAX_BYTES + 1 }, 'brief-1', 'tlf', CREATIVE_ASSET_TOO_LARGE_MESSAGE],
    // The type is checked first, then the size, then the brief.
    [{ type: 'image/gif', size: CREATIVE_ASSET_MAX_BYTES + 1 }, '', '', CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [{ type: 'image/jpeg', size: 10 }, '', 'tlf', 'Save the brief before uploading an image for it.'],
    [{ type: 'image/jpeg', size: 10 }, 'brief-1', '', 'Save the brief before uploading an image for it.'],
    [{ type: 'image/png', size: CREATIVE_ASSET_MAX_BYTES }, 'brief-1', 'tlf', null],
    // Matches the current Meta path: an empty file is not refused here.
    [{ type: 'image/jpeg', size: 0 }, 'brief-1', 'tlf', null],
  ])('%j for brief %j in %j: %j', (file, briefId, projectSlug, expected) => {
    expect(metaImageFileRefusal(file, briefId, projectSlug)).toBe(expected);
  });
});

describe('labels', () => {
  it.each([
    ['uploading', true, 'kubecon.png', 'Uploading image…'],
    ['idle', true, 'kubecon.png', 'Uploaded: kubecon.png'],
    ['idle', true, '', 'Uploaded: image'],
    ['idle', false, 'kubecon.png', ''],
    ['error', false, 'kubecon.png', ''],
  ] as const)('status %s, for this brief %s, name %j: %j', (status, forThisBrief, name, expected) => {
    expect(metaImageUploadStatusMessage(status, forThisBrief, name)).toBe(expected);
  });

  it.each([
    [{ imageAssetId: 'asset-1' }, 'kubecon.png', 'Image: kubecon.png'],
    [{ imageAssetId: 'asset-1' }, '', 'Image: uploaded image'],
    [{ imageUrl: 'https://example.org/a.png' }, 'kubecon.png', 'Image: https://example.org/a.png'],
    [{}, 'kubecon.png', ''],
  ])('preview for %j named %j: %j', (image, name, expected) => {
    expect(metaPreviewImageLabel(image, name)).toBe(expected);
  });
});

describe('metaImageCapabilities', () => {
  it.each([
    // Only an explicit yes offers the image; an unanswered read withholds it like a no.
    [null, null, false, false],
    [false, true, false, false],
    [null, true, false, false],
    [true, null, true, false],
    [true, false, true, false],
    [true, true, true, true],
  ])('creative %s, upload %s: image %s, upload %s', (creative, upload, creativeAvailable, uploadAvailable) => {
    expect(metaImageCapabilities(creative, upload)).toEqual({ creativeAvailable, uploadAvailable });
  });
});
