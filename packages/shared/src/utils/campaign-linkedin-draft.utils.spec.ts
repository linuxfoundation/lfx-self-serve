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
    carouselCards: [{ key: 'card-1', imageAssetId: 'img', imageAssetBriefId: 'b1', headline: 'Keynote', destinationUrl: '' }],
    carouselIntroText: 'Meet the speakers',
    document: { assetId: 'pdf', assetBriefId: 'b1', title: 'Prospectus', introText: 'Sponsor us' },
    customTargeting: true,
    targetingDraft: { clauses: [{ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] }], exclude: {}, segmentsAccountId: null },
    objectiveDraft: { objective: 'conversions', conversions: ['104012'], conversionsOwner: 'tlf|' },
    deliveryOptions: { audienceExpansion: true, audienceNetwork: false },
  };

  it('carries a copy of the delivery options', () => {
    const fields = linkedInDraftFields(state);
    expect(fields.linkedInDeliveryOptions).toEqual(state.deliveryOptions);
    expect(fields.linkedInDeliveryOptions).not.toBe(state.deliveryOptions);
  });

  it('carries the objective and a copy of its conversion rules', () => {
    const fields = linkedInDraftFields(state);
    expect(fields.linkedInObjectiveDraft).toEqual(state.objectiveDraft);
    expect(fields.linkedInObjectiveDraft?.conversions).not.toBe(state.objectiveDraft.conversions);
  });

  it('carries custom targeting and a copy of its draft', () => {
    const fields = linkedInDraftFields(state);
    expect(fields).toMatchObject({ linkedInCustomTargeting: true, linkedInTargetingDraft: state.targetingDraft });
    expect(fields.linkedInTargetingDraft?.clauses[0]).not.toBe(state.targetingDraft.clauses[0]);
  });

  it('carries the format and a copy of each text ad', () => {
    const fields = linkedInDraftFields(state);
    expect(fields).toMatchObject({ linkedInFormat: 'text', linkedInTextAds: state.textAds });
    expect(fields.linkedInTextAds?.[0]).not.toBe(state.textAds[0]);
  });

  it('carries the carousel intro and a copy of each card', () => {
    const fields = linkedInDraftFields(state);
    expect(fields).toMatchObject({ linkedInCarouselIntroText: 'Meet the speakers', linkedInCarouselCards: state.carouselCards });
    expect(fields.linkedInCarouselCards?.[0]).not.toBe(state.carouselCards[0]);
  });

  it('carries a copy of the document ad', () => {
    const fields = linkedInDraftFields(state);
    expect(fields.linkedInDocument).toEqual(state.document);
    expect(fields.linkedInDocument).not.toBe(state.document);
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
    ['text', 'text'],
    ['single_image', 'single_image'],
    ['video', 'video'],
    ['carousel', 'carousel'],
    ['document', 'document'],
    ['slideshow', undefined],
  ])('restores a stored format %s as %s', (stored, expected) => {
    // A stored draft is replayed from JSON, so an unknown format is possible.
    expect(linkedInDraftRestore(draft({ linkedInFormat: stored as LinkedInDraftSnapshot['linkedInFormat'] })).format).toBe(expected);
  });

  // A malformed stored document is `linkedInDocumentDraftFromStored`'s, tested in its own spec.
  it('restores a stored document ad, present-only', () => {
    const stored = { assetId: 'pdf', assetBriefId: 'b1', title: 'Prospectus', introText: 'Sponsor us' };
    expect(linkedInDraftRestore(draft({ linkedInDocument: stored })).document).toEqual(stored);
    expect(linkedInDraftRestore(draft({})).document).toBeUndefined();
  });

  it('restores carousel cards whose fields are text, and the intro text, present-only', () => {
    const restore = linkedInDraftRestore(
      draft({
        linkedInCarouselCards: [
          { key: 'card-1', imageAssetId: 'img', imageAssetBriefId: 'b1', headline: 'Keynote', destinationUrl: 7 },
          { headline: 'no key' },
          { key: 'card-1', headline: 'a repeated key' },
        ] as unknown as LinkedInDraftSnapshot['linkedInCarouselCards'],
        linkedInCarouselIntroText: 'Hi',
      })
    );
    expect(restore.carouselCards).toEqual([{ key: 'card-1', imageAssetId: 'img', imageAssetBriefId: 'b1', headline: 'Keynote', destinationUrl: '' }]);
    expect(restore.carouselIntroText).toBe('Hi');
    expect(linkedInDraftRestore(draft({}))).not.toHaveProperty('carouselCards');
  });

  it.each([
    ['a stored draft', { clauses: [{ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] }], exclude: {}, segmentsAccountId: null }, true],
    [
      'the account its segments were picked for',
      { clauses: [{ dynamicSegments: [{ urn: 'urn:li:adSegment:7', name: 'Site visitors' }] }], exclude: {}, segmentsAccountId: '100000002' },
      true,
    ],
    ['a draft with no clause list', { exclude: {} }, false],
  ])('restores custom targeting and %s', (_label, stored, restored) => {
    const restore = linkedInDraftRestore(
      draft({ linkedInCustomTargeting: true, linkedInTargetingDraft: stored as LinkedInDraftSnapshot['linkedInTargetingDraft'] })
    );
    expect(restore.customTargeting).toBe(true);
    expect(restore.targetingDraft).toEqual(restored ? stored : undefined);
  });

  it.each([
    [
      'a stored draft',
      { objective: 'conversions', conversions: ['104012'], conversionsOwner: 'tlf|' },
      { objective: 'conversions', conversions: ['104012'], conversionsOwner: 'tlf|' },
    ],
    [
      'an unknown objective as the default',
      { objective: 'leads', conversions: [], conversionsOwner: null },
      { objective: null, conversions: [], conversionsOwner: null },
    ],
    [
      'only text ids, and no owner without rules',
      { objective: 'traffic', conversions: [7], conversionsOwner: 'tlf|' },
      { objective: 'traffic', conversions: [], conversionsOwner: null },
    ],
    [
      'a malformed id as it is, for the create to hold',
      { objective: 'conversions', conversions: ['0x'], conversionsOwner: 'tlf|' },
      { objective: 'conversions', conversions: ['0x'], conversionsOwner: 'tlf|' },
    ],
    [
      'the target cost as typed, even one the create refuses',
      { objective: null, conversions: [], conversionsOwner: null, targetCost: '17.885' },
      { objective: null, conversions: [], conversionsOwner: null, targetCost: '17.885' },
    ],
    [
      'no target cost that is not text',
      { objective: null, conversions: [], conversionsOwner: null, targetCost: 17.88 },
      { objective: null, conversions: [], conversionsOwner: null },
    ],
    [
      'no blank target cost',
      { objective: null, conversions: [], conversionsOwner: null, targetCost: '' },
      { objective: null, conversions: [], conversionsOwner: null },
    ],
    ['nothing from a draft that is not a record', ['traffic'], undefined],
  ])('restores the objective: %s', (_label, stored, expected) => {
    const restore = linkedInDraftRestore(draft({ linkedInObjectiveDraft: stored as unknown as LinkedInDraftSnapshot['linkedInObjectiveDraft'] }));
    expect(restore.objectiveDraft).toEqual(expected);
  });

  // The delivery options (campaign-service#667); their stored-shape rows are in `campaign-linkedin-delivery-options-form.utils.spec.ts`.
  it.each([
    ['present', { audienceExpansion: true, audienceNetwork: true }, { audienceExpansion: true, audienceNetwork: true }],
    ['absent, from an older draft', undefined, undefined],
  ])('restores the delivery options: %s', (_label, stored, expected) => {
    expect(linkedInDraftRestore(draft({ linkedInDeliveryOptions: stored })).deliveryOptions).toEqual(expected);
  });

  it('restores a copy of each text ad', () => {
    const textAds = [{ key: 'text-ad-1', headline: 'h', description: 'd' }];
    const restore = linkedInDraftRestore(draft({ linkedInTextAds: textAds }));
    expect(restore.textAds).toEqual(textAds);
    expect(restore.textAds?.[0]).not.toBe(textAds[0]);
  });

  it('drops a restored text ad whose fields are not all text', () => {
    const textAds = [{ key: 'text-ad-1', headline: 'h', description: 'd' }, { key: 'text-ad-2', headline: 7, description: 'd' }, null];
    // @ts-expect-error -- a draft is replayed from stored JSON whose inner shape is not validated
    expect(linkedInDraftRestore(draft({ linkedInTextAds: textAds })).textAds).toEqual([textAds[0]]);
  });

  it.each([
    [
      'a whole image',
      { imageAssetId: 'a-1', imageAssetName: 'x.png', imageAssetBriefId: 'b-1' },
      { imageAssetId: 'a-1', imageAssetName: 'x.png', imageAssetBriefId: 'b-1' },
    ],
    ['an image with no brief', { imageAssetId: 'a-1', imageAssetName: 'x.png' }, {}],
    ['no image', { imageAssetId: '', imageAssetBriefId: 'b-1' }, {}],
  ])('restores a text ad with %s', (_name, imageFields, expected) => {
    const textAds = [{ key: 'text-ad-1', headline: 'h', description: 'd', ...imageFields }];
    expect(linkedInDraftRestore(draft({ linkedInTextAds: textAds })).textAds).toEqual([{ key: 'text-ad-1', headline: 'h', description: 'd', ...expected }]);
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
