// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { RedditConfigRefusal, RedditCreateConfigCapabilities } from '../interfaces/campaign.interface';
import { redditAdPerVariantRefusal } from './campaign-reddit-ad-variants.utils';
import { redditConversionEventRefusal } from './campaign-reddit-conversion-event.utils';
import { redditCustomAudiencesRefusal } from './campaign-reddit-custom-audiences.utils';
import { redditBudgetTypeRefusal, redditPlacementsRefusal } from './campaign-reddit-delivery.utils';
import { redditDemographicsRefusal } from './campaign-reddit-demographics.utils';
import { redditSubCountryGeoRefusal } from './campaign-reddit-subcountry-geo.utils';
import { redditTargetingExclusionsRefusal } from './campaign-reddit-targeting-exclusions.utils';
import { redditVideoRefusal } from './campaign-reddit-video.utils';

/**
 * Why the create route refuses `redditConfig`, or `null` (#6108 rows 1-3 and 5-9): each feature refused, never dropped,
 * while this deployment cannot send it, and held to campaign-service's rules, in its PreflightCreate order (conversion
 * event, custom audiences, exclusions, sub-country geo, placements, gender/languages/dayparting, budget type, video,
 * one ad per variant). The first refusal wins.
 *
 * Only for a create that selects `reddit-ads`: campaign-service pre-checks only the selected platforms, so a
 * `redditConfig` beside other platforms is never judged there, and a Reddit draft must never block another platform's
 * create here either.
 */
export function redditCreateConfigRefusal(platforms: readonly unknown[], raw: unknown, can: RedditCreateConfigCapabilities): RedditConfigRefusal | null {
  if (!platforms.includes('reddit-ads')) return null;
  return (
    redditConversionEventRefusal(raw, can.conversionEvent) ??
    redditCustomAudiencesRefusal(raw, can.customAudiences) ??
    redditTargetingExclusionsRefusal(raw, can.targetingExclusions) ??
    redditSubCountryGeoRefusal(raw, can.subCountryGeo) ??
    redditPlacementsRefusal(raw, can.placements) ??
    redditDemographicsRefusal(raw, can.demographics) ??
    redditBudgetTypeRefusal(raw, can.budgetType) ??
    redditVideoRefusal(raw, can.video, can.adPerVariant) ??
    redditAdPerVariantRefusal(raw, can.adPerVariant)
  );
}
