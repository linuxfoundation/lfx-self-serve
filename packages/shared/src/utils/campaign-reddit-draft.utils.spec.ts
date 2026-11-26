// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_REDDIT_BUDGET_USD, DEFAULT_REDDIT_OBJECTIVE } from '../constants/campaign.constants';
import type { CampaignBriefOutput, RedditBriefCopy, RedditDraftSnapshot, RedditDraftState } from '../interfaces/campaign.interface';
import { redditBriefReset, redditBriefSeed, redditDraftFields, redditDraftRestore } from './campaign-reddit-draft.utils';

const draft = (over: RedditDraftSnapshot): RedditDraftSnapshot => over;

describe('redditDraftFields', () => {
  const state: RedditDraftState = {
    budgetUsd: 750,
    objective: 'video_views',
    postUrl: 'https://redd.it/abc123',
    imageUrl: 'https://cdn.example.org/promo.png',
    callToAction: 'Shop Now',
    conversionPixelId: 't2_synthpixel',
    assetId: 'asset-1',
    assetName: 'promo.png',
    assetBriefId: 'b1',
    uploadPendingName: 'next.png',
    uploadPendingBriefId: 'b1',
    uploadError: 'Too big.',
    uploadFailedBriefId: '',
    videoGoal: 'VIDEO_VIEW_15S',
    conversionEvent: 'SIGN_UP',
    customAudiences: { customAudienceIds: ['aud_in'], excludedCustomAudienceIds: ['aud_out'] },
  };

  it('carries every typed value, the pixel and the upload slot as held', () => {
    expect(redditDraftFields(state)).toEqual({
      redditBudgetUsd: 750,
      redditObjective: 'video_views',
      redditPostUrl: 'https://redd.it/abc123',
      redditImageUrl: 'https://cdn.example.org/promo.png',
      redditCallToAction: 'Shop Now',
      redditConversionPixelId: 't2_synthpixel',
      redditImageAssetId: 'asset-1',
      redditImageAssetName: 'promo.png',
      redditImageAssetBriefId: 'b1',
      redditImageUploadPendingName: 'next.png',
      redditImageUploadPendingBriefId: 'b1',
      redditImageUploadFailedMessage: '',
      redditImageUploadFailedBriefId: '',
      redditVideoGoal: 'VIDEO_VIEW_15S',
      redditConversionEvent: 'SIGN_UP',
      redditCustomAudienceIds: ['aud_in'],
      redditExcludedCustomAudienceIds: ['aud_out'],
    });
  });

  it.each([
    ['', ''],
    ['b1', 'Too big.'],
  ])('carries the failure message only with the brief it failed for (%j)', (failedBriefId, message) => {
    expect(redditDraftFields({ ...state, uploadFailedBriefId: failedBriefId }).redditImageUploadFailedMessage).toBe(message);
  });
});

describe('redditDraftRestore', () => {
  it('restores nothing an older draft omits', () => {
    expect(redditDraftRestore(draft({}))).toEqual({});
  });

  it('ignores the brief-derived lists an older build left in the draft, so the brief re-seeds them', () => {
    const stale = { redditVariants: [], redditSubreddits: [], redditInterests: ['stale-interest'], redditKeywords: [], redditGeoTargets: ['ZZ'] };
    expect(redditDraftRestore(stale as RedditDraftSnapshot)).toEqual({});
  });

  it('restores each typed value present, an objective the picker no longer offers included', () => {
    expect(
      redditDraftRestore(
        draft({
          redditBudgetUsd: 750,
          redditObjective: 'video_views',
          redditPostUrl: 'https://redd.it/abc123',
          redditImageUrl: 'https://cdn.example.org/promo.png',
          redditCallToAction: 'Shop Now',
          redditVideoGoal: 'VIDEO_VIEW_15S',
          redditConversionEvent: 'LEAD',
        })
      )
    ).toEqual({
      budgetUsd: 750,
      objective: 'video_views',
      postUrl: 'https://redd.it/abc123',
      imageUrl: 'https://cdn.example.org/promo.png',
      callToAction: 'Shop Now',
      videoGoal: 'VIDEO_VIEW_15S',
      conversionEvent: 'LEAD',
    });
  });

  it('restores an empty string as a deliberate clear, not as an older draft', () => {
    expect(redditDraftRestore(draft({ redditPostUrl: '', redditImageUrl: '', redditCallToAction: '', redditVideoGoal: '' }))).toEqual({
      postUrl: '',
      imageUrl: '',
      callToAction: '',
      videoGoal: '',
    });
  });

  it.each([
    ['a typed pixel', 't2_synthpixel', 't2_synthpixel'],
    ['a cleared pixel', '', ''],
    ['a pixel stored as a number', 42, undefined],
  ])('restores %s', (_name, stored, expected) => {
    // @ts-expect-error -- a draft is replayed from stored JSON whose inner shape is not validated
    expect(redditDraftRestore(draft({ redditConversionPixelId: stored })).conversionPixelId).toBe(expected);
  });

  it.each([
    [
      'a whole image',
      { redditImageAssetId: 'asset-1', redditImageAssetName: 'promo.png', redditImageAssetBriefId: 'b1' },
      { id: 'asset-1', name: 'promo.png', briefId: 'b1' },
    ],
    ['an image with no name or brief', { redditImageAssetId: 'asset-1' }, { id: 'asset-1', name: '', briefId: '' }],
    ['a removed image', { redditImageAssetId: '' }, { id: '', name: '', briefId: '' }],
    ['no image key', { redditImageAssetName: 'promo.png' }, undefined],
  ])('restores %s', (_name, over, expected) => {
    expect(redditDraftRestore(draft(over)).asset).toEqual(expected);
  });

  it.each([
    [
      'a failure with its brief',
      { redditImageUploadFailedMessage: 'Too big.', redditImageUploadFailedBriefId: 'b1' },
      { failedUpload: { message: 'Too big.', briefId: 'b1' } },
    ],
    ['a failure without its brief', { redditImageUploadFailedMessage: 'Too big.' }, {}],
    ['a brief without its failure', { redditImageUploadFailedBriefId: 'b1' }, {}],
    [
      'an upload still running, for its brief',
      { redditImageUploadPendingName: 'promo.png', redditImageUploadPendingBriefId: 'b1' },
      { pendingUpload: { name: 'promo.png', briefId: 'b1' } },
    ],
    ['an upload still running, with no brief', { redditImageUploadPendingName: 'promo.png' }, { pendingUpload: { name: 'promo.png', briefId: '' } }],
    ['an upload brief with no file', { redditImageUploadPendingBriefId: 'b1' }, {}],
  ])('restores %s', (_name, over, expected) => {
    expect(redditDraftRestore(draft(over))).toEqual(expected);
  });
});

