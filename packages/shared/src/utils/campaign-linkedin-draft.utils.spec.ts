// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type {
  LinkedInBriefCopy,
  LinkedInDraftSnapshot,
  LinkedInDraftState,
  LinkedInTargetingStrategy,
  LinkedInVariantDraft,
} from '../interfaces/campaign.interface';
import { linkedInBriefSeed, linkedInDraftFields, linkedInDraftRestore, newLinkedInVariantDraft } from './campaign-linkedin-draft.utils';

const variant = (key: string, over: Partial<LinkedInVariantDraft> = {}): LinkedInVariantDraft => ({
  key,
  introText: 'Join us',
  headline: 'Summit',
  imageAssetId: '',
  imageAssetName: '',
  imageAssetBriefId: '',
  ...over,
});
const draft = (over: LinkedInDraftSnapshot): LinkedInDraftSnapshot => over;

describe('newLinkedInVariantDraft', () => {
  it('keeps the copy and image URN, with no upload', () => {
    expect(newLinkedInVariantDraft({ introText: 'i', headline: 'h', imageUrn: 'urn:li:image:1' }, 'k1')).toEqual({
      key: 'k1',
      introText: 'i',
      headline: 'h',
      imageUrn: 'urn:li:image:1',
      imageAssetId: '',
      imageAssetName: '',
      imageAssetBriefId: '',
    });
    expect('imageUrn' in newLinkedInVariantDraft({ introText: 'i', headline: 'h', imageUrn: '' }, 'k2')).toBe(false);
  });
});

describe('linkedInDraftFields', () => {
  const state: LinkedInDraftState = {
    budgetUsd: 1000,
    lifetimeBudget: true,
    dailyCapUsd: Number.NaN,
    variants: [variant('a')],
    uploadVariantKey: 'a',
    uploadPendingName: 'hero.png',
    uploadPendingBriefId: 'b1',
    uploadError: 'Too big.',
    uploadFailedBriefId: '',
    format: 'text',
    textAds: [{ key: 'text-ad-1', headline: 'h', description: 'd' }],
  };

  it('carries the format and a copy of each text ad', () => {
    const fields = linkedInDraftFields(state);
    expect(fields).toMatchObject({ linkedInFormat: 'text', linkedInTextAds: state.textAds });
    expect(fields.linkedInTextAds?.[0]).not.toBe(state.textAds[0]);
  });

  it('carries the budget pair and cap as held, and copies each variant', () => {
    const fields = linkedInDraftFields(state);
    expect(fields).toMatchObject({ linkedInBudgetUsd: 1000, linkedInLifetimeBudget: true, linkedInImageUploadPendingName: 'hero.png' });
    expect(fields.linkedInDailyCapUsd).toBeNaN();
    expect(fields.linkedInVariants).toEqual(state.variants);
    expect(fields.linkedInVariants?.[0]).not.toBe(state.variants[0]);
  });

  it.each([
    ['', ''],
    ['b1', 'Too big.'],
  ])('carries the failure message only with the brief it failed for (%j)', (failedBriefId, message) => {
    expect(linkedInDraftFields({ ...state, uploadFailedBriefId: failedBriefId }).linkedInImageUploadFailedMessage).toBe(message);
  });
});

