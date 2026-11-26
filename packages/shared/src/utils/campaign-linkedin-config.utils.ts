// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CAROUSEL_CARD_REQUEST_KEYS, LINKEDIN_GEO_URN_CORRECTIONS, LINKEDIN_TEXT_AD_REQUEST_KEYS } from '../constants/campaign.constants';
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
  'format',
  'textAds',
  'targeting',
  'objective',
  'conversions',
  'leadGenForm',
  'leadGenCallToAction',
  'carouselCards',
  'carouselIntroText',
  'documentAssetId',
  'documentTitle',
  'documentIntroText',
] as const;

/** The `linkedInConfig.variants[i]` keys a create may carry, spelled exactly (`LinkedInCreativeVariant`). */
const LINKEDIN_VARIANT_REQUEST_KEYS = ['introText', 'headline', 'imageUrn', 'imageAssetId', 'videoAssetId', 'name', 'description', 'callToAction'] as const;

/** A key as Go's `encoding/json` matches it: Unicode case folding, which upper-casing first catches (`ſ` is `s`). */
export function foldKey(key: string): string {
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
 * key outside {@link LINKEDIN_CONFIG_REQUEST_KEYS}, a variant key outside {@link LINKEDIN_VARIANT_REQUEST_KEYS}, a text
 * ad key outside `LINKEDIN_TEXT_AD_REQUEST_KEYS` (#5764 row 19), or a carousel card key outside
 * `LINKEDIN_CAROUSEL_CARD_REQUEST_KEYS` (campaign-service#665) is refused whatever the flags. Only those levels are
 * walked: the keys inside `bidding`, `geoTargets[i]`, `targetingProfileEdit` and `targeting` are left to the checks that read them. A
 * variant or text ad that is not an object is left to the checks that read it, as before.
 */
export function linkedInConfigKeyRefusal(raw: unknown): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const top = keyRefusalIn(config, LINKEDIN_CONFIG_REQUEST_KEYS, 'linkedInConfig');
  if (top !== null) return top;
  return (
    listKeyRefusal(config['variants'], LINKEDIN_VARIANT_REQUEST_KEYS, 'linkedInConfig.variants') ??
    listKeyRefusal(config['textAds'], LINKEDIN_TEXT_AD_REQUEST_KEYS, 'linkedInConfig.textAds') ??
    listKeyRefusal(config['carouselCards'], LINKEDIN_CAROUSEL_CARD_REQUEST_KEYS, 'linkedInConfig.carouselCards')
  );
}

/** Why an entry of `list` carries a key outside `known`, or `null`. An entry that is not an object is left to the checks that read it. */
function listKeyRefusal(list: unknown, known: readonly string[], path: string): LinkedInConfigKeyRefusal | null {
  if (!Array.isArray(list)) return null;
  for (const [index, item] of list.entries()) {
    const entry = plainRecord(item);
    const refusal = entry ? keyRefusalIn(entry, known, `${path}[${index}]`) : null;
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * `geoTargets` with the URNs `LINKEDIN_GEO_RESOLVE_MAP` used to send for Germany and the United Kingdom corrected
 * (`LINKEDIN_GEO_URN_CORRECTIONS`), so a brief or draft saved before the fix targets the country its label names. An
 * entry whose URN repeats an earlier one once corrected (a stale United Kingdom beside a new one) is dropped. Anything
 * else, including a value that is not a list, is returned as it came. Run where the Implement tab seeds or restores
 * its geos and again by the create route.
 */
export function correctLinkedInGeoTargets<T>(geoTargets: T): T {
  if (!Array.isArray(geoTargets)) return geoTargets;
  const seen = new Set<unknown>();
  const corrected: unknown[] = [];
  for (const target of geoTargets as unknown[]) {
    const record = plainRecord(target);
    const fix = record ? LINKEDIN_GEO_URN_CORRECTIONS.find((c) => c.label === record['label'] && c.from === record['urn']) : undefined;
    const next = fix && record ? { ...record, urn: fix.to } : target;
    const urn = plainRecord(next)?.['urn'];
    if (typeof urn === 'string') {
      if (seen.has(urn)) continue;
      seen.add(urn);
    }
    corrected.push(next);
  }
  return corrected as T;
}
