// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_META_AUDIENCE_TARGETING, META_DEFAULT_PLACEMENTS } from '../constants/campaign.constants';
import type { MetaAudienceTargetingDraft, MetaDraftSnapshot, MetaDraftState, MetaImageDraftState } from '../interfaces/campaign.interface';
import {
  copyMetaAudienceTargeting,
  metaDraftFields,
  metaDraftRestore,
  metaPendingDraftFields,
  metaImageDraftFields,
  metaImageDraftRestore,
  metaInstagramDsaPatch,
} from './campaign-meta-draft.utils';

const draft = (meta: MetaDraftSnapshot): MetaDraftSnapshot => meta;

const state: MetaDraftState = {
  objective: 'conversions',
  placements: { ...META_DEFAULT_PLACEMENTS, reels: true },
  pixelId: '554433',
  geoTargets: ['US', 'DE'],
  instagramUserId: '17841400000000000',
  dsaBeneficiary: 'CNCF',
  dsaPayor: 'The Linux Foundation',
  audienceTargeting: { ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 25, customAudiences: ['1001'] },
  adOptions: { conversionEvent: 'LEAD' },
  leadFormId: '',
  foundation: 'tlf',
  budgetUsd: 500,
  lifetimeBudget: true,
};

describe('metaDraftFields', () => {
  it('snapshots every Meta field, stamping the foundation on targeting, ad options and the lead form', () => {
    expect(metaDraftFields(state)).toEqual({
      metaObjective: 'conversions',
      metaPlacements: { ...META_DEFAULT_PLACEMENTS, reels: true },
      metaPixelId: '554433',
      metaGeoTargets: ['US', 'DE'],
      metaInstagramUserId: '17841400000000000',
      metaDsaBeneficiary: 'CNCF',
      metaDsaPayor: 'The Linux Foundation',
      metaAudienceTargeting: { ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 25, customAudiences: ['1001'] },
      metaAudienceTargetingProject: 'tlf',
      metaAdOptions: { conversionEvent: 'LEAD' },
      metaAdOptionsProject: 'tlf',
      metaLeadFormId: '',
      metaLeadFormProject: 'tlf',
      metaBudgetUsd: 500,
      metaLifetimeBudget: true,
    });
  });

  it('holds values, never live views of the form state', () => {
    const fields = metaDraftFields(state);
    expect(fields.metaPlacements).not.toBe(state.placements);
    expect(fields.metaGeoTargets).not.toBe(state.geoTargets);
    expect(fields.metaAdOptions).not.toBe(state.adOptions);
    expect(fields.metaAudienceTargeting).not.toBe(state.audienceTargeting);
    expect(fields.metaAudienceTargeting?.customAudiences).not.toBe(state.audienceTargeting.customAudiences);
  });
});

describe('metaImageDraftFields', () => {
  const image: MetaImageDraftState = {
    imageUrl: 'https://cdn.example.org/a.png',
    assetId: 'asset-1',
    assetName: 'kubecon.png',
    assetBriefId: 'brief-1',
    uploadPendingName: '',
    uploadPendingBriefId: '',
    uploadError: 'the image is truncated',
    uploadFailedBriefId: '',
  };

  it('keeps a failure message only while the failure is recorded for a brief', () => {
    expect(metaImageDraftFields(image).metaImageUploadFailedMessage).toBe('');
    expect(metaImageDraftFields({ ...image, uploadFailedBriefId: 'brief-1' })).toMatchObject({
      metaImageUploadFailedMessage: 'the image is truncated',
      metaImageUploadFailedBriefId: 'brief-1',
    });
  });

  it('carries the URL, the asset and an in-flight upload as they are', () => {
    expect(metaImageDraftFields({ ...image, uploadPendingName: 'next.png', uploadPendingBriefId: 'brief-1' })).toMatchObject({
      metaImageUrl: 'https://cdn.example.org/a.png',
      metaImageAssetId: 'asset-1',
      metaImageAssetName: 'kubecon.png',
      metaImageAssetBriefId: 'brief-1',
      metaImageUploadPendingName: 'next.png',
      metaImageUploadPendingBriefId: 'brief-1',
    });
  });
});