describe('linkedInDraftRestore', () => {
  it('restores nothing an older draft omits, and empty removals and slot', () => {
    expect(linkedInDraftRestore(draft({}))).toEqual({ targetingRemovals: { skills: [], groups: [] }, uploadVariantKey: '' });
  });

  it.each([
    ['text', { format: 'text' }],
    ['single_image', { format: 'single_image' }],
    ['an unknown format', {}],
  ])('restores the format %s', (format, expected) => {
    // @ts-expect-error -- a stored draft is replayed from JSON, so an unknown format is possible
    const restore = linkedInDraftRestore(draft({ linkedInFormat: format === 'an unknown format' ? 'video' : format }));
    expect(restore.format).toBe((expected as { format?: string }).format);
  });

  it('restores a copy of each text ad', () => {
    const textAds = [{ key: 'text-ad-1', headline: 'h', description: 'd' }];
    const restore = linkedInDraftRestore(draft({ linkedInTextAds: textAds }));
    expect(restore.textAds).toEqual(textAds);
    expect(restore.textAds?.[0]).not.toBe(textAds[0]);
  });

  it.each([
    ['a cap', 20, 20],
    ['no cap', null, null],
    ['an unparsable cap', Number.NaN, null],
  ])('restores %s as %s', (_name, cap, expected) => {
    expect(linkedInDraftRestore(draft({ linkedInDailyCapUsd: cap })).dailyCapUsd).toBe(expected);
  });

  it('restores the budget pair, removals and a copy of each variant', () => {
    const variants = [variant('a')];
    const restore = linkedInDraftRestore(
      draft({ linkedInBudgetUsd: 250, linkedInLifetimeBudget: false, linkedInVariants: variants, linkedInTargetingRemovals: { skills: ['s'], groups: [] } })
    );
    expect(restore).toMatchObject({ budgetUsd: 250, lifetimeBudget: false, targetingRemovals: { skills: ['s'], groups: [] } });
    expect(restore.variants).toEqual(variants);
    expect(restore.variants?.[0]).not.toBe(variants[0]);
  });

  it.each([
    [
      'a failure with its brief',
      { linkedInImageUploadFailedMessage: 'Too big.', linkedInImageUploadFailedBriefId: 'b1' },
      { failedUpload: { message: 'Too big.', briefId: 'b1' } },
    ],
    ['a failure without its brief', { linkedInImageUploadFailedMessage: 'Too big.' }, {}],
    [
      'an upload still running',
      { linkedInImageUploadPendingName: 'hero.png', linkedInImageUploadVariantKey: 'a' },
      { pendingUpload: { name: 'hero.png', briefId: '' }, uploadVariantKey: 'a' },
    ],
  ])('restores %s', (_name, over, expected) => {
    const restore = linkedInDraftRestore(draft(over));
    expect(restore).toMatchObject(expected);
    if (!('failedUpload' in expected)) expect(restore.failedUpload).toBeUndefined();
  });
});

describe('linkedInBriefSeed', () => {
  const copy: LinkedInBriefCopy = {
    variants: [{ introText: 'i', headline: 'h' }],
    recommendedGeoTargets: [{ urn: 'urn:li:geo:1', label: 'United States' }],
    recommendedTargetingProfile: 'mcp',
  };
  let n = 0;
  const nextKey = () => `k${++n}`;

  it('seeds nothing without LinkedIn copy', () => {
    expect(linkedInBriefSeed(undefined, nextKey)).toBeNull();
  });

  it('seeds the variants, geos and profile', () => {
    const seed = linkedInBriefSeed(copy, nextKey);
    expect(seed?.variants.map((v) => v.headline)).toEqual(['h']);
    expect(seed?.geoTargets).toBe(copy.recommendedGeoTargets);
    expect(seed?.targetingProfile).toBe('mcp');
    expect(seed?.lifetimeBudgetUsd).toBeUndefined();
  });

  const strategy = (lifetimeBudgetUsd: number): LinkedInTargetingStrategy => ({
    targetingProfile: 'mcp',
    targetingRationale: '',
    recommendedSkills: [],
    recommendedGroups: [],
    recommendedJobFunctions: [],
    geoTargets: [],
    budgetRecommendation: { dailyBudgetUsd: 50, lifetimeBudgetUsd, rationale: '' },
    audienceEstimate: '',
    campaignStructureNotes: '',
  });

  it.each([
    [1500, 1500],
    [Number.NaN, undefined],
  ])("seeds the strategy's lifetime budget %j as %j", (budget, expected) => {
    expect(linkedInBriefSeed({ ...copy, strategy: strategy(budget) }, nextKey)?.lifetimeBudgetUsd).toBe(expected);
  });

  it('ignores a lifetime budget a restored brief stored as text', () => {
    const stored = strategy(1500);
    // @ts-expect-error -- a restored brief is replayed from stored JSON whose inner shape is not validated
    stored.budgetRecommendation.lifetimeBudgetUsd = '1500';
    expect(linkedInBriefSeed({ ...copy, strategy: stored }, nextKey)?.lifetimeBudgetUsd).toBeUndefined();
  });

  it('survives a restored strategy without a budget recommendation', () => {
    const stored = strategy(1500);
    // @ts-expect-error -- an old or hand-edited brief can lack this required field
    delete stored.budgetRecommendation;
    expect(linkedInBriefSeed({ ...copy, strategy: stored }, nextKey)?.lifetimeBudgetUsd).toBeUndefined();
  });
});
