// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  META_AUDIENCE_TARGETING_OFF_MESSAGE,
  META_BEHAVIOR_TARGETING_OFF_MESSAGE,
  META_CUSTOM_AUDIENCE_ID_PATTERN,
  META_INTEREST_TARGETING_OFF_MESSAGE,
  META_LOCALE_TARGETING_OFF_MESSAGE,
  META_MAX_DETAILED_TARGETING_IDS,
  META_MAX_LOCALES,
  META_TARGETING_QUERY_MAX_LENGTH,
  META_TARGETING_QUERY_MIN_LENGTH,
  META_TARGETING_SEARCH_TYPES,
} from '../constants/campaign.constants';
import type { MetaConfigRefusal, MetaDetailedTargeting, MetaTargetingFlags, MetaTargetingSearchType } from '../interfaces/campaign.interface';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * Meta detailed targeting (#5904 row 4): interests, behaviors, work positions and languages in
 * `metaConfig.targeting`. One set of rules for the create route (which answers a refusal with a 400) and, later,
 * the Implement tab, mirroring campaign-service's `checkMetaTargeting` and `normalizeDetailedTargeting`
 * (linuxfoundation/lfx-v2-campaign-service#612).
 */

const FIELD = 'metaConfig.targeting';
const ID_FIELDS = [
  ['interests', 'Interests'],
  ['behaviors', 'Behaviors'],
  ['workPositions', 'Job titles'],
] as const;
/** The audience fields of the same block (#5905); setting any of them needs the audience flag. */
const AUDIENCE_FIELDS = ['ageMin', 'ageMax', 'genders', 'customAudiences', 'excludedCustomAudiences', 'advantageAudience'] as const;

/** Whether a targeting field is set, as campaign-service reads it: a list only when non-empty, anything else when present and not null. */
function isSet(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

/** Whether `raw` sets any detailed field, so the audience flag is not needed for it alone. */
export function metaTargetingHasDetailedFields(raw: unknown): boolean {
  const record = metaConfigRecord(raw);
  return [...ID_FIELDS.map(([key]) => key), 'locales'].some((key) => isSet(record?.[key]));
}

/** Whether `raw` sets any of the six audience fields. */
export function metaTargetingHasAudienceFields(raw: unknown): boolean {
  const record = metaConfigRecord(raw);
  return AUDIENCE_FIELDS.some((key) => isSet(record?.[key]));
}

/**
 * Why `raw` sets a targeting field this deployment does not accept, or `null`. Each detailed field needs its own
 * flag (behaviors and work positions share one); the audience flag is needed when an audience field is set, or
 * when no detailed field is, so an empty or audience-only block keeps today's rule. Never a silent drop: a block
 * here comes from a tab opened while the flag was on.
 */
export function metaTargetingFlagRefusal(raw: unknown, flags: MetaTargetingFlags): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const set = (key: string): boolean => isSet(record?.[key]);
  if ((metaTargetingHasAudienceFields(raw) || !metaTargetingHasDetailedFields(raw)) && !flags.audience) {
    return { field: FIELD, message: META_AUDIENCE_TARGETING_OFF_MESSAGE };
  }
  if (set('interests') && !flags.interest) return { field: `${FIELD}.interests`, message: META_INTEREST_TARGETING_OFF_MESSAGE };
  if (set('behaviors') && !flags.behavior) return { field: `${FIELD}.behaviors`, message: META_BEHAVIOR_TARGETING_OFF_MESSAGE };
  if (set('workPositions') && !flags.behavior) return { field: `${FIELD}.workPositions`, message: META_BEHAVIOR_TARGETING_OFF_MESSAGE };
  if (set('locales') && !flags.locale) return { field: `${FIELD}.locales`, message: META_LOCALE_TARGETING_OFF_MESSAGE };
  return null;
}

/**
 * Why `raw`'s detailed fields cannot be sent, or `null`. Each id list holds Meta ids (digits, no leading zero),
 * at most {@link META_MAX_DETAILED_TARGETING_IDS} distinct; `locales` holds positive integers, at most
 * {@link META_MAX_LOCALES} distinct. Absent or null is "not set"; ids are trimmed first.
 */
export function metaDetailedTargetingRefusal(raw: unknown): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  for (const [key, label] of ID_FIELDS) {
    const value = record?.[key];
    if (value === undefined || value === null) continue;
    const field = `${FIELD}.${key}`;
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !META_CUSTOM_AUDIENCE_ID_PATTERN.test(id.trim()))) {
      return { field, message: `${label} must be Meta ids: digits, without a leading zero.` };
    }
    if (new Set(value.map((id: string) => id.trim())).size > META_MAX_DETAILED_TARGETING_IDS) {
      return { field, message: `Choose at most ${META_MAX_DETAILED_TARGETING_IDS} ${label.toLowerCase()}.` };
    }
  }
  const locales = record?.['locales'];
  if (locales !== undefined && locales !== null) {
    const field = `${FIELD}.locales`;
    if (!Array.isArray(locales) || locales.some((key) => typeof key !== 'number' || !Number.isSafeInteger(key) || key <= 0)) {
      return { field, message: 'Languages must be Meta language keys: whole numbers above zero.' };
    }
    if (new Set(locales).size > META_MAX_LOCALES) return { field, message: `Choose at most ${META_MAX_LOCALES} languages.` };
  }
  return null;
}

/**
 * The detailed fields a create sends for an ACCEPTED block ({@link metaDetailedTargetingRefusal} is `null`), or
 * `null` when it sets none: ids trimmed and de-duplicated in first-seen order, empty lists dropped.
 */
export function compactMetaDetailedTargeting(raw: unknown): MetaDetailedTargeting | null {
  const record = metaConfigRecord(raw);
  const out: MetaDetailedTargeting = {};
  for (const [key] of ID_FIELDS) {
    const value = record?.[key];
    if (!Array.isArray(value)) continue;
    const ids = [...new Set(value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()))].filter((id) => id !== '');
    if (ids.length > 0) out[key] = ids;
  }
  const locales = record?.['locales'];
  if (Array.isArray(locales)) {
    const keys = [...new Set(locales.filter((key): key is number => typeof key === 'number'))];
    if (keys.length > 0) out.locales = keys;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Why a targeting search cannot be sent, or `null`: a known kind, and 2–100 characters after trimming with no control characters. */
export function metaTargetingQueryRefusal(type: unknown, query: unknown): string | null {
  if (typeof type !== 'string' || !(META_TARGETING_SEARCH_TYPES as readonly string[]).includes(type)) {
    return `The search type must be one of ${META_TARGETING_SEARCH_TYPES.join(', ')}.`;
  }
  const trimmed = typeof query === 'string' ? query.trim() : '';
  // Counted in code points, as campaign-service counts runes: an emoji is one character, not two.
  const length = [...trimmed].length;
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  if (length < META_TARGETING_QUERY_MIN_LENGTH || length > META_TARGETING_QUERY_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    return `Search with ${META_TARGETING_QUERY_MIN_LENGTH}–${META_TARGETING_QUERY_MAX_LENGTH} characters, on one line.`;
  }
  return null;
}

/** Narrows a checked search type ({@link metaTargetingQueryRefusal} is `null`). */
export function isMetaTargetingSearchType(value: unknown): value is MetaTargetingSearchType {
  return typeof value === 'string' && (META_TARGETING_SEARCH_TYPES as readonly string[]).includes(value);
}
