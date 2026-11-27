// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_META_AUDIENCE_TARGETING } from '../constants/campaign.constants';
import type {
  MetaDraftSnapshot,
  MetaAudienceTargetingDraft,
  MetaDeliveryDraft,
  MetaDeviceOsDraft,
  MetaDraftRestore,
  MetaDraftState,
  MetaImageDraftRestore,
  MetaImageDraftState,
  MetaObjective,
} from '../interfaces/campaign.interface';
import { compactMetaAdOptions, metaAdOptionsForObjective } from './campaign-meta-ad-options.utils';
import { metaAcceptedGeos } from './campaign-meta-form.utils';
import { copyMetaDeliveryDraft, metaDeliveryFromDraft } from './campaign-meta-delivery.utils';
import { copyMetaDetailedTargetingPicks, metaDetailedTargetingPicksFromDraft } from './campaign-meta-detailed-targeting.utils';
import { copyMetaDeviceOsDraft, metaDeviceOsFromDraft } from './campaign-meta-device-os.utils';
import { metaCarouselCardsFromStored, metaFormatFromStored } from './campaign-meta-carousel.utils';
import { metaLeadFormRestore } from './campaign-meta-lead-form.utils';

/**
 * The Meta part of the Implement tab draft (#5980, approach 4): what the draft carries, and what a restored
 * draft sets back. Pure, so the restore rules (present-only, own-foundation-only, objective order) are tested
 * here; the component sets its signals from the result and runs the image upload steps itself.
 */

/** A copy whose arrays are its own, so the parent's draft never holds a live view of the component's state. */
export function copyMetaAudienceTargeting(t: MetaAudienceTargetingDraft): MetaAudienceTargetingDraft {
  return { ...t, genders: [...t.genders], customAudiences: [...t.customAudiences], excludedCustomAudiences: [...t.excludedCustomAudiences] };
}

/**
 * The Meta fields a draft carries: values, never live views (placements, geos, targeting and ad options
 * are copied). Targeting, ad options and the lead form are stamped with the foundation they were made under.
 */
export function metaDraftFields(
  s: MetaDraftState
): Pick<
  MetaDraftSnapshot,
  | 'metaObjective'
  | 'metaPlacements'
  | 'metaPixelId'
  | 'metaGeoTargets'
  | 'metaInstagramUserId'
  | 'metaDsaBeneficiary'
  | 'metaDsaPayor'
  | 'metaAudienceTargeting'
  | 'metaAudienceTargetingProject'
  | 'metaDetailedTargeting'
  | 'metaAdSchedule'
  | 'metaFrequencyCap'
  | 'metaDevicePlatforms'
  | 'metaUserOs'
  | 'metaAdOptions'
  | 'metaAdOptionsProject'
  | 'metaLeadFormId'
  | 'metaLeadFormProject'
  | 'metaFormat'
  | 'metaCarouselCards'
  | 'metaCarouselMessage'
  | 'metaBudgetUsd'
  | 'metaLifetimeBudget'
> {
  return {
    metaObjective: s.objective,
    metaPlacements: { ...s.placements },
    metaPixelId: s.pixelId,
    metaGeoTargets: [...s.geoTargets],
    // As typed, whether or not the capability is on, so a draft survives the answer arriving late.
    metaInstagramUserId: s.instagramUserId,
    metaDsaBeneficiary: s.dsaBeneficiary,
    metaDsaPayor: s.dsaPayor,
    metaAudienceTargeting: copyMetaAudienceTargeting(s.audienceTargeting),
    metaAudienceTargetingProject: s.foundation,
    metaDetailedTargeting: copyMetaDetailedTargetingPicks(s.detailedTargeting),
    ...deliveryFields(s.delivery),
    ...deviceOsFields(s.deviceOs),
    metaAdOptions: { ...s.adOptions },
    metaAdOptionsProject: s.foundation,
    metaLeadFormId: s.leadFormId,
    metaLeadFormProject: s.foundation,
    // As edited, whether or not carousels are offered: the capability decides what is sent, not what is kept (#6331).
    metaFormat: s.format,
    metaCarouselCards: s.carouselCards.map((card) => ({ ...card })),
    metaCarouselMessage: s.carouselMessage,
    metaBudgetUsd: s.budgetUsd,
    metaLifetimeBudget: s.lifetimeBudget,
  };
}