describe('redditDraftRestore: custom audiences', () => {
  it.each<[string, Partial<RedditDraftSnapshot>, unknown]>([
    [
      'both lists',
      { redditCustomAudienceIds: ['a1'], redditExcludedCustomAudienceIds: ['b1'] },
      { customAudienceIds: ['a1'], excludedCustomAudienceIds: ['b1'] },
    ],
    ['one list, the other empty', { redditExcludedCustomAudienceIds: ['b1'] }, { customAudienceIds: [], excludedCustomAudienceIds: ['b1'] }],
    ['neither key (an older draft)', {}, undefined],
  ])('restores %s', (_name, over, expected) => {
    expect(redditDraftRestore(draft(over)).customAudiences).toEqual(expected);
  });

  it.each([
    ['only the strings of a stored list', ['a1', 7, null], { customAudienceIds: ['a1'], excludedCustomAudienceIds: [] }],
    ['a list stored as text', 'a1', undefined],
  ])('restores %s', (_name, stored, expected) => {
    // @ts-expect-error -- a draft is replayed from stored JSON whose inner shape is not validated
    expect(redditDraftRestore(draft({ redditCustomAudienceIds: stored })).customAudiences).toEqual(expected);
  });
});

describe('redditBriefReset', () => {
  it('sets every typed value to its default and empties the brief lists', () => {
    expect(redditBriefReset()).toEqual({
      postUrl: '',
      imageUrl: '',
      callToAction: '',
      objective: DEFAULT_REDDIT_OBJECTIVE,
      videoGoal: '',
      conversionEvent: 'PURCHASE',
      customAudiences: { customAudienceIds: [], excludedCustomAudienceIds: [] },
      budgetUsd: DEFAULT_REDDIT_BUDGET_USD,
      variants: [],
      subreddits: [],
      interests: [],
      keywords: [],
      geoTargets: [],
    });
  });

  it('hands out fresh lists each time', () => {
    expect(redditBriefReset().variants).not.toBe(redditBriefReset().variants);
  });
});

describe('redditBriefSeed', () => {
  const copy: RedditBriefCopy = {
    variants: [{ headline: 'Brief reddit headline' }],
    recommendedSubreddits: ['briefsub'],
    recommendedInterests: ['brief-interest'],
    recommendedKeywords: ['brief-keyword'],
    recommendedGeos: ['US'],
  };
  const legacy = {
    variants: [{ headline: 'Legacy headline' }],
    recommended_subreddits: ['legacysub'],
    recommended_interests: ['legacy-interest'],
    recommended_keywords: ['legacy-keyword'],
    recommended_geos: ['GB'],
  };
  const brief = (over: Partial<CampaignBriefOutput>): Pick<CampaignBriefOutput, 'structuredCopy' | 'redditCopy'> => ({ structuredCopy: null, ...over });

  it.each([
    ['no copy at all', brief({})],
    ['structured copy without a Reddit block', brief({ structuredCopy: { google_search: {} } })],
  ])('seeds nothing from %s', (_name, input) => {
    expect(redditBriefSeed(input)).toBeNull();
  });

  it('seeds the variants and the four lists from the Reddit copy', () => {
    expect(redditBriefSeed(brief({ redditCopy: copy }))).toEqual({
      variants: copy.variants,
      subreddits: ['briefsub'],
      interests: ['brief-interest'],
      keywords: ['brief-keyword'],
      geoTargets: ['US'],
    });
  });

  it('seeds from the legacy reddit_promoted block', () => {
    expect(redditBriefSeed(brief({ structuredCopy: { reddit_promoted: legacy } }))).toEqual({
      variants: legacy.variants,
      subreddits: ['legacysub'],
      interests: ['legacy-interest'],
      keywords: ['legacy-keyword'],
      geoTargets: ['GB'],
    });
  });

  it('seeds a list the legacy block lacks as empty', () => {
    expect(redditBriefSeed(brief({ structuredCopy: { reddit_promoted: { variants: legacy.variants } } }))).toEqual({
      variants: legacy.variants,
      subreddits: [],
      interests: [],
      keywords: [],
      geoTargets: [],
    });
  });

  it('prefers the Reddit copy over the legacy block', () => {
    expect(redditBriefSeed(brief({ redditCopy: copy, structuredCopy: { reddit_promoted: legacy } }))?.subreddits).toEqual(['briefsub']);
  });
});
