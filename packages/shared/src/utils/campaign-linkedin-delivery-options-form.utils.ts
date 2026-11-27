// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LinkedInCampaignCreateRequest, LinkedInDeliveryOptionsDraft } from '../interfaces/campaign.interface';

/**
 * The Implement tab's LinkedIn delivery options (linuxfoundation/lfx-v2-campaign-service#667): Audience Expansion and the
 * LinkedIn Audience Network. What the create sends, when the toggles show, when Create waits, and what a stored draft
 * restores. The create route's own checks are `linkedInDeliveryOptionsRefusal`; the tab never sends what it refuses.
 */

/** Both toggles off: the create sends neither field, as every create did before. */
export function emptyLinkedInDeliveryOptionsDraft(): LinkedInDeliveryOptionsDraft {
  return { audienceExpansion: false, audienceNetwork: false };
}

/**
 * Whether a toggle that is on waits on the capability: `linkedInDeliveryOptionsEnabled` is not read yet (`null`: loading,
 * a tab round-trip, or a failed read). Create is held rather than sending the campaign without the choice, as a typed
 * target cost is held, and the toggles stay shown so they can be turned off.
 */
export function linkedInDeliveryOptionsPending(draft: LinkedInDeliveryOptionsDraft, enabled: boolean | null): boolean {
  return enabled === null && (draft.audienceExpansion || draft.audienceNetwork);
}

/** Whether the toggles show: on an explicit yes, and while a toggle that is on waits on the capability. */
export function linkedInDeliveryOptionsShown(draft: LinkedInDeliveryOptionsDraft, enabled: boolean | null): boolean {
  return enabled === true || linkedInDeliveryOptionsPending(draft, enabled);
}

/**
 * Whether the Audience Network can go with this create: not with Text Ads (it serves Sponsored Content only) and not with
 * the lead generation objective (LinkedIn serves no lead gen there). Otherwise the toggle is shown disabled and not sent.
 */
export function linkedInAudienceNetworkOffered(textAds: boolean, leadGen: boolean): boolean {
  return !textAds && !leadGen;
}

/**
 * The delivery option fields of the LinkedIn create: a toggle that is on, only on an explicit yes, and the Audience Network
 * only while `networkOffered`. A toggle that is off sends nothing, so a create sends what it always did unless the
 * operator opts in. A toggle kept on while hidden (the capability off) is never sent.
 */
export function linkedInDeliveryOptionsForCreate(
  draft: LinkedInDeliveryOptionsDraft,
  enabled: boolean | null,
  networkOffered: boolean
): Pick<LinkedInCampaignCreateRequest, 'audienceExpansionEnabled' | 'offsiteDeliveryEnabled'> {
  if (enabled !== true) return {};
  return {
    ...(draft.audienceExpansion ? { audienceExpansionEnabled: true } : {}),
    ...(draft.audienceNetwork && networkOffered ? { offsiteDeliveryEnabled: true } : {}),
  };
}

/** Why the delivery options hold Create, as the create button says it, or `null`: only while a toggle that is on waits on the capability. */
export function linkedInDeliveryOptionsCreateRefusal(draft: LinkedInDeliveryOptionsDraft, enabled: boolean | null): string | null {
  if (!linkedInDeliveryOptionsPending(draft, enabled)) return null;
  return "LinkedIn Ads: Audience Expansion and the Audience Network can't be confirmed yet. Wait for the campaign settings to load, or turn them off.";
}

/** The delivery options of a stored draft, or `null` when it holds none. Each toggle only as a boolean; anything else reads as off. */
export function linkedInDeliveryOptionsDraftFromStored(raw: unknown): LinkedInDeliveryOptionsDraft | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return { audienceExpansion: record['audienceExpansion'] === true, audienceNetwork: record['audienceNetwork'] === true };
}