/** The Meta image fields a draft carries. A failure's message is kept only while the failure is recorded for a brief. */
export function metaImageDraftFields(
  s: MetaImageDraftState
): Pick<
  MetaDraftSnapshot,
  | 'metaImageUrl'
  | 'metaImageAssetId'
  | 'metaImageAssetName'
  | 'metaImageAssetBriefId'
  | 'metaImageUploadPendingName'
  | 'metaImageUploadPendingBriefId'
  | 'metaImageUploadFailedMessage'
  | 'metaImageUploadFailedBriefId'
> {
  return {
    metaImageUrl: s.imageUrl,
    metaImageAssetId: s.assetId,
    metaImageAssetName: s.assetName,
    metaImageAssetBriefId: s.assetBriefId,
    metaImageUploadPendingName: s.uploadPendingName,
    metaImageUploadPendingBriefId: s.uploadPendingBriefId,
    metaImageUploadFailedMessage: s.uploadFailedBriefId ? s.uploadError : '',
    metaImageUploadFailedBriefId: s.uploadFailedBriefId,
  };
}

/** The Instagram id and DSA disclosures a draft carries, each only when present and a string. */
export function metaInstagramDsaPatch(draft: MetaDraftSnapshot): MetaDraftRestore['instagramDsaPatch'] {
  const fields = [
    ['metaInstagramUserId', 'instagramUserId'],
    ['metaDsaBeneficiary', 'dsaBeneficiary'],
    ['metaDsaPayor', 'dsaPayor'],
  ] as const;
  const patch: MetaDraftRestore['instagramDsaPatch'] = {};
  for (const [draftKey, control] of fields) {
    const value = draft[draftKey];
    if (typeof value === 'string') patch[control] = value;
  }
  return patch;
}

/** The draft fields that belong to one foundation: what a draft restored before the foundation is known must not lose. */
const META_FOUNDATION_SCOPED_DRAFT_KEYS = [
  'metaObjective',
  'metaAudienceTargeting',
  'metaAudienceTargetingProject',
  'metaAdOptions',
  'metaAdOptionsProject',
  'metaLeadFormId',
  'metaLeadFormProject',
] as const;

/**
 * The foundation-scoped fields of a draft still waiting for its foundation (#6107), laid over every draft the tab
 * emits meanwhile. The parent saves what the tab emits, so without them a tab closed before the foundation resolves
 * would save the form, audiences and ad choices as cleared. Only what the waiting draft carries; with their
 * original project stamps, so a reopen restores them under that foundation only.
 */
export function metaPendingDraftFields(pending: MetaDraftSnapshot): Partial<MetaDraftSnapshot> {
  return Object.fromEntries(META_FOUNDATION_SCOPED_DRAFT_KEYS.filter((key) => pending[key] !== undefined).map((key) => [key, pending[key]]));
}

/** The delivery options as the draft saves them: each `null` when unset. */
function deliveryFields(delivery: MetaDeliveryDraft): Pick<MetaDraftSnapshot, 'metaAdSchedule' | 'metaFrequencyCap'> {
  const copy = copyMetaDeliveryDraft(delivery);
  return { metaAdSchedule: copy.adSchedule, metaFrequencyCap: copy.frequencyCap };
}

/** The delivery options a draft restores, under any foundation, or nothing for a draft saved before row 5. */
function deliveryRestore(draft: MetaDraftSnapshot): Pick<MetaDraftRestore, 'delivery'> {
  const delivery = metaDeliveryFromDraft(draft.metaAdSchedule, draft.metaFrequencyCap);
  return delivery === undefined ? {} : { delivery };
}

/** The devices and operating systems as the draft saves them: each list as ticked, empty when none. */
function deviceOsFields(deviceOs: MetaDeviceOsDraft): Pick<MetaDraftSnapshot, 'metaDevicePlatforms' | 'metaUserOs'> {
  const copy = copyMetaDeviceOsDraft(deviceOs);
  return { metaDevicePlatforms: copy.devicePlatforms, metaUserOs: copy.userOs };
}

/** The devices and operating systems a draft restores, under any foundation, or nothing for a draft saved before row 6. */
function deviceOsRestore(draft: MetaDraftSnapshot): Pick<MetaDraftRestore, 'deviceOs'> {
  const deviceOs = metaDeviceOsFromDraft(draft.metaDevicePlatforms, draft.metaUserOs);
  return deviceOs === undefined ? {} : { deviceOs };
}

