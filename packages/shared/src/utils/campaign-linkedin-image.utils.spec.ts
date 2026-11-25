// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CREATIVE_ASSET_WRONG_TYPE_MESSAGE, LINKEDIN_IMAGE_TOO_LARGE_MESSAGE } from '../constants/campaign.constants';
import type { LinkedInImageSlot, LinkedInVariantDraft, LinkedInVariantViewsInput } from '../interfaces/campaign.interface';
import {
  linkedInCanAddVariant,
  linkedInCanRemoveVariant,
  linkedInImageFileRefusal,
  linkedInImageSlotHeldByOther,
  linkedInImageUploadHoldsCreate,
  linkedInImageUploadOrphaned,
  linkedInVariantViews,
} from './campaign-linkedin-image.utils';

const variant = (key: string, over: Partial<LinkedInVariantDraft> = {}): LinkedInVariantDraft => ({
  key,
  introText: 'Join us',
  headline: 'Summit',
  imageAssetId: '',
  imageAssetName: '',
  imageAssetBriefId: '',
  ...over,
});
const IDLE: LinkedInImageSlot = { variantKey: '', status: 'idle', failedBriefId: '', error: '' };
const slot = (over: Partial<LinkedInImageSlot>): LinkedInImageSlot => ({ ...IDLE, ...over });

describe('linkedInCanAddVariant and linkedInCanRemoveVariant', () => {
  it.each([
    [1, true, false],
    [2, true, true],
    [14, true, true],
    [15, false, true],
  ])('with %i variants: add %s, remove %s', (count, add, remove) => {
    expect(linkedInCanAddVariant(count)).toBe(add);
    expect(linkedInCanRemoveVariant(count)).toBe(remove);
  });
});

