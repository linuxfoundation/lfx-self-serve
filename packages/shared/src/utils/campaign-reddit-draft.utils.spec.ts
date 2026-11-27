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
    videoPost: { videoAssetId: 'v-1', videoBriefId: 'b1', thumbnailAssetId: 'i-1', thumbnailBriefId: 'b1' },
    conversionEvent: 'SIGN_UP',
    customAudiences: { customAudienceIds: ['aud_in'], excludedCustomAudienceIds: ['aud_out'] },
    targetingExclusions: { excludedSubreddits: ['politics'], excludedGeoTargets: ['CA'] },
    subCountryGeoTargets: ['US-CA', '662'],
    editedTargetingLists: { subreddits: ['kubernetes'], interests: ['technology_v3'] },
    delivery: { budgetType: 'daily', placements: ['FEED'], platforms: ['DESKTOP', 'MOBILE_WEB'], expandTargeting: false },
    editedVariants: [{ headline: 'Edited headline', body: 'Brief body' }, { headline: 'Second' }],
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
      redditVideoPost: { videoAssetId: 'v-1', videoBriefId: 'b1', thumbnailAssetId: 'i-1', thumbnailBriefId: 'b1' },
      redditConversionEvent: 'SIGN_UP',
      redditCustomAudienceIds: ['aud_in'],
      redditExcludedCustomAudienceIds: ['aud_out'],
      redditExcludedSubreddits: ['politics'],
      redditExcludedGeoTargets: ['CA'],
      redditSubCountryGeoTargets: ['US-CA', '662'],
      redditEditedSubreddits: ['kubernetes'],
      redditEditedInterests: ['technology_v3'],
      redditBudgetType: 'daily',
      redditPlacements: ['FEED'],
      redditPlatforms: ['DESKTOP', 'MOBILE_WEB'],
      redditExpandTargeting: false,
      redditEditedVariants: [{ headline: 'Edited headline', body: 'Brief body' }, { headline: 'Second' }],
    });
  });

  it('leaves unedited subreddits, interests and variants out, so the brief re-seeds them', () => {
    const fields = redditDraftFields({ ...state, editedTargetingLists: null, editedVariants: null });
    expect(fields).not.toHaveProperty('redditEditedSubreddits');
    expect(fields).not.toHaveProperty('redditEditedInterests');
    expect(fields).not.toHaveProperty('redditEditedVariants');
  });

  it('leaves a video post with nothing picked out (#6108 row 8)', () => {
    const empty = { videoAssetId: '', videoBriefId: '', thumbnailAssetId: '', thumbnailBriefId: '' };
    expect(redditDraftFields({ ...state, videoPost: empty })).not.toHaveProperty('redditVideoPost');
  });

  it.each([
    ['', ''],
    ['b1', 'Too big.'],
  ])('carries the failure message only with the brief it failed for (%j)', (failedBriefId, message) => {
    expect(redditDraftFields({ ...state, uploadFailedBriefId: failedBriefId }).redditImageUploadFailedMessage).toBe(message);
  });

  it('leaves the regions, cities and DMAs out until one is added, so an unused draft is unchanged', () => {
    expect(redditDraftFields({ ...state, subCountryGeoTargets: [] })).not.toHaveProperty('redditSubCountryGeoTargets');
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

// The field rules are `redditVideoPostFromDraft`'s (campaign-reddit-video.utils.spec.ts); this tests the key.
describe('redditDraftRestore: video post', () => {
  it.each<[string, unknown, unknown]>([
    ['no key (an older draft)', undefined, undefined],
    [
      'the picks',
      { videoAssetId: 'v-1', videoBriefId: 'b1', thumbnailAssetId: 'i-1', thumbnailBriefId: 'b1' },
      { videoAssetId: 'v-1', videoBriefId: 'b1', thumbnailAssetId: 'i-1', thumbnailBriefId: 'b1' },
    ],
  ])('restores %s', (_name, stored, expected) => {
    expect(redditDraftRestore(draft({ redditVideoPost: stored } as RedditDraftSnapshot)).videoPost).toEqual(expected);
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

describe('redditDraftRestore: targeting exclusions', () => {
  it.each<[string, unknown, unknown, unknown]>([
    ['both lists', ['politics'], ['CA'], { excludedSubreddits: ['politics'], excludedGeoTargets: ['CA'] }],
    ['one list, the other empty', undefined, ['CA'], { excludedSubreddits: [], excludedGeoTargets: ['CA'] }],
    ['only the strings of a stored list', ['politics', 7], undefined, { excludedSubreddits: ['politics'], excludedGeoTargets: [] }],
    ['neither key (an older draft)', undefined, undefined, undefined],
  ])('restores %s', (_name, subs, geos, expected) => {
    // @ts-expect-error -- a draft is replayed from stored JSON whose inner shape is not validated
    expect(redditDraftRestore(draft({ redditExcludedSubreddits: subs, redditExcludedGeoTargets: geos })).targetingExclusions).toEqual(expected);
  });
});

describe('redditDraftRestore: regions, cities and DMAs', () => {
  it.each<[string, unknown, unknown]>([
    ['no key (an older draft), so the empty list stands', undefined, undefined],
    ['a value that is not a list', 'US-CA', undefined],
    ['only the strings of a list', ['US-CA', 3, null, '662'], ['US-CA', '662']],
  ])('restores %s', (_name, stored, expected) => {
    expect(redditDraftRestore(draft({ redditSubCountryGeoTargets: stored } as RedditDraftSnapshot)).subCountryGeoTargets).toEqual(expected);
  });
});

describe('redditDraftRestore: edited subreddits and interests', () => {
  it.each<[string, unknown, unknown, unknown]>([
    ['both lists', ['kubernetes'], ['technology_v3'], { subreddits: ['kubernetes'], interests: ['technology_v3'] }],
    ['a cleared list beside a missing one', [], undefined, { subreddits: [], interests: [] }],
    ['only the strings of a stored list', ['kubernetes', 7], undefined, { subreddits: ['kubernetes'], interests: [] }],
    ['neither key (an older draft), so the seed stands', undefined, undefined, undefined],
  ])('restores %s', (_name, subs, interests, expected) => {
    // @ts-expect-error -- a draft is replayed from stored JSON whose inner shape is not validated
    expect(redditDraftRestore(draft({ redditEditedSubreddits: subs, redditEditedInterests: interests })).editedTargetingLists).toEqual(expected);
  });
});

// Each key is read on its own; the capability gate is `redditDeliveryInEffect`'s (campaign-reddit-delivery.utils.spec.ts).
describe('redditDraftRestore: delivery choices', () => {
  const ALL = { budgetType: 'lifetime', placements: ['FEED', 'COMMENTS_PAGE'], platforms: ['DESKTOP', 'MOBILE_NATIVE', 'MOBILE_WEB'], expandTargeting: true };
  it.each<[string, Record<string, unknown>, unknown]>([
    ['none of the keys (an older draft), so the defaults stand', {}, undefined],
    [
      'every choice',
      { redditBudgetType: 'daily', redditPlacements: ['FEED'], redditPlatforms: ['MOBILE_WEB'], redditExpandTargeting: false },
      { budgetType: 'daily', placements: ['FEED'], platforms: ['MOBILE_WEB'], expandTargeting: false },
    ],
    ['one key, the rest at their defaults', { redditExpandTargeting: false }, { ...ALL, expandTargeting: false }],
    ['an unknown budget type as lifetime', { redditBudgetType: 'weekly' }, ALL],
    ['only the known values of a list, in order', { redditPlatforms: ['MOBILE_WEB', 'ALL', 'DESKTOP'] }, { ...ALL, platforms: ['DESKTOP', 'MOBILE_WEB'] }],
    ['an empty list as every value', { redditPlacements: [] }, ALL],
    ['a list that is not one as every value', { redditPlacements: 'FEED' }, ALL],
    ['an expandTargeting that is not a boolean as on', { redditExpandTargeting: 'false' }, ALL],
  ])('restores %s', (_name, stored, expected) => {
    expect(redditDraftRestore(draft(stored as RedditDraftSnapshot)).delivery).toEqual(expected);
  });
});

// The entry rules are `redditAdVariantsFromDraft`'s (campaign-reddit-ad-variants.utils.spec.ts); this tests the key.
describe('redditDraftRestore: edited ad variants', () => {
  it.each<[string, unknown, unknown]>([
    ['no key (an older draft), so the seed stands', undefined, undefined],
    ['every variant was removed', [], []],
    ['the edits', [{ headline: 'One', body: 'b' }, { headline: 'Two' }], [{ headline: 'One', body: 'b' }, { headline: 'Two' }]],
  ])('restores %s', (_name, stored, expected) => {
    expect(redditDraftRestore(draft({ redditEditedVariants: stored } as RedditDraftSnapshot)).editedVariants).toEqual(expected);
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
      videoPost: { videoAssetId: '', videoBriefId: '', thumbnailAssetId: '', thumbnailBriefId: '' },
      conversionEvent: 'PURCHASE',
      customAudiences: { customAudienceIds: [], excludedCustomAudienceIds: [] },
      targetingExclusions: { excludedSubreddits: [], excludedGeoTargets: [] },
      subCountryGeoTargets: [],
      delivery: { budgetType: 'lifetime', placements: ['FEED', 'COMMENTS_PAGE'], platforms: ['DESKTOP', 'MOBILE_NATIVE', 'MOBILE_WEB'], expandTargeting: true },
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
