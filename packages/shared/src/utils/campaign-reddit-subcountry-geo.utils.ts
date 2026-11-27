// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ASSIGNED_COUNTRY_CODES,
  REDDIT_MAX_SUBCOUNTRY_GEO_TARGETS,
  REDDIT_SUBCOUNTRY_CITY_PATTERN,
  REDDIT_SUBCOUNTRY_DMA_PATTERN,
  REDDIT_SUBCOUNTRY_GEO_FIELD,
  REDDIT_SUBCOUNTRY_REGION_PATTERN,
} from '../constants/campaign.constants';
import type { RedditConfigRefusal } from '../interfaces/campaign.interface';
import { googleAdsToUpperCode } from './campaign-google-assets.utils';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';
import { redditDecodedConfigValue } from './campaign-reddit-targeting-exclusions.utils';

/**
 * Reddit regions, cities and DMAs on create (#6108 row 7): `redditConfig.subCountryGeoTargets`. Held to
 * campaign-service's `checkRedditSubCountryGeoShape` / `checkRedditSubCountryGeo` (`internal/dispatch/reddit_subcountry_geo.go`)
 * and `NormalizeSubCountryGeoTargets` (`internal/platform/reddit/subcountry_geo.go`, #549), so a create campaign-service
 * would refuse from the config alone is refused here first, with the field to point at. Whether Reddit can target an id
 * is campaign-service's own read (`ValidateSubCountryGeoTargets`), so its 400 for that passes through. Messages name
 * entries by position and never echo a caller value.
 */

const SUBCOUNTRY_GEO_KEY = 'subCountryGeoTargets';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A list as campaign-service decodes it: absent and `null` are empty, anything but an array of strings is `null`. */
function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

/** campaign-service's `upperSet`: the trimmed, upper-cased (as Go does), non-blank entries of the decoded list at `key`. */
function upperSet(config: Record<string, unknown>, key: string): Set<string> {
  const list = stringList(redditDecodedConfigValue(config, key)) ?? [];
  return new Set(list.map((entry) => googleAdsToUpperCode(goTrimSpace(entry))).filter((entry) => entry !== ''));
}

/**
 * campaign-service's `subCountryCountry`: the country a trimmed, upper-cased id lies in, or `null` when it is not a
 * region, city or DMA id. Every DMA is in the US.
 */
function subCountryCountry(id: string): string | null {
  const region = REDDIT_SUBCOUNTRY_REGION_PATTERN.exec(id) ?? REDDIT_SUBCOUNTRY_CITY_PATTERN.exec(id);
  if (region) return region[1];
  return REDDIT_SUBCOUNTRY_DMA_PATTERN.test(id) ? 'US' : null;
}

/**
 * Why `raw`'s sub-country locations cannot be sent, or `null` (#6108 row 7). Typed runtime checks, since the create
 * route forwards `redditConfig` as it comes. In campaign-service's order:
 *
 * - a case variant of the key, whatever the flag, since it would reach campaign-service past the checks here;
 * - a list that is not an array of strings (`null` is absent, as campaign-service reads it);
 * - a non-empty list while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy creator
 *   ignores it and campaign-service refuses it while `REDDIT_SUBCOUNTRY_GEO_ENABLED` is off. Any non-empty list counts,
 *   whatever its entries;
 * - more than 50 entries, counted before duplicates are dropped;
 * - per entry, trimmed and upper-cased as Go does: a blank entry; a bare country (that belongs in `geoTargets`); an id
 *   that is not a region (`US-CA`), city (`CA:6167865`) or DMA (`662`) in an assigned ISO 3166-1 alpha-2 country; an id
 *   inside a country `geoTargets` targets (send the country or the locations inside it, not both; the US default does
 *   not apply once this list is set); an id inside a country `excludedGeoTargets` excludes.
 *
 * A repeated id is not refused: campaign-service drops it, and a repeat passes every rule its first entry passed, so no
 * duplicate tracking is needed here.
 */
export function redditSubCountryGeoRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const field = REDDIT_SUBCOUNTRY_GEO_FIELD;
  if (Object.keys(config).some((key) => key !== SUBCOUNTRY_GEO_KEY && foldKey(key) === foldKey(SUBCOUNTRY_GEO_KEY))) {
    return { field, message: `Send it as "${SUBCOUNTRY_GEO_KEY}", spelled exactly.` };
  }
  const list = stringList(config[SUBCOUNTRY_GEO_KEY]);
  if (list === null) return { field, message: 'Send it as a list of text entries.' };
  if (list.length === 0) return null;
  if (!enabled) return { field, message: 'Reddit regions, cities and DMAs are not enabled on this deployment. Remove them and create again.' };
  if (list.length > REDDIT_MAX_SUBCOUNTRY_GEO_TARGETS)
    return { field, message: `Target at most ${REDDIT_MAX_SUBCOUNTRY_GEO_TARGETS} regions, cities and DMAs.` };
  const targeted = upperSet(config, 'geoTargets');
  const excluded = upperSet(config, 'excludedGeoTargets');
  for (const [i, raw] of list.entries()) {
    const id = googleAdsToUpperCode(goTrimSpace(raw));
    if (id === '') return { field, message: `Location ${i + 1} is blank.` };
    if (/^[A-Z]{2}$/.test(id)) return { field, message: `Location ${i + 1} is a whole country. Put it in the geo targets instead.` };
    const country = subCountryCountry(id);
    if (country === null || !ASSIGNED_COUNTRY_CODES.has(country)) {
      return { field, message: `Location ${i + 1} is not a Reddit region (US-CA), city (CA:6167865) or DMA (662) geolocation id.` };
    }
    if (targeted.has(country)) {
      return {
        field,
        message: `Location ${i + 1} is inside a country the geo targets already target as a whole. Send the country or the locations inside it, not both.`,
      };
    }
    if (excluded.has(country)) {
      return { field, message: `Location ${i + 1} is inside an excluded country. A location cannot be targeted inside an excluded country.` };
    }
  }
  return null;
}
