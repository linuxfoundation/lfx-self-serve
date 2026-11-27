// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_BUDGET_TYPES, REDDIT_DEVICE_PLATFORMS, REDDIT_PLACEMENT_KEYS, REDDIT_PLACEMENTS } from '../constants/campaign.constants';
import type { RedditBudgetType, RedditConfigRefusal } from '../interfaces/campaign.interface';
import { googleAdsToUpperCode } from './campaign-google-assets.utils';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * Reddit delivery choices on create (#6108 row 5): placements, devices and audience expansion
 * (`redditConfig.placements` / `platforms` / `expandTargeting`), and the budget type (`redditConfig.budgetType`). Held
 * to campaign-service's `checkRedditPlacementShape`, `checkRedditPlacementTargeting` and `NormalizePlacementTargeting`
 * (`internal/dispatch/reddit_placement_targeting.go`, `internal/platform/reddit/placement_targeting.go`) and
 * `checkRedditBudgetType` / `ResolveBudgetGoalType` (`internal/dispatch/reddit_budget_type.go`, #549), so a create
 * campaign-service would refuse is refused here first, with the field to point at. Messages never echo a caller value.
 */

const BUDGET_TYPE_KEY = 'budgetType';

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fieldOf(key: string): string {
  return `redditConfig.${key}`;
}

/** A different spelling of `key` in `config` (campaign-service decodes keys ignoring case, Unicode folds included). */
function hasCaseVariant(config: Record<string, unknown>, key: string): boolean {
  return Object.keys(config).some((other) => other !== key && foldKey(other) === foldKey(key));
}

/** A list as campaign-service decodes it: absent and `null` are empty, anything but an array of strings is `null`. */
function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

/**
 * Go's `strings.ToLower` for the only results that can then match an ASCII budget type: ASCII letters, plus the two
 * non-ASCII letters Go lower-cases INTO ASCII, `İ` to `i` and the Kelvin sign to `k`. Not `toLowerCase`, which turns
 * `İ` into two code points.
 */
function goToLowerAscii(text: string): string {
  return text.replace(/[A-ZİK]/g, (ch) => {
    if (ch === 'İ') return 'i';
    if (ch === 'K') return 'k';
    return ch.toLowerCase();
  });
}

/**
 * One placement or device list normalised as campaign-service's `normalizeEnumList` does: each entry trimmed and
 * upper-cased as Go does, then held to `allowed`; duplicates dropped; the result in `allowed`'s order. Returns the list,
 * or the refusal of its first blank or unknown entry.
 */
export function normalizeRedditEnumList<T extends string>(
  values: readonly string[],
  allowed: readonly T[],
  noun: string
): { values: T[] } | { refusal: string } {
  const picked = new Set<T>();
  for (const [i, raw] of values.entries()) {
    const canonical = googleAdsToUpperCode(goTrimSpace(raw));
    if (canonical === '') return { refusal: `Entry ${i + 1} is blank.` };
    const match = allowed.find((value) => value === canonical);
    if (match === undefined) return { refusal: `Entry ${i + 1} is not a Reddit ${noun}: use ${allowed.join(', ')}.` };
    picked.add(match);
  }
  return { values: allowed.filter((value) => picked.has(value)) };
}

/**
 * Why `raw`'s placements, devices or expansion cannot be sent, or `null` (#6108 row 5). Typed runtime checks, since the
 * create route forwards `redditConfig` as it comes. In campaign-service's order: shape, then the flag, then the values.
 * Refused:
 *
 * - a case variant of any of the three keys, whatever the flag, since it would reach campaign-service past the checks
 *   here;
 * - a list that is not an array of strings, or an `expandTargeting` that is not `true` or `false` (`null` is absent);
 * - a non-empty list, or a present `expandTargeting` (`true` included), while this deployment cannot send them
 *   (`enabled`): refused, never dropped, since the legacy creator ignores them and campaign-service refuses them while
 *   `REDDIT_PLACEMENT_TARGETING_ENABLED` is off;
 * - a blank entry, or one that is not `FEED` / `COMMENTS_PAGE` (placements) or `DESKTOP` / `MOBILE_NATIVE` /
 *   `MOBILE_WEB` (platforms) once trimmed and upper-cased. `ALL` is refused: omit the list for every device.
 *
 * An empty list is the default, as an absent one is. Duplicates are not refused: campaign-service drops them.
 */
export function redditPlacementsRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const key of REDDIT_PLACEMENT_KEYS) {
    if (hasCaseVariant(config, key)) return { field: fieldOf(key), message: `Send it as "${key}", spelled exactly.` };
  }
  const placements = stringList(config['placements']);
  if (placements === null) return { field: fieldOf('placements'), message: 'Send it as a list of text entries.' };
  const platforms = stringList(config['platforms']);
  if (platforms === null) return { field: fieldOf('platforms'), message: 'Send it as a list of text entries.' };
  const expand = config['expandTargeting'];
  if (expand !== undefined && expand !== null && typeof expand !== 'boolean') {
    return { field: fieldOf('expandTargeting'), message: 'Send it as true or false.' };
  }
  const set: string[] = [];
  if (placements.length > 0) set.push('placements');
  if (platforms.length > 0) set.push('platforms');
  if (typeof expand === 'boolean') set.push('expandTargeting');
  if (set.length === 0) return null;
  if (!enabled) {
    return { field: fieldOf(set[0]), message: 'Reddit placements are not enabled on this deployment. Remove them and create again.' };
  }
  const placementList = normalizeRedditEnumList(placements, REDDIT_PLACEMENTS, 'placement');
  if ('refusal' in placementList) return { field: fieldOf('placements'), message: placementList.refusal };
  const platformList = normalizeRedditEnumList(platforms, REDDIT_DEVICE_PLATFORMS, 'device (omit the list for every device)');
  if ('refusal' in platformList) return { field: fieldOf('platforms'), message: platformList.refusal };
  return null;
}

