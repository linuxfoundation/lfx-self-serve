// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_REDDIT_BUDGET_USD, DEFAULT_REDDIT_CONVERSION_EVENT, DEFAULT_REDDIT_OBJECTIVE } from '../constants/campaign.constants';
import type {
  CampaignBriefOutput,
  RedditAdVariant,
  RedditBriefReset,
  RedditBriefSeed,
  RedditDraftRestore,
  RedditDraftSnapshot,
  RedditDraftState,
} from '../interfaces/campaign.interface';
import { redditConversionEventFromDraft } from './campaign-reddit-conversion-event.utils';
import { redditCustomAudienceIdsFromDraft } from './campaign-reddit-custom-audiences.utils';

/**
 * The Implement tab's Reddit draft rules (#5980): what the draft carries, what a restore sets, what a brief switch resets
 * and what a brief seeds. The component reads its signals and the pixel form, and runs the writes and upload steps these return.
 */

/**
 * The Reddit draft fields: every typed value as held, whatever the capabilities say (a capability decides what is sent,
 * not what the draft remembers), and the upload slot. A failure is carried only with the brief it failed for, so it
 * stays, and keeps holding Create, across a tab switch.
 */
export function redditDraftFields(state: RedditDraftState): RedditDraftSnapshot {
  return {
    redditBudgetUsd: state.budgetUsd,
    redditObjective: state.objective,
    redditPostUrl: state.postUrl,
    redditImageUrl: state.imageUrl,
    redditCallToAction: state.callToAction,
    redditConversionPixelId: state.conversionPixelId,
    redditImageAssetId: state.assetId,
    redditImageAssetName: state.assetName,
    redditImageAssetBriefId: state.assetBriefId,
    redditImageUploadPendingName: state.uploadPendingName,
    redditImageUploadPendingBriefId: state.uploadPendingBriefId,
    redditImageUploadFailedMessage: state.uploadFailedBriefId ? state.uploadError : '',
    redditImageUploadFailedBriefId: state.uploadFailedBriefId,
    redditVideoGoal: state.videoGoal,
    redditConversionEvent: state.conversionEvent,
    redditCustomAudienceIds: [...state.customAudiences.customAudienceIds],
    redditExcludedCustomAudienceIds: [...state.customAudiences.excludedCustomAudienceIds],
  };
}

/**
 * What restoring `draft` does to the Reddit section. Present-only (`!== undefined`): a field an older draft omits leaves
 * the brief's seed or the default standing, while an empty string is a deliberate clear and is restored. An objective the
 * picker no longer offers is restored too, so it stays visible and on the wire. The pixel only when it is a string. The
 * uploaded image whole, keyed on its id. A failed upload only with the brief it failed for; a running one is resumed.
 * The conversion event only when it is one Reddit takes; any other leaves the default standing. The custom audience lists
 * when either is an array, keeping only its strings (a list the create would refuse stays visible, and holds Create).
 */
export function redditDraftRestore(draft: RedditDraftSnapshot): RedditDraftRestore {
  const restore: RedditDraftRestore = {};
  if (draft.redditBudgetUsd !== undefined) restore.budgetUsd = draft.redditBudgetUsd;
  if (draft.redditObjective !== undefined) restore.objective = draft.redditObjective;
  if (draft.redditPostUrl !== undefined) restore.postUrl = draft.redditPostUrl;
  if (draft.redditImageUrl !== undefined) restore.imageUrl = draft.redditImageUrl;
  if (draft.redditCallToAction !== undefined) restore.callToAction = draft.redditCallToAction;
  if (typeof draft.redditConversionPixelId === 'string') restore.conversionPixelId = draft.redditConversionPixelId;
  if (draft.redditImageAssetId !== undefined) {
    restore.asset = { id: draft.redditImageAssetId, name: draft.redditImageAssetName ?? '', briefId: draft.redditImageAssetBriefId ?? '' };
  }
  if (draft.redditImageUploadFailedMessage && draft.redditImageUploadFailedBriefId) {
    restore.failedUpload = { message: draft.redditImageUploadFailedMessage, briefId: draft.redditImageUploadFailedBriefId };
  }
  if (draft.redditImageUploadPendingName) {
    restore.pendingUpload = { name: draft.redditImageUploadPendingName, briefId: draft.redditImageUploadPendingBriefId ?? '' };
  }
  if (draft.redditVideoGoal !== undefined) restore.videoGoal = draft.redditVideoGoal;
  const conversionEvent = redditConversionEventFromDraft(draft.redditConversionEvent);
  if (conversionEvent !== undefined) restore.conversionEvent = conversionEvent;
  const customAudienceIds = redditCustomAudienceIdsFromDraft(draft.redditCustomAudienceIds);
  const excludedCustomAudienceIds = redditCustomAudienceIdsFromDraft(draft.redditExcludedCustomAudienceIds);
  if (customAudienceIds !== undefined || excludedCustomAudienceIds !== undefined) {
    restore.customAudiences = { customAudienceIds: customAudienceIds ?? [], excludedCustomAudienceIds: excludedCustomAudienceIds ?? [] };
  }
  return restore;
}

/**
 * What a brief switch resets the Reddit section to (#4589, #4648): each value the brief does not derive back to its
 * default, and the lists seeded only from Reddit copy emptied, so a brief without any opens on none. The pixel form and
 * the uploaded image are not here: the form is reset in place, and the image is scoped to its brief.
 */
export function redditBriefReset(): RedditBriefReset {
  return {
    postUrl: '',
    imageUrl: '',
    callToAction: '',
    objective: DEFAULT_REDDIT_OBJECTIVE,
    videoGoal: '',
    conversionEvent: DEFAULT_REDDIT_CONVERSION_EVENT,
    customAudiences: { customAudienceIds: [], excludedCustomAudienceIds: [] },
    budgetUsd: DEFAULT_REDDIT_BUDGET_USD,
    variants: [],
    subreddits: [],
    interests: [],
    keywords: [],
    geoTargets: [],
  };
}

/**
 * What a brief's Reddit copy seeds, or `null` when it has none (the reset lists then stand). The typed `redditCopy` wins
 * over the legacy `structuredCopy.reddit_promoted` block, whose missing lists seed empty.
 */
export function redditBriefSeed(brief: Pick<CampaignBriefOutput, 'structuredCopy' | 'redditCopy'>): RedditBriefSeed | null {
  if (brief.redditCopy) {
    return {
      variants: brief.redditCopy.variants,
      subreddits: brief.redditCopy.recommendedSubreddits,
      interests: brief.redditCopy.recommendedInterests,
      keywords: brief.redditCopy.recommendedKeywords,
      geoTargets: brief.redditCopy.recommendedGeos,
    };
  }
  const legacy = brief.structuredCopy?.['reddit_promoted'] as Record<string, unknown> | undefined;
  if (!legacy) return null;
  return {
    variants: (legacy['variants'] as RedditAdVariant[]) ?? [],
    subreddits: (legacy['recommended_subreddits'] as string[]) ?? [],
    interests: (legacy['recommended_interests'] as string[]) ?? [],
    keywords: (legacy['recommended_keywords'] as string[]) ?? [],
    geoTargets: (legacy['recommended_geos'] as string[]) ?? [],
  };
}
