// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignImplementationDraft,
  LinkedInBriefCopy,
  LinkedInBriefSeed,
  LinkedInCreativeVariant,
  LinkedInDraftRestore,
  LinkedInDraftSnapshot,
  LinkedInDraftState,
  LinkedInVariantDraft,
} from '../interfaces/campaign.interface';

/**
 * The Implement tab's LinkedIn draft rules (#5980): what the draft carries, what a restore sets, and what a brief seeds.
 * The component reads its signals and the form, and runs the writes and upload steps these return.
 */

/** A LinkedIn variant for the editor from a brief's copy, keyed by `key`, with no upload. */
export function newLinkedInVariantDraft(copy: LinkedInCreativeVariant, key: string): LinkedInVariantDraft {
  return {
    key,
    introText: copy.introText,
    headline: copy.headline,
    ...(copy.imageUrn ? { imageUrn: copy.imageUrn } : {}),
    imageAssetId: '',
    imageAssetName: '',
    imageAssetBriefId: '',
  };
}

/**
 * The LinkedIn draft fields: the budget pair and cap as held, each variant copied so the draft never shares the editor's
 * objects, and the upload slot. A failure is carried only with the brief it failed for, as for the Meta image.
 */
export function linkedInDraftFields(
  state: LinkedInDraftState
): Pick<
  CampaignImplementationDraft,
  | 'linkedInBudgetUsd'
  | 'linkedInLifetimeBudget'
  | 'linkedInDailyCapUsd'
  | 'linkedInVariants'
  | 'linkedInImageUploadVariantKey'
  | 'linkedInImageUploadPendingName'
  | 'linkedInImageUploadPendingBriefId'
  | 'linkedInImageUploadFailedMessage'
  | 'linkedInImageUploadFailedBriefId'
  | 'linkedInFormat'
  | 'linkedInTextAds'
> {
  return {
    linkedInBudgetUsd: state.budgetUsd,
    linkedInLifetimeBudget: state.lifetimeBudget,
    linkedInDailyCapUsd: state.dailyCapUsd,
    linkedInVariants: state.variants.map((variant) => ({ ...variant })),
    linkedInImageUploadVariantKey: state.uploadVariantKey,
    linkedInImageUploadPendingName: state.uploadPendingName,
    linkedInImageUploadPendingBriefId: state.uploadPendingBriefId,
    linkedInImageUploadFailedMessage: state.uploadFailedBriefId ? state.uploadError : '',
    linkedInImageUploadFailedBriefId: state.uploadFailedBriefId,
    linkedInFormat: state.format,
    linkedInTextAds: state.textAds.map((ad) => ({ ...ad })),
  };
}

/**
 * What restoring `draft` does to the LinkedIn section. Present-only: an absent budget, lifetime flag, cap or variant list
 * leaves the brief's seed standing, so a draft written by an older build replays nothing stale. An unparsable cap (NaN)
 * restores as no cap, since the remounted box starts empty. A failed upload is shown only with the brief it failed for.
 */
export function linkedInDraftRestore(draft: LinkedInDraftSnapshot): LinkedInDraftRestore {
  const restore: LinkedInDraftRestore = {
    targetingRemovals: draft.linkedInTargetingRemovals ?? { skills: [], groups: [] },
    uploadVariantKey: draft.linkedInImageUploadVariantKey ?? '',
  };
  if (draft.linkedInBudgetUsd !== undefined) restore.budgetUsd = draft.linkedInBudgetUsd;
  if (draft.linkedInLifetimeBudget !== undefined) restore.lifetimeBudget = draft.linkedInLifetimeBudget;
  if (draft.linkedInDailyCapUsd !== undefined) {
    const cap = draft.linkedInDailyCapUsd;
    restore.dailyCapUsd = cap !== null && Number.isNaN(cap) ? null : cap;
  }
  if (Array.isArray(draft.linkedInVariants)) restore.variants = draft.linkedInVariants.map((variant) => ({ ...variant }));
  if (draft.linkedInImageUploadFailedMessage && draft.linkedInImageUploadFailedBriefId) {
    restore.failedUpload = { message: draft.linkedInImageUploadFailedMessage, briefId: draft.linkedInImageUploadFailedBriefId };
  }
  // Text Ads (#5764 row 19): present-only, so an older draft keeps the single-image default. An unknown format restores nothing.
  if (draft.linkedInFormat === 'single_image' || draft.linkedInFormat === 'text') restore.format = draft.linkedInFormat;
  // Only entries whose fields are all text: a draft is replayed from stored JSON whose inner shape is not validated.
  if (Array.isArray(draft.linkedInTextAds)) {
    restore.textAds = draft.linkedInTextAds
      .filter((ad) => typeof ad?.key === 'string' && typeof ad.headline === 'string' && typeof ad.description === 'string')
      .map(({ key, headline, description, imageAssetId, imageAssetName, imageAssetBriefId }) =>
        // The image (#5764 row 19) only whole: an id with the brief it was made for, each a string.
        typeof imageAssetId === 'string' && imageAssetId !== '' && typeof imageAssetBriefId === 'string'
          ? { key, headline, description, imageAssetId, imageAssetName: typeof imageAssetName === 'string' ? imageAssetName : '', imageAssetBriefId }
          : { key, headline, description }
      );
  }
  if (draft.linkedInImageUploadPendingName) {
    restore.pendingUpload = { name: draft.linkedInImageUploadPendingName, briefId: draft.linkedInImageUploadPendingBriefId ?? '' };
  }
  return restore;
}

/**
 * What a brief's LinkedIn copy seeds, or `null` when it has none (the reset values then stand). `nextKey` names each
 * variant. The lifetime budget comes from the strategy only when it is a finite number: a restored brief is replayed from
 * stored JSON whose inner shape is not validated.
 */
export function linkedInBriefSeed(copy: LinkedInBriefCopy | undefined, nextKey: () => string): LinkedInBriefSeed | null {
  if (!copy) return null;
  const seed: LinkedInBriefSeed = {
    variants: copy.variants.map((variant) => newLinkedInVariantDraft(variant, nextKey())),
    geoTargets: copy.recommendedGeoTargets,
    targetingProfile: copy.recommendedTargetingProfile,
  };
  const lifetimeBudget = copy.strategy?.budgetRecommendation?.lifetimeBudgetUsd;
  if (typeof lifetimeBudget === 'number' && Number.isFinite(lifetimeBudget)) seed.lifetimeBudgetUsd = lifetimeBudget;
  return seed;
}