/**
 * `raw` as campaign-service's `ResolveBudgetGoalType` reads it: trimmed and lower-cased as Go does, then `lifetime` or
 * `daily`; anything else is `null`.
 */
export function normalizeRedditBudgetType(raw: string): RedditBudgetType | null {
  const value = goToLowerAscii(goTrimSpace(raw));
  return REDDIT_BUDGET_TYPES.find((type) => type === value) ?? null;
}

/**
 * Why `raw`'s `budgetType` cannot be sent, or `null` (#6108 row 5), in campaign-service's order
 * (`checkRedditBudgetType`). Refused:
 *
 * - a case variant of the key, whatever the flag;
 * - a present value that is not a string (`null` included: omit the field for the default);
 * - a blank value;
 * - any value while this deployment cannot send it (`enabled`), `lifetime` included: refused, never dropped, since
 *   campaign-service refuses it while `REDDIT_DAILY_BUDGET_ENABLED` is off;
 * - a value that is not `lifetime` or `daily` once trimmed and lower-cased.
 *
 * An absent field is never refused, whatever the flag.
 */
export function redditBudgetTypeRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const field = fieldOf(BUDGET_TYPE_KEY);
  if (hasCaseVariant(config, BUDGET_TYPE_KEY)) return { field, message: `Send it as "${BUDGET_TYPE_KEY}", spelled exactly.` };
  if (!Object.prototype.hasOwnProperty.call(config, BUDGET_TYPE_KEY) || config[BUDGET_TYPE_KEY] === undefined) return null;
  const value = config[BUDGET_TYPE_KEY];
  if (typeof value !== 'string') return { field, message: 'Send the budget type as "lifetime" or "daily", or omit it for lifetime.' };
  if (goTrimSpace(value) === '') return { field, message: 'The budget type is blank. Omit it for lifetime.' };
  if (!enabled) return { field, message: 'Reddit daily budgets are not enabled on this deployment. Remove the budget type and create again.' };
  if (normalizeRedditBudgetType(value) === null) return { field, message: 'Send the budget type as "lifetime" or "daily".' };
  return null;
}
