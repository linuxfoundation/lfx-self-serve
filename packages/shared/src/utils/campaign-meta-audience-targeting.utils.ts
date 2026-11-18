// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  META_ADVANTAGE_AUDIENCE_MAX_AGE_MIN,
  META_AUDIENCE_GENDERS,
  META_AUDIENCE_MAX_AGE,
  META_AUDIENCE_MIN_AGE,
  META_CUSTOM_AUDIENCE_ID_PATTERN,
  META_MAX_CUSTOM_AUDIENCES,
} from '../constants/campaign.constants';
import type { MetaAudienceGender, MetaAudienceTargeting, MetaAudienceTargetingRefusal } from '../interfaces/campaign.interface';

/**
 * Meta ad set audience targeting (#5905), `metaConfig.targeting`. One set of rules for the Implement
 * tab (which holds Create on a refusal) and the create route (which answers it with a 400), both
 * mirroring campaign-service's `NormalizeAudienceTargeting` (linuxfoundation/lfx-v2-campaign-service#550).
 */

const FIELD = 'metaConfig.targeting';
const ID_LISTS = [
  ['customAudiences', 'Included'],
  ['excludedCustomAudiences', 'Excluded'],
] as const;

/**
 * Why `raw` cannot be sent as `metaConfig.targeting`, or `null`. Typed runtime checks, since the create
 * route has no body validator: an absent or null block is fine, and so is an absent or null key.
 */
export function metaAudienceTargetingRefusal(raw: unknown): MetaAudienceTargetingRefusal | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { field: FIELD, message: 'Meta audience targeting must be an object.' };
  const t = raw as Record<string, unknown>;

  for (const key of ['ageMin', 'ageMax'] as const) {
    const age = t[key];
    if (age === undefined || age === null) continue;
    if (typeof age !== 'number' || !Number.isInteger(age) || age < META_AUDIENCE_MIN_AGE || age > META_AUDIENCE_MAX_AGE) {
      return { field: `${FIELD}.${key}`, message: `Meta targets whole ages from ${META_AUDIENCE_MIN_AGE} to ${META_AUDIENCE_MAX_AGE}.` };
    }
  }
  const ageMin = typeof t['ageMin'] === 'number' ? t['ageMin'] : null;
  const ageMax = typeof t['ageMax'] === 'number' ? t['ageMax'] : null;
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { field: `${FIELD}.ageMin`, message: 'The minimum age must not be above the maximum age.' };
  }

  const genders = t['genders'];
  if (genders !== undefined && genders !== null) {
    if (!Array.isArray(genders) || genders.some((g) => typeof g !== 'string' || metaGender(g) === null)) {
      return { field: `${FIELD}.genders`, message: 'Genders must be male, female or both.' };
    }
  }

  const lists: Record<string, string[]> = {};
  for (const [key, label] of ID_LISTS) {
    const ids = t[key];
    if (ids === undefined || ids === null) continue;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !META_CUSTOM_AUDIENCE_ID_PATTERN.test(id.trim()))) {
      return { field: `${FIELD}.${key}`, message: `${label} custom audiences must be Meta audience ids: digits, without a leading zero.` };
    }
    lists[key] = distinctIds(ids as string[]);
    if (lists[key].length > META_MAX_CUSTOM_AUDIENCES) {
      return { field: `${FIELD}.${key}`, message: `${label} custom audiences: at most ${META_MAX_CUSTOM_AUDIENCES}.` };
    }
  }
  const included = new Set(lists['customAudiences'] ?? []);
  const both = (lists['excludedCustomAudiences'] ?? []).find((id) => included.has(id));
  if (both !== undefined) {
    return { field: `${FIELD}.excludedCustomAudiences`, message: `Custom audience ${both} cannot be both included and excluded.` };
  }

  const advantage = t['advantageAudience'];
  if (advantage !== undefined && advantage !== null && typeof advantage !== 'boolean') {
    return { field: `${FIELD}.advantageAudience`, message: 'Advantage+ audience must be on or off.' };
  }
  if (
    advantage === true &&
    ((ageMin ?? META_AUDIENCE_MIN_AGE) > META_ADVANTAGE_AUDIENCE_MAX_AGE_MIN || (ageMax ?? META_AUDIENCE_MAX_AGE) < META_AUDIENCE_MAX_AGE)
  ) {
    return {
      field: `${FIELD}.advantageAudience`,
      message: `With Advantage+ audience on, Meta needs a minimum age of ${META_ADVANTAGE_AUDIENCE_MAX_AGE_MIN} or less and a maximum age of ${META_AUDIENCE_MAX_AGE}.`,
    };
  }
  return null;
}

/**
 * The targeting a create sends for an ACCEPTED block ({@link metaAudienceTargetingRefusal} is `null`),
 * or `null` when it asks for nothing. Every default is dropped rather than sent: ages 18 and 65, both or
 * no genders, empty lists, and an unsaid (absent or null) Advantage+ audience. An explicit `true` or
 * `false` is kept, since campaign-service sends each as given. Ids are trimmed and de-duplicated, genders
 * lower-cased.
 */
export function compactMetaAudienceTargeting(t: MetaAudienceTargeting | null | undefined): MetaAudienceTargeting | null {
  if (!t) return null;
  const out: MetaAudienceTargeting = {};
  if (typeof t.ageMin === 'number' && t.ageMin !== META_AUDIENCE_MIN_AGE) out.ageMin = t.ageMin;
  if (typeof t.ageMax === 'number' && t.ageMax !== META_AUDIENCE_MAX_AGE) out.ageMax = t.ageMax;
  const genders = [...new Set((t.genders ?? []).map(metaGender).filter((g): g is MetaAudienceGender => g !== null))];
  if (genders.length === 1) out.genders = genders;
  for (const [key] of ID_LISTS) {
    const ids = distinctIds(t[key] ?? []);
    if (ids.length > 0) out[key] = ids;
  }
  if (typeof t.advantageAudience === 'boolean') out.advantageAudience = t.advantageAudience;
  return Object.keys(out).length > 0 ? out : null;
}

/** Whether a compacted targeting names a custom audience, which needs `global_marketing_ops` on the project. */
export function metaTargetingNamesCustomAudiences(t: MetaAudienceTargeting | null): boolean {
  return (t?.customAudiences?.length ?? 0) > 0 || (t?.excludedCustomAudiences?.length ?? 0) > 0;
}

function metaGender(value: string): MetaAudienceGender | null {
  const key = value.trim().toLowerCase();
  return META_AUDIENCE_GENDERS.find((g) => g === key) ?? null;
}

function distinctIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()))];
}