describe('metaDraftRestore', () => {
  it('leaves every seeded value standing for a draft saved before the Meta fields shipped', () => {
    expect(metaDraftRestore(draft({}), 'conversions', 'tlf')).toEqual({ objective: 'conversions', instagramDsaPatch: {}, leadFormId: null });
  });

  it('restores a present-but-empty pixel id as a real cleared value', () => {
    expect(metaDraftRestore(draft({ metaPixelId: '' }), 'conversions', 'tlf').pixelId).toBe('');
  });

  it('restores what a full draft for this foundation carries', () => {
    const fields = metaDraftFields(state);
    expect(metaDraftRestore(draft(fields), 'traffic', 'tlf')).toEqual({
      objective: 'conversions',
      placements: { ...META_DEFAULT_PLACEMENTS, reels: true },
      pixelId: '554433',
      instagramDsaPatch: { instagramUserId: '17841400000000000', dsaBeneficiary: 'CNCF', dsaPayor: 'The Linux Foundation' },
      audienceTargeting: { ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 25, customAudiences: ['1001'] },
      adOptions: { conversionEvent: 'LEAD' },
      leadFormId: '',
      geoTargets: ['US', 'DE'],
      budgetUsd: 500,
      lifetimeBudget: true,
    });
  });

  it("drops another foundation's targeting, ad options and lead form, and its leads objective", () => {
    const saved = draft({ ...metaDraftFields({ ...state, objective: 'leads', leadFormId: '12345' }) });
    const restored = metaDraftRestore(saved, 'traffic', 'cncf');
    expect(restored.audienceTargeting).toBeUndefined();
    expect(restored.adOptions).toBeUndefined();
    expect(restored.leadFormId).toBe('');
    expect(restored.objective).not.toBe('leads');
  });

  it('keeps a lead form for this foundation under leads', () => {
    const saved = draft({ metaObjective: 'leads', metaLeadFormId: '12345', metaLeadFormProject: 'tlf' });
    expect(metaDraftRestore(saved, 'traffic', 'tlf')).toMatchObject({ objective: 'leads', leadFormId: '12345' });
  });

  it('keeps the current lead form while the foundation is still unknown', () => {
    expect(metaDraftRestore(draft({ metaLeadFormId: '12345', metaLeadFormProject: 'tlf' }), 'leads', '').leadFormId).toBeNull();
  });

  it('filters ad options by the restored objective, not the current one', () => {
    const saved = draft({
      metaObjective: 'conversions',
      metaAdOptions: { conversionEvent: 'lead', optimizationGoal: 'LINK_CLICKS' },
      metaAdOptionsProject: 'tlf',
    });
    // Under the current `traffic` the conversion event would be dropped; under the restored `conversions` it stays.
    expect(metaDraftRestore(saved, 'traffic', 'tlf').adOptions).toEqual({ conversionEvent: 'LEAD' });
  });

  it('fills targeting a draft saved before a field existed with the defaults, as a copy', () => {
    // Persisted JSON from before the custom-audience fields existed.
    const legacy: MetaAudienceTargetingDraft = { ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 30 };
    // @ts-expect-error -- an old draft lacks this required field
    delete legacy.customAudiences;
    const saved = draft({ metaAudienceTargeting: legacy, metaAudienceTargetingProject: 'tlf' });
    expect(metaDraftRestore(saved, 'traffic', 'tlf').audienceTargeting).toEqual({ ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 30 });
    expect(metaDraftRestore(saved, 'traffic', 'tlf').audienceTargeting?.genders).not.toBe(DEFAULT_META_AUDIENCE_TARGETING.genders);
  });

  it('drops a restored geo Meta will not target', () => {
    expect(metaDraftRestore(draft({ metaGeoTargets: ['ir', 'JP', 'jp'] }), 'traffic', 'tlf').geoTargets).toEqual(['JP']);
  });
});

describe('metaInstagramDsaPatch', () => {
  it.each([
    [{}, {}],
    [
      { metaInstagramUserId: '1784', metaDsaPayor: '' },
      { instagramUserId: '1784', dsaPayor: '' },
    ],
  ] as [MetaDraftSnapshot, Record<string, string>][])('%j patches %j', (saved, expected) => {
    expect(metaInstagramDsaPatch(saved)).toEqual(expected);
  });

  it('never restores a non-string into a text control', () => {
    // @ts-expect-error -- persisted JSON can carry the wrong type
    expect(metaInstagramDsaPatch({ metaDsaBeneficiary: 42 })).toEqual({});
  });
});

describe('metaImageDraftRestore', () => {
  it('restores nothing from a draft without image fields', () => {
    expect(metaImageDraftRestore(draft({}))).toEqual({});
  });

  it('restores the URL and the asset, defaulting a missing name and brief to blank', () => {
    expect(metaImageDraftRestore(draft({ metaImageUrl: '', metaImageAssetId: 'asset-1' }))).toEqual({
      imageUrl: '',
      asset: { id: 'asset-1', name: '', briefId: '' },
    });
  });

  it.each([
    [{ metaImageUploadFailedMessage: 'truncated', metaImageUploadFailedBriefId: 'brief-1' }, { failedUpload: { message: 'truncated', briefId: 'brief-1' } }],
    // A failure needs both its message and its brief.
    [{ metaImageUploadFailedMessage: 'truncated', metaImageUploadFailedBriefId: '' }, {}],
    [{ metaImageUploadPendingName: 'next.png', metaImageUploadPendingBriefId: 'brief-1' }, { pendingUpload: { name: 'next.png', briefId: 'brief-1' } }],
    [{ metaImageUploadPendingName: 'next.png' }, { pendingUpload: { name: 'next.png', briefId: '' } }],
    [{ metaImageUploadPendingName: '' }, {}],
  ])('%j gives %j', (saved, expected) => {
    expect(metaImageDraftRestore(saved)).toEqual(expected);
  });
});

describe('copyMetaAudienceTargeting', () => {
  it('copies every list', () => {
    const source: MetaAudienceTargetingDraft = {
      ...DEFAULT_META_AUDIENCE_TARGETING,
      genders: ['female'],
      customAudiences: ['1'],
      excludedCustomAudiences: ['2'],
    };
    const copy = copyMetaAudienceTargeting(source);
    expect(copy).toEqual(source);
    expect(copy.genders).not.toBe(source.genders);
    expect(copy.customAudiences).not.toBe(source.customAudiences);
    expect(copy.excludedCustomAudiences).not.toBe(source.excludedCustomAudiences);
  });
});

describe('metaPendingDraftFields', () => {
  it('keeps only the foundation-scoped fields a waiting draft carries, with their project stamps', () => {
    const fields = metaDraftFields({ ...state, foundation: 'tlf' });
    expect(metaPendingDraftFields(draft(fields))).toEqual({
      metaObjective: fields.metaObjective,
      metaAudienceTargeting: fields.metaAudienceTargeting,
      metaAudienceTargetingProject: 'tlf',
      metaAdOptions: fields.metaAdOptions,
      metaAdOptionsProject: 'tlf',
      metaLeadFormId: fields.metaLeadFormId,
      metaLeadFormProject: 'tlf',
    });
  });

  it('adds nothing for a draft saved before those fields shipped', () => {
    expect(metaPendingDraftFields(draft({ metaPixelId: '1' }))).toEqual({});
  });
});