describe('linkedInImageFileRefusal', () => {
  it.each([
    [{ type: 'image/png', size: 5_000_000 }, null],
    [{ type: 'image/jpeg', size: 1 }, null],
    [{ type: 'image/gif', size: 1 }, CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [{ type: 'image/png', size: 5_000_001 }, LINKEDIN_IMAGE_TOO_LARGE_MESSAGE],
  ])('refuses %j with %s', (file, expected) => {
    expect(linkedInImageFileRefusal(file)).toBe(expected);
  });
});

describe('the upload slot', () => {
  const variants = [variant('a'), variant('b')];

  it.each([
    [IDLE, false],
    [slot({ variantKey: 'a', status: 'uploading' }), false],
    [slot({ variantKey: 'gone', status: 'uploading' }), true],
  ])('slot %j is orphaned: %s', (s, orphaned) => {
    expect(linkedInImageUploadOrphaned(s, variants)).toBe(orphaned);
  });

  it.each([
    ['no upload', IDLE, false, 'b1', false],
    ['its own upload', slot({ variantKey: 'b', status: 'uploading' }), false, 'b1', false],
    ["another's upload in flight", slot({ variantKey: 'a', status: 'uploading' }), false, 'b1', true],
    ["another's upload failed for this brief", slot({ variantKey: 'a', status: 'error', failedBriefId: 'b1' }), false, 'b1', true],
    ["another's upload failed for another brief", slot({ variantKey: 'a', status: 'error', failedBriefId: 'b0' }), false, 'b1', false],
    ['an orphaned upload', slot({ variantKey: 'gone', status: 'uploading' }), true, 'b1', false],
  ])('variant b is held by %s: %s', (_name, s, orphaned, briefId, held) => {
    expect(linkedInImageSlotHeldByOther('b', s, orphaned, briefId)).toBe(held);
  });

  it.each([
    [true, true, slot({ variantKey: 'a', status: 'uploading' }), false, true],
    [true, true, slot({ variantKey: 'a', status: 'uploading' }), true, false],
    [true, false, slot({ variantKey: 'a', status: 'uploading' }), false, false],
    [false, true, slot({ variantKey: 'a', status: 'uploading' }), false, false],
    [true, true, slot({ variantKey: 'a', status: 'error' }), false, false],
  ])('section %s, uploads %s, slot %j, orphaned %s holds Create: %s', (show, available, s, orphaned, holds) => {
    expect(linkedInImageUploadHoldsCreate(show, available, s, orphaned)).toBe(holds);
  });
});

describe('linkedInVariantViews', () => {
  const input = (over: Partial<LinkedInVariantViewsInput>): LinkedInVariantViewsInput => ({
    variants: [variant('a'), variant('b')],
    slot: IDLE,
    briefId: 'b1',
    briefSaving: false,
    showSection: true,
    uploadEnabled: true,
    capabilityRead: 'ready',
    ...over,
  });

  it('shows the ad name, description and call to action, with their errors', () => {
    const [a, b] = linkedInVariantViews(
      input({ variants: [variant('a', { name: 'Same', description: 'Talks', callToAction: 'REGISTER' }), variant('b', { name: 'Same' })] })
    );
    expect(a).toMatchObject({ name: 'Same', description: 'Talks', callToAction: 'REGISTER', descriptionLength: 5, nameError: '', descriptionError: '' });
    expect(b.nameError).toContain('already has this name');
    expect(b).toMatchObject({ description: '', callToAction: '' });
  });

  it('shows copy lengths and refusals', () => {
    const [view] = linkedInVariantViews(input({ variants: [variant('a', { introText: 'x'.repeat(601), headline: ' ' })] }));
    expect(view.introTextLength).toBe(601);
    expect(view.introTextError).not.toBe('');
    expect(view.headlineError).not.toBe('');
  });

  it.each([
    ['an unsaved brief', { briefId: '' }, true],
    ['a brief mid-save', { briefSaving: true }, true],
    ['a saved brief', {}, false],
  ])('disables the picker for %s: %s', (_name, over, disabled) => {
    expect(linkedInVariantViews(input(over)).map((v) => v.imagePickerDisabled)).toEqual([disabled, disabled]);
  });

  it("holds the other pickers while one variant's upload runs, and names it", () => {
    const [a, b] = linkedInVariantViews(input({ slot: slot({ variantKey: 'a', status: 'uploading' }) }));
    expect(a).toMatchObject({ imageUploading: true, imageStatusMessage: 'Uploading image…', imagePickerDisabled: false, imagePickerNote: '' });
    expect(b).toMatchObject({ imageUploading: false, imagePickerDisabled: true, imagePickerNote: 'Finish or remove the image for variant 1 first.' });
  });

  it('shows a finished upload for this brief and its failure on its own variant only', () => {
    const uploaded = variant('a', { imageAssetId: 'x', imageAssetName: 'hero.png', imageAssetBriefId: 'b1' });
    const [a, b] = linkedInVariantViews(
      input({ variants: [uploaded, variant('b')], slot: slot({ variantKey: 'b', status: 'error', failedBriefId: 'b1', error: 'Too big.' }) })
    );
    expect(a).toMatchObject({ imageStatusMessage: 'Uploaded: hero.png', imageHeld: true, imageError: '', imageBlock: null });
    expect(b.imageError).toBe('Too big.');
    expect(b.imageBlock?.kind).toBe('uploadFailed');
    expect(b.imageBlock?.message).toContain('LinkedIn variant 2 did not complete: Too big.');
  });

  const uploaded = variant('a', { imageAssetId: 'x', imageAssetBriefId: 'b1' });
  it.each([
    ['an upload for another brief', { variants: [variant('a', { imageAssetId: 'x', imageAssetBriefId: 'b0' })] }, 'otherBrief'],
    ['uploads switched off', { variants: [uploaded], uploadEnabled: false }, 'unsupported'],
    ['the capability read in flight', { variants: [uploaded], uploadEnabled: null, capabilityRead: 'pending' as const }, 'pending'],
    ['the capability read failed', { variants: [uploaded], uploadEnabled: null, capabilityRead: 'failed' as const }, 'failed'],
    [
      'an upload running while the capability is unknown',
      { variants: [variant('a')], slot: slot({ variantKey: 'a', status: 'uploading' }), uploadEnabled: null },
      'failed',
    ],
    ['an upload the request can carry', { variants: [uploaded] }, null],
    ['a hidden section', { variants: [uploaded], uploadEnabled: false, showSection: false }, null],
  ])('blocks Create for %s: %s', (_name, over, kind) => {
    expect(linkedInVariantViews(input(over))[0].imageBlock?.kind ?? null).toBe(kind);
  });

  it('asks to save an unsaved brief before checking image support', () => {
    const restored = variant('a', { imageAssetId: 'x', imageAssetBriefId: '' });
    expect(linkedInVariantViews(input({ variants: [restored], briefId: '', uploadEnabled: null }))[0].imageBlock?.kind).toBe('unsaved');
  });
});
