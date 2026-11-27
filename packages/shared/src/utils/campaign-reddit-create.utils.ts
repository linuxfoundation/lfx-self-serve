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

const BIDDING_FIELD = 'redditConfig.bidding';
const IMAGE_ASSET_FIELD = 'redditConfig.imageAssetId';
const CONVERSION_PIXEL_FIELD = 'redditConfig.conversionPixelId';

function configObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' ? raw : null;
}

/**
 * `bidding` while this deployment cannot honour it (#3299): neither creator that would serve it reads the key, so the
 * campaign would run on automatic bidding while the request asked for a manual bid. `in`, not a truthiness test: an
 * explicit `bidding: null` is still the field, and campaign-service would refuse it rather than read it as automatic.
 */
function redditBiddingRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = configObject(raw);
  if (enabled || !config || !('bidding' in config)) return null;
  return { field: BIDDING_FIELD, message: 'bidding options are not enabled on this deployment; omit bidding to use automatic bidding' };
}

/**
 * `imageAssetId` while this deployment cannot use an uploaded image: the legacy creator never reads it (the campaign
 * would have no ad), and campaign-service refuses it while URL signing is unconfigured. `in`, as for `bidding`. A video
 * post's asset ids are `redditVideoRefusal`'s, whose flag needs this same capability.
 */
function redditImageAssetRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = configObject(raw);
  if (enabled || !config || !('imageAssetId' in config)) return null;
  return { field: IMAGE_ASSET_FIELD, message: 'uploaded Reddit images are not enabled on this deployment; supply an image URL instead' };
}

/**
 * `conversionPixelId` (#3484): a value that is not text is refused on either arm, since campaign-service decodes it into a
 * Go `string` and could only fail there as an opaque decode error. Absent, `null` and blank all mean "use the
 * connection's pixel" upstream, which the legacy creator does anyway, so only a real pixel is refused, and only while
 * this deployment cannot send one.
 */
function redditConversionPixelRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = configObject(raw);
  if (!config || !('conversionPixelId' in config)) return null;
  const pixel: unknown = config.conversionPixelId;
  if (pixel === undefined || pixel === null) return null;
  if (typeof pixel !== 'string') return { field: CONVERSION_PIXEL_FIELD, message: 'the Reddit conversion pixel must be text' };
  if (enabled || pixel.trim() === '') return null;
  return {
    field: CONVERSION_PIXEL_FIELD,
    message: "a per-campaign Reddit conversion pixel is not supported on this deployment; leave it blank to use the connection's own pixel",
  };
}

/**
 * Why the create route refuses `redditConfig`, or `null` (#6108 rows 1-3 and 5-9, plus the older bidding, uploaded image
 * and per-campaign pixel checks): each feature refused, never dropped, while this deployment cannot send it, and held to
 * campaign-service's rules, in its PreflightCreate order (bidding, conversion event, custom audiences, exclusions,
 * sub-country geo, placements, gender/languages/dayparting, budget type, video, uploaded image, one ad per variant). The
 * pixel comes last: campaign-service does not pre-check it. The first refusal wins.
 *
 * Only for a create that selects `reddit-ads`: campaign-service pre-checks and dispatches only the selected platforms, so
 * a `redditConfig` beside other platforms is never read there, and a Reddit draft must never block another platform's
 * create here either.
 */
export function redditCreateConfigRefusal(platforms: readonly unknown[], raw: unknown, can: RedditCreateConfigCapabilities): RedditConfigRefusal | null {
  if (!platforms.includes('reddit-ads')) return null;
  return (
    redditBiddingRefusal(raw, can.bidding) ??
    redditConversionEventRefusal(raw, can.conversionEvent) ??
    redditCustomAudiencesRefusal(raw, can.customAudiences) ??
    redditTargetingExclusionsRefusal(raw, can.targetingExclusions) ??
    redditSubCountryGeoRefusal(raw, can.subCountryGeo) ??
    redditPlacementsRefusal(raw, can.placements) ??
    redditDemographicsRefusal(raw, can.demographics) ??
    redditBudgetTypeRefusal(raw, can.budgetType) ??
    redditVideoRefusal(raw, can.video, can.adPerVariant) ??
    redditImageAssetRefusal(raw, can.imageAsset) ??
    redditAdPerVariantRefusal(raw, can.adPerVariant) ??
    redditConversionPixelRefusal(raw, can.conversionPixel)
  );
}