/** The ad format, cards and message a draft restores (#6331), each present-only; an unknown format restores none. */
function carouselRestore(draft: MetaDraftSnapshot): Pick<MetaDraftRestore, 'format' | 'carouselCards' | 'carouselMessage'> {
  const format = metaFormatFromStored(draft.metaFormat);
  const cards = metaCarouselCardsFromStored(draft.metaCarouselCards);
  return {
    ...(format === undefined ? {} : { format }),
    ...(cards === undefined ? {} : { carouselCards: cards }),
    ...(typeof draft.metaCarouselMessage === 'string' ? { carouselMessage: draft.metaCarouselMessage } : {}),
  };
}

/** The detailed targeting a draft restores, under any foundation (Meta's taxonomy is global), or nothing for a draft without it. */
function detailedTargetingRestore(raw: unknown): Pick<MetaDraftRestore, 'detailedTargeting'> {
  const picks = metaDetailedTargetingPicksFromDraft(raw);
  return picks === undefined ? {} : { detailedTargeting: picks };
}

/**
 * What a restored draft sets on the Meta form. Each field only when the draft carries it: a draft saved
 * before a field shipped leaves the seeded value standing (`?? 'traffic'` would silently downgrade a
 * Conversions campaign; a present-but-empty pixel id is a real cleared value). Targeting, ad options and the
 * lead form only under the foundation they were made under, so another foundation's choices never ride
 * along. Ad options keep only what the restored objective takes; the lead form rule runs last, on that
 * objective, and drops `leads` without a form for this foundation.
 */
export function metaDraftRestore(draft: MetaDraftSnapshot, currentObjective: MetaObjective, activeFoundation: string): MetaDraftRestore {
  const objective = draft.metaObjective ?? currentObjective;
  const leadForm = metaLeadFormRestore({ objective, leadFormId: draft.metaLeadFormId, project: draft.metaLeadFormProject }, activeFoundation);
  return {
    objective: leadForm.objective,
    ...(draft.metaPlacements !== undefined ? { placements: { ...draft.metaPlacements } } : {}),
    ...(draft.metaPixelId !== undefined ? { pixelId: draft.metaPixelId } : {}),
    instagramDsaPatch: metaInstagramDsaPatch(draft),
    ...(draft.metaAudienceTargeting !== undefined && draft.metaAudienceTargetingProject === activeFoundation
      ? { audienceTargeting: copyMetaAudienceTargeting({ ...DEFAULT_META_AUDIENCE_TARGETING, ...draft.metaAudienceTargeting }) }
      : {}),
    ...detailedTargetingRestore(draft.metaDetailedTargeting),
    ...deliveryRestore(draft),
    ...deviceOsRestore(draft),
    ...(draft.metaAdOptions !== undefined && draft.metaAdOptionsProject === activeFoundation
      ? { adOptions: metaAdOptionsForObjective(compactMetaAdOptions(draft.metaAdOptions), objective) }
      : {}),
    leadFormId: leadForm.leadFormId,
    ...carouselRestore(draft),
    ...(draft.metaGeoTargets !== undefined ? { geoTargets: metaAcceptedGeos(draft.metaGeoTargets) } : {}),
    ...(draft.metaBudgetUsd !== undefined ? { budgetUsd: draft.metaBudgetUsd } : {}),
    ...(draft.metaLifetimeBudget !== undefined ? { lifetimeBudget: draft.metaLifetimeBudget } : {}),
  };
}

/**
 * What a restored draft does to the Meta image: the pasted URL and the uploaded asset each only when present,
 * a recorded failure only with both its message and its brief, and a recorded in-flight upload to resume.
 */
export function metaImageDraftRestore(draft: MetaDraftSnapshot): MetaImageDraftRestore {
  return {
    ...(draft.metaImageUrl !== undefined ? { imageUrl: draft.metaImageUrl } : {}),
    ...(draft.metaImageAssetId !== undefined
      ? { asset: { id: draft.metaImageAssetId, name: draft.metaImageAssetName ?? '', briefId: draft.metaImageAssetBriefId ?? '' } }
      : {}),
    ...(draft.metaImageUploadFailedMessage && draft.metaImageUploadFailedBriefId
      ? { failedUpload: { message: draft.metaImageUploadFailedMessage, briefId: draft.metaImageUploadFailedBriefId } }
      : {}),
    ...(draft.metaImageUploadPendingName
      ? { pendingUpload: { name: draft.metaImageUploadPendingName, briefId: draft.metaImageUploadPendingBriefId ?? '' } }
      : {}),
  };
}
