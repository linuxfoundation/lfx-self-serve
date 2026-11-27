// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_REDDIT_DELIVERY,
  REDDIT_BUDGET_COPY,
  REDDIT_BUDGET_TYPES,
  REDDIT_DEVICE_PLATFORMS,
  REDDIT_PLACEMENT_KEYS,
  REDDIT_PLACEMENTS,
} from '../constants/campaign.constants';
import type {
  RedditBudgetCopy,
  RedditBudgetType,
  RedditConfigRefusal,
  RedditDeliveryCapabilities,
  RedditDeliveryDraft,
  RedditDeliveryField,
  RedditDeliveryOptionView,
  RedditDraftSnapshot,
} from '../interfaces/campaign.interface';
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

// === The Implement tab's delivery choices (#6108 row 5) ===

/**
 * The delivery choices a create acts on: each part whose capability is not an explicit yes is back at its default, so a
 * choice remembered from when it was on (a restored draft) is dropped, never sent, and the screen shows the default.
 */
export function redditDeliveryInEffect(delivery: RedditDeliveryDraft, capabilities: RedditDeliveryCapabilities): RedditDeliveryDraft {
  const placementsOn = capabilities.placements === true;
  return {
    budgetType: capabilities.budgetType === true ? delivery.budgetType : DEFAULT_REDDIT_DELIVERY.budgetType,
    placements: placementsOn ? delivery.placements : [...DEFAULT_REDDIT_DELIVERY.placements],
    platforms: placementsOn ? delivery.platforms : [...DEFAULT_REDDIT_DELIVERY.platforms],
    expandTargeting: placementsOn ? delivery.expandTargeting : DEFAULT_REDDIT_DELIVERY.expandTargeting,
  };
}

/**
 * The `redditConfig` keys for the delivery choices: only what differs from campaign-service's default, and nothing for a
 * capability that is not an explicit yes (the create route refuses any of them then). Every placement or every device is
 * the default and is omitted; so is an empty list, which `redditDeliveryRefusal` holds Create for instead.
 */
export function redditDeliveryField(delivery: RedditDeliveryDraft, capabilities: RedditDeliveryCapabilities): RedditDeliveryField {
  const { budgetType, placements, platforms, expandTargeting } = redditDeliveryInEffect(delivery, capabilities);
  const field: RedditDeliveryField = {};
  const some = <T extends string>(list: T[], all: readonly T[]): T[] | null => {
    const picked = all.filter((value) => list.includes(value));
    return picked.length > 0 && picked.length < all.length ? picked : null;
  };
  const pickedPlacements = some(placements, REDDIT_PLACEMENTS);
  if (pickedPlacements) field.placements = pickedPlacements;
  const pickedPlatforms = some(platforms, REDDIT_DEVICE_PLATFORMS);
  if (pickedPlatforms) field.platforms = pickedPlatforms;
  if (!expandTargeting) field.expandTargeting = false;
  if (budgetType !== DEFAULT_REDDIT_DELIVERY.budgetType) field.budgetType = budgetType;
  return field;
}

/** Why the delivery choices cannot be sent, or `null`: at least one placement and one device must stay chosen. */
export function redditDeliveryRefusal(delivery: RedditDeliveryDraft, capabilities: RedditDeliveryCapabilities): string | null {
  const { placements, platforms } = redditDeliveryInEffect(delivery, capabilities);
  if (!REDDIT_PLACEMENTS.some((value) => placements.includes(value))) return 'Choose at least one placement.';
  if (!REDDIT_DEVICE_PLATFORMS.some((value) => platforms.includes(value))) return 'Choose at least one device.';
  return null;
}

/**
 * `list` with `value` ticked or unticked, in `all`'s order. Unticking the last ticked value is refused (the list comes back
 * unchanged), so at least one placement and one device always stays chosen.
 */
export function redditDeliveryWithOption<T extends string>(list: readonly T[], value: T, on: boolean, all: readonly T[]): T[] {
  const next = all.filter((entry) => (entry === value ? on : list.includes(entry)));
  return next.length === 0 ? all.filter((entry) => list.includes(entry)) : next;
}

/** One checkbox per value of `all`, the last ticked one locked so it cannot be unticked. */
export function redditDeliveryOptions<T extends string>(
  list: readonly T[],
  all: readonly T[],
  labels: Readonly<Record<T, string>>
): RedditDeliveryOptionView<T>[] {
  const ticked = all.filter((value) => list.includes(value)).length;
  return all.map((value) => {
    const on = list.includes(value);
    return { value, label: labels[value], on, locked: on && ticked === 1 };
  });
}

/** The budget box's label and hint: daily only once the budget type is offered and chosen; otherwise what it always said. */
export function redditBudgetCopy(delivery: RedditDeliveryDraft, capabilities: RedditDeliveryCapabilities): RedditBudgetCopy {
  return REDDIT_BUDGET_COPY[redditDeliveryInEffect(delivery, capabilities).budgetType];
}

/** The `redditDraftFields` keys for the delivery choices, as held. */
export function redditDeliveryDraftFields(
  delivery: RedditDeliveryDraft
): Pick<RedditDraftSnapshot, 'redditBudgetType' | 'redditPlacements' | 'redditPlatforms' | 'redditExpandTargeting'> {
  return {
    redditBudgetType: delivery.budgetType,
    redditPlacements: [...delivery.placements],
    redditPlatforms: [...delivery.platforms],
    redditExpandTargeting: delivery.expandTargeting,
  };
}

/** The known values of a stored list, in `all`'s order, or `null` when it holds none (the default then stands). */
function storedList<T extends string>(value: unknown, all: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  const picked = all.filter((entry) => value.includes(entry));
  return picked.length > 0 ? picked : null;
}

/**
 * The delivery choices a stored draft holds, or `undefined` when it carries none of the four keys (an older draft). Each
 * key is read on its own, and one that is missing or unreadable (an unknown budget type, a list with no known value, an
 * `expandTargeting` that is not a boolean) leaves its default standing. Not gated on the capabilities, which may not be
 * answered yet: `redditDeliveryInEffect` drops what they do not confirm.
 */
export function redditDeliveryFromDraft(draft: RedditDraftSnapshot): RedditDeliveryDraft | undefined {
  const { redditBudgetType, redditPlacements, redditPlatforms, redditExpandTargeting } = draft;
  if ([redditBudgetType, redditPlacements, redditPlatforms, redditExpandTargeting].every((value) => value === undefined)) return undefined;
  return {
    budgetType: REDDIT_BUDGET_TYPES.find((type) => type === redditBudgetType) ?? DEFAULT_REDDIT_DELIVERY.budgetType,
    placements: storedList(redditPlacements, REDDIT_PLACEMENTS) ?? [...DEFAULT_REDDIT_DELIVERY.placements],
    platforms: storedList(redditPlatforms, REDDIT_DEVICE_PLATFORMS) ?? [...DEFAULT_REDDIT_DELIVERY.platforms],
    expandTargeting: typeof redditExpandTargeting === 'boolean' ? redditExpandTargeting : DEFAULT_REDDIT_DELIVERY.expandTargeting,
  };
}
