// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_REDDIT_CUSTOM_AUDIENCE_IDS, REDDIT_CUSTOM_AUDIENCE_ID_PATTERN, REDDIT_CUSTOM_AUDIENCE_KEYS } from '../constants/campaign.constants';
import type { RedditConfigRefusal, RedditCustomAudienceOption, RedditCustomAudiencesResult } from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';

/**
 * Reddit custom audiences (#6108 row 1): `redditConfig.customAudienceIds` / `excludedCustomAudienceIds` on create, held
 * to campaign-service's `checkRedditCustomAudienceShape` and `checkRedditCustomAudiences`
 * (`internal/dispatch/reddit_custom_audiences.go`) and `ValidateCustomAudienceIDs`
 * (`internal/platform/reddit/custom_audiences.go`, #549), so a create campaign-service would refuse is refused here
 * first; and the mapping of its custom-audience read for the picker.
 */

const MAX_QUERY_LENGTH = 100;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fieldOf(key: string): string {
  return `redditConfig.${key}`;
}

/** A list as campaign-service decodes it: `null` or absent is no list; anything but an array of strings is `undefined`. */
function idList(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null;
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? (value as string[]) : undefined;
}

/** The first rule one list breaks on its own (count, then each id in order), or `null`. */
function listRefusal(ids: readonly string[]): string | null {
  if (ids.length > MAX_REDDIT_CUSTOM_AUDIENCE_IDS) return `Pick at most ${MAX_REDDIT_CUSTOM_AUDIENCE_IDS} custom audiences.`;
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (!REDDIT_CUSTOM_AUDIENCE_ID_PATTERN.test(id)) {
      return `Entry ${index + 1} is not a Reddit custom audience id (1 to 64 letters, digits or underscores, with no spaces).`;
    }
    if (seen.has(id)) return `Entry ${index + 1} repeats an earlier custom audience.`;
    seen.add(id);
  }
  return null;
}

/**
 * Why `raw`'s custom audience lists cannot be sent, or `null`. Typed runtime checks, since the create route forwards
 * `redditConfig` as it comes. In campaign-service's order: shape, then the flag, then the rules. Refused:
 *
 * - a case variant of either key (campaign-service decodes keys ignoring case, Unicode folds included: `foldKey`), whatever
 *   the flag, since it would reach campaign-service past the checks here;
 * - a list that is not an array of strings (`null` is no list, as it decodes);
 * - a non-empty list while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy creator
 *   ignores it and campaign-service refuses it while `REDDIT_CUSTOM_AUDIENCES_ENABLED` is off;
 * - more than `MAX_REDDIT_CUSTOM_AUDIENCE_IDS` ids in either list, an id outside `REDDIT_CUSTOM_AUDIENCE_ID_PATTERN`
 *   (compared exactly: a padded id is refused, never trimmed, so what is sent is what was written), a repeat within a
 *   list, or an id in both lists.
 *
 * Two empty or absent lists are nothing to check. Messages never echo a caller value.
 */
export function redditCustomAudiencesRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const key of REDDIT_CUSTOM_AUDIENCE_KEYS) {
    if (Object.keys(config).some((other) => other !== key && foldKey(other) === foldKey(key))) {
      return { field: fieldOf(key), message: `Send the custom audiences as "${key}", spelled exactly.` };
    }
  }
  const lists: Partial<Record<(typeof REDDIT_CUSTOM_AUDIENCE_KEYS)[number], string[]>> = {};
  for (const key of REDDIT_CUSTOM_AUDIENCE_KEYS) {
    const ids = idList(config[key]);
    if (ids === undefined) return { field: fieldOf(key), message: 'The custom audiences must be a list of Reddit custom audience ids.' };
    if (ids !== null && ids.length > 0) lists[key] = ids;
  }
  const [includeKey, excludeKey] = REDDIT_CUSTOM_AUDIENCE_KEYS;
  const include = lists[includeKey] ?? [];
  const exclude = lists[excludeKey] ?? [];
  if (include.length === 0 && exclude.length === 0) return null;
  if (!enabled) {
    return {
      field: fieldOf(include.length > 0 ? includeKey : excludeKey),
      message: 'Reddit custom audiences are not enabled on this deployment. Reload the page, then create again without them.',
    };
  }
  for (const [key, ids] of [
    [includeKey, include],
    [excludeKey, exclude],
  ] as const) {
    const message = listRefusal(ids);
    if (message !== null) return { field: fieldOf(key), message };
  }
  const targeted = new Set(include);
  const both = exclude.findIndex((id) => targeted.has(id));
  if (both !== -1) {
    return {
      field: fieldOf(excludeKey),
      message: `Entry ${both + 1} is also a targeted custom audience. An audience cannot be both targeted and excluded.`,
    };
  }
  return null;
}

/**
 * Whether `raw` names any Reddit custom audience, which only a caller holding `global_marketing_ops` on the project may
 * do (campaign-service's `RedditMarketingOpsInputs`, 403 otherwise). Read after `redditCustomAudiencesRefusal` passed.
 */
export function redditConfigNamesCustomAudiences(raw: unknown): boolean {
  const config = plainRecord(raw);
  if (!config) return false;
  return REDDIT_CUSTOM_AUDIENCE_KEYS.some((key) => {
    const ids = config[key];
    return Array.isArray(ids) && ids.length > 0;
  });
}

/**
 * The picker's `?q=` search: absent is no search (`{ valid: true }`); otherwise text of 1–100 characters once trimmed,
 * as the Meta read takes it. Anything else (blank, too long, repeated) is `{ valid: false }`.
 */
export function redditCustomAudienceQuery(raw: unknown): { valid: boolean; q?: string } {
  if (raw === undefined) return { valid: true };
  if (typeof raw !== 'string') return { valid: false };
  const q = raw.trim();
  return q === '' || q.length > MAX_QUERY_LENGTH ? { valid: false } : { valid: true, q };
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * campaign-service's custom-audience read, camel-cased for the picker, or `null` when it is unreadable (no `audiences`
 * array): reading that as an empty list would say the account has none. A row whose id a create would refuse
 * (`REDDIT_CUSTOM_AUDIENCE_ID_PATTERN`) is dropped rather than offered, a repeated id is offered once, and a blank name
 * reads as the id. `q` (campaign-service takes no search) keeps names containing it, ignoring case. Upstream order (by
 * name) is kept.
 */
export function redditCustomAudiencesFromPayload(payload: unknown, q?: string): RedditCustomAudiencesResult | null {
  const body = plainRecord(payload);
  if (!body || !Array.isArray(body['audiences'])) return null;
  const needle = q?.toLowerCase();
  const seen = new Set<string>();
  const audiences: RedditCustomAudienceOption[] = [];
  for (const row of body['audiences'] as unknown[]) {
    const audience = plainRecord(row);
    const id = audience?.['id'];
    if (!audience || typeof id !== 'string' || !REDDIT_CUSTOM_AUDIENCE_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const rawName = audience['name'];
    const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName : id;
    if (needle !== undefined && !name.toLowerCase().includes(needle)) continue;
    audiences.push({
      id,
      name,
      type: typeof audience['type'] === 'string' ? audience['type'] : '',
      status: typeof audience['status'] === 'string' ? audience['status'] : '',
      sizeLower: size(audience['size_lower']),
      sizeUpper: size(audience['size_upper']),
    });
  }
  return {
    accountId: typeof body['account_id'] === 'string' ? body['account_id'] : '',
    audiences,
    truncated: body['truncated'] === true,
  };
}
