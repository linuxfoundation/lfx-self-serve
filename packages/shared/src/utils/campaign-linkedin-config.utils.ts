// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_GEO_URN_CORRECTIONS } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';

/**
 * The `linkedInConfig` keys a create may carry, spelled exactly (`LinkedInCampaignCreateRequest`). campaign-service
 * reads more than these (#552, #582, #585, #586, #588, #589), each behind its own flag there. Each one joins this list in
 * the self-serve PR that checks it, so none reaches campaign-service unchecked first.
 */
const LINKEDIN_CONFIG_REQUEST_KEYS = [
  'eventName',
  'eventSlug',
  'dates',
  'registrationUrl',
  'hsToken',
  'budgetUsd',
  'lifetimeBudget',
  'dailyCapUsd',
  'startDate',
  'endDate',
  'geoTargets',
  'targetingProfile',
  'variants',
  'project',
  'driveFolderUrl',
  'adAccountId',
  'selectedAdAccountId',
  'bidding',
  'targetingProfileEdit',
] as const;

/** The `linkedInConfig.variants[i]` keys a create may carry, spelled exactly (`LinkedInCreativeVariant`). */
const LINKEDIN_VARIANT_REQUEST_KEYS = ['introText', 'headline', 'imageUrn', 'imageAssetId', 'name', 'description', 'callToAction'] as const;

/** A key as Go's `encoding/json` matches it: Unicode case folding, which upper-casing first catches (`ſ` is `s`). */
function foldKey(key: string): string {
  return key.toUpperCase().toLowerCase();
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Why `record` carries a key outside `known`, or `null`. A different spelling of a known key names that key. */
function keyRefusalIn(record: Record<string, unknown>, known: readonly string[], path: string): LinkedInConfigKeyRefusal | null {
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue;
    const match = known.find((k) => foldKey(key) === foldKey(k));
    if (match) return { field: `${path}.${match}`, message: `Send it as ${path}.${match}, spelled exactly.` };
    return { field: path, message: `${path} carries a field this page does not send. Reload the page and create again.` };
  }
  return null;
}

/**
 * Why `raw`'s keys cannot be sent, or `null` (#5764). The create route used to forward `linkedInConfig` as it came, so any
 * field campaign-service reads (its targeting, objective, conversions, Text Ads, a variant's call to action or video) went
 * past every check here, and a differently cased known key past the checks that read it by exact spelling. Now any top-level
 * key outside {@link LINKEDIN_CONFIG_REQUEST_KEYS}, or a variant key outside {@link LINKEDIN_VARIANT_REQUEST_KEYS}, is
 * refused whatever the flags. Only those two levels are walked: the keys inside `bidding`, `geoTargets[i]` and
 * `targetingProfileEdit` are left to the checks that read them. A variant that is not an object is left to
 * campaign-service, as before.
 */
export function linkedInConfigKeyRefusal(raw: unknown): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const top = keyRefusalIn(config, LINKEDIN_CONFIG_REQUEST_KEYS, 'linkedInConfig');
  if (top !== null) return top;
  const variants = config['variants'];
  if (!Array.isArray(variants)) return null;
  for (const [index, item] of variants.entries()) {
    const variant = plainRecord(item);
    const refusal = variant ? keyRefusalIn(variant, LINKEDIN_VARIANT_REQUEST_KEYS, `linkedInConfig.variants[${index}]`) : null;
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * `geoTargets` with the URNs `LINKEDIN_GEO_RESOLVE_MAP` used to send for Germany and the United Kingdom corrected
 * (`LINKEDIN_GEO_URN_CORRECTIONS`), so a brief or draft saved before the fix targets the country its label names.
 * Anything else, including a value that is not a list, is returned as it came.
 */
export function correctLinkedInGeoTargets(geoTargets: unknown): unknown {
  if (!Array.isArray(geoTargets)) return geoTargets;
  return geoTargets.map((target: unknown) => {
    const record = plainRecord(target);
    const fix = record ? LINKEDIN_GEO_URN_CORRECTIONS.find((c) => c.label === record['label'] && c.from === record['urn']) : undefined;
    return fix && record ? { ...record, urn: fix.to } : target;
  });
}
