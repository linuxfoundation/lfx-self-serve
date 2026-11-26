// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ASSIGNED_COUNTRY_CODES,
  REDDIT_SUBREDDIT_NAME_PATTERN,
  REDDIT_TARGETING_EXCLUSION_KEYS,
  REDDIT_TARGETING_EXCLUSION_LIMITS,
} from '../constants/campaign.constants';
import type { RedditConfigRefusal, RedditTargetingExclusionKey } from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * Reddit targeting exclusions (#6108 row 3), mirroring campaign-service's `checkRedditExclusionsShape` and
 * `checkRedditTargetingExclusions` (`internal/dispatch/reddit_targeting_exclusions.go`) and `NormalizeTargetingExclusions`
 * (`internal/platform/reddit/targeting_exclusions.go`, #549), so a create campaign-service would refuse is refused here
 * first, with the field to point at. `ASSIGNED_COUNTRY_CODES` holds the same 249 codes as campaign-service's
 * `iso3166Alpha2`.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The value campaign-service decodes for `key`. Its create path re-marshals the config (`marshalAny` in
 * `internal/service/brief.go`), so the keys reach the decoder sorted by byte order. Go's `encoding/json` then assigns
 * every key equal to `key` ignoring case (Unicode folds included: `foldKey`), exact spelling or not, in that order, so
 * the last such key in byte order wins. The keys the exclusions are compared against (`subreddits`, `geoTargets`,
 * `subCountryGeoTargets`) are read this way, so a case variant of one cannot make the comparison differ from
 * campaign-service's. JavaScript's `<` compares UTF-16 code units, which orders BMP keys as their UTF-8 bytes do, and
 * every fold variant of these ASCII names (`ſ`, the Kelvin sign) is in the BMP.
 */
function decodedValue(config: Record<string, unknown>, key: string): unknown {
  let last: string | undefined;
  for (const k of Object.keys(config)) {
    if (foldKey(k) === foldKey(key) && (last === undefined || k > last)) last = k;
  }
  return last === undefined ? undefined : config[last];
}

function fieldOf(key: RedditTargetingExclusionKey): string {
  return `redditConfig.${key}`;
}

/** A list as campaign-service decodes it: absent and `null` are empty, anything but an array of strings is refused. */
function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

/**
 * A subreddit name as campaign-service reads it: trimmed, an `r/` or `R/` prefix removed (`stripSubredditPrefix`), then
 * trimmed again. `/r/` is not a prefix there, so it is not here either.
 */
function subredditName(raw: string): string {
  const trimmed = goTrimSpace(raw);
  return goTrimSpace(/^[rR]\//.test(trimmed) ? trimmed.slice(2) : trimmed);
}

/**
 * The country codes the create would target, campaign-service's `effectiveGeoSet`: the trimmed, upper-cased non-blank
 * `geoTargets`, or `US` when there are none and no sub-country locations replace the default.
 */
function effectiveGeoSet(config: Record<string, unknown>): Set<string> {
  const targeted = new Set((stringList(decodedValue(config, 'geoTargets')) ?? []).map((g) => goTrimSpace(g).toUpperCase()).filter((g) => g !== ''));
  const subCountry = stringList(decodedValue(config, 'subCountryGeoTargets')) ?? [];
  if (targeted.size === 0 && subCountry.length === 0) targeted.add('US');
  return targeted;
}

function subredditRefusal(excluded: string[], config: Record<string, unknown>): RedditConfigRefusal | null {
  const field = fieldOf('excludedSubreddits');
  const max = REDDIT_TARGETING_EXCLUSION_LIMITS.excludedSubreddits;
  if (excluded.length > max) return { field, message: `Exclude at most ${max} subreddits.` };
  const targeted = new Set(
    (stringList(decodedValue(config, 'subreddits')) ?? [])
      .map(subredditName)
      .filter((name) => name !== '')
      .map((name) => name.toLowerCase())
  );
  for (const [i, raw] of excluded.entries()) {
    const name = subredditName(raw);
    if (name === '') return { field, message: `Excluded subreddit ${i + 1} is blank.` };
    if (!REDDIT_SUBREDDIT_NAME_PATTERN.test(name)) {
      return { field, message: `Excluded subreddit ${i + 1} is not a subreddit name: 2 to 21 letters, digits or underscores, optionally after r/.` };
    }
    if (targeted.has(name.toLowerCase())) {
      return { field, message: `Excluded subreddit ${i + 1} is also targeted. A community cannot be both targeted and excluded.` };
    }
  }
  return null;
}

function geoRefusal(excluded: string[], config: Record<string, unknown>): RedditConfigRefusal | null {
  const field = fieldOf('excludedGeoTargets');
  const max = REDDIT_TARGETING_EXCLUSION_LIMITS.excludedGeoTargets;
  if (excluded.length > max) return { field, message: `Exclude at most ${max} countries.` };
  if (excluded.length === 0) return null;
  const targeted = effectiveGeoSet(config);
  for (const [i, raw] of excluded.entries()) {
    const code = goTrimSpace(raw).toUpperCase();
    if (code === '') return { field, message: `Excluded country ${i + 1} is blank.` };
    if (!/^[A-Z]{2}$/.test(code) || !ASSIGNED_COUNTRY_CODES.has(code)) {
      return { field, message: `Excluded country ${i + 1} is not an ISO 3166-1 alpha-2 country code.` };
    }
    if (targeted.has(code)) {
      return {
        field,
        message: `Excluded country ${i + 1} is also targeted (the geo targets, or the US default when there are none). A country cannot be both targeted and excluded.`,
      };
    }
  }
  return null;
}

/**
 * Why `raw`'s targeting exclusions cannot be sent, or `null` (#6108 row 3). Typed runtime checks, since the create route
 * forwards `redditConfig` as it comes. In campaign-service's order:
 *
 * - a case variant of either key (campaign-service decodes keys ignoring case, Unicode folds included: `foldKey`),
 *   whatever the flag;
 * - a list that is not an array of strings (`null` is absent, as campaign-service reads it);
 * - either list non-empty while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy
 *   creator ignores it and campaign-service refuses it while `REDDIT_TARGETING_EXCLUSIONS_ENABLED` is off;
 * - subreddits: more than 100, a blank entry, a name that is not 2–21 letters, digits or underscores once an `r/` prefix
 *   is removed, or one also in `subreddits` (case-insensitive);
 * - countries: more than 50, a blank entry, a code that is not an assigned ISO 3166-1 alpha-2 code once trimmed and
 *   upper-cased, or one also targeted (`geoTargets`, or the US default when neither `geoTargets` nor
 *   `subCountryGeoTargets` is given).
 *
 * Duplicates are not refused: campaign-service drops them. Messages name entries by position and never echo a caller value.
 */
export function redditTargetingExclusionsRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const key of REDDIT_TARGETING_EXCLUSION_KEYS) {
    if (Object.keys(config).some((k) => k !== key && foldKey(k) === foldKey(key))) {
      return { field: fieldOf(key), message: `Send it as "${key}", spelled exactly.` };
    }
  }
  const lists = {} as Record<RedditTargetingExclusionKey, string[]>;
  for (const key of REDDIT_TARGETING_EXCLUSION_KEYS) {
    const list = stringList(config[key]);
    if (list === null) return { field: fieldOf(key), message: 'Send it as a list of text entries.' };
    lists[key] = list;
  }
  const set = REDDIT_TARGETING_EXCLUSION_KEYS.find((key) => lists[key].length > 0);
  if (set === undefined) return null;
  if (!enabled) {
    return { field: fieldOf(set), message: 'Reddit targeting exclusions are not enabled on this deployment. Remove them and create again.' };
  }
  return subredditRefusal(lists.excludedSubreddits, config) ?? geoRefusal(lists.excludedGeoTargets, config);
}
