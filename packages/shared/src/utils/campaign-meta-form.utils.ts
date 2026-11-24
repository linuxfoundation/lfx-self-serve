// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  META_DEFAULT_PLACEMENTS,
  META_DSA_NAME_MAX_LENGTH,
  META_DSA_TERRITORIES,
  META_INELIGIBLE_COUNTRIES,
  META_NUMERIC_ID_PATTERN,
  META_SELECTABLE_PLACEMENTS,
  normalizeGeoTargets,
} from '../constants/campaign.constants';
import type {
  CampaignBriefOutput,
  MetaBriefSeed,
  MetaCampaignCreateRequest,
  MetaCreateRefusalInput,
  MetaInstagramDsaInput,
  MetaObjective,
  MetaPlacement,
} from '../interfaces/campaign.interface';

/**
 * The Meta create form's rules on the Implement tab (#5980, approach 4): geo, placements, pixel, and the
 * Instagram account and EU DSA disclosures. Pure, so their full input matrix is tested here; the
 * component reads them through its signals and keeps only wiring tests.
 */

/** Whether Meta will not target `code`. Matched after trim and upper-casing, as the chip input receives it raw. */
export function metaGeoIsIneligible(code: string): boolean {
  return META_INELIGIBLE_COUNTRIES.has(code.trim().toUpperCase());
}

/**
 * `codes` normalised through the shared `normalizeGeoTargets` (shape, ISO assignment, de-dupe) minus the
 * countries Meta will not target. The same rule on every write, so a chip the operator sees is a chip the
 * request buys.
 */
export function metaAcceptedGeos(codes: readonly string[]): string[] {
  return normalizeGeoTargets(codes).filter((c) => !META_INELIGIBLE_COUNTRIES.has(c));
}

/**
 * The geo list a Meta create actually sends: the eligible chips, or else the eligible `countryCode`.
 * Empty means nothing usable was supplied; Create blocks on it rather than letting the server pick a
 * country (it would pick `US`).
 */
export function metaEffectiveGeoTargets(chips: readonly string[], countryCode: string): string[] {
  const eligibleChips = metaAcceptedGeos(chips);
  if (eligibleChips.length > 0) return eligibleChips;
  return metaAcceptedGeos([countryCode]);
}

/** The targeted countries that make Meta require the EU DSA disclosures, in request order. */
export function metaDsaCountries(geos: readonly string[]): string[] {
  return geos.filter((c) => META_DSA_TERRITORIES.has(c));
}

/** Whether `key` is one the operator may toggle; `messengerInbox` is not, as campaign-service rejects it. */
export function metaPlacementIsSelectable(key: keyof MetaPlacement): boolean {
  return META_SELECTABLE_PLACEMENTS.includes(key);
}

/**
 * Whether at least one SELECTABLE placement is on. Mirrors campaign-service's `buildPlacementTargeting`,
 * which refuses an empty `publisher_platforms`; `messengerInbox` cannot contribute one, so it does not count.
 */
export function metaHasPlacement(placements: MetaPlacement): boolean {
  return META_SELECTABLE_PLACEMENTS.some((key) => placements[key]);
}

/** Whether the ad set runs on Instagram: Feed, Stories or Reels, the placements campaign-service maps there (`meta.UsesInstagram`). */
export function metaUsesInstagram(placements: MetaPlacement): boolean {
  return placements.instagramFeed || placements.stories || placements.reels;
}

/**
 * The placement entries that differ from `META_DEFAULT_PLACEMENTS`: campaign-service merges the overrides
 * over the same defaults, so that is all the payload needs. `messengerInbox` is `false` in the defaults and
 * never set, so it never appears.
 */
export function metaPlacementOverrides(placements: MetaPlacement): Partial<MetaPlacement> {
  const overrides: Partial<MetaPlacement> = {};
  for (const key of Object.keys(placements) as (keyof MetaPlacement)[]) {
    if (placements[key] !== META_DEFAULT_PLACEMENTS[key]) overrides[key] = placements[key];
  }
  return overrides;
}

/** Whether the pixel applies: only `conversions` carries a promoted pixel object. */
export function metaRequiresPixel(objective: MetaObjective): boolean {
  return objective === 'conversions';
}

/**
 * Whether the pixel id is acceptable for `objective`: always when none is required (a stale value is not
 * sent), else non-empty and numeric after trimming, the two checks campaign-service's `buildPromotedObject`
 * applies before any mutating call.
 */
export function metaPixelValid(objective: MetaObjective, pixelId: string): boolean {
  if (!metaRequiresPixel(objective)) return true;
  const trimmed = pixelId.trim();
  return trimmed !== '' && META_NUMERIC_ID_PATTERN.test(trimmed);
}

/**
 * The `pixelId` key a create carries: only under `conversions`, trimmed as upstream trims. Under any other
 * objective the promoted object is a page id or nothing, so a stale id left in the box is not sent.
 */
export function metaPixelField(objective: MetaObjective, pixelId: string): Pick<MetaCampaignCreateRequest, 'pixelId'> {
  return metaRequiresPixel(objective) ? { pixelId: pixelId.trim() } : {};
}

/**
 * Why the Instagram account id cannot be sent, or `null`. Required only when the capability is on AND an
 * Instagram placement is on (Meta creates the ad without it but will not publish it); numeric after
 * trimming, as campaign-service's `numericIDRE` requires.
 */
export function metaInstagramUserIdError(available: boolean, usesInstagram: boolean, instagramUserId: string): string | null {
  if (!available || !usesInstagram) return null;
  const id = instagramUserId.trim();
  if (id === '') return 'An Instagram account ID is required for the Instagram placements. Enter it, or turn off Instagram Feed, Stories and Reels.';
  if (!META_NUMERIC_ID_PATTERN.test(id)) return 'The Instagram account ID must be numeric.';
  return null;
}

/**
 * Why one EU DSA disclosure cannot be sent, or `null` while the capability is off. Mirrors campaign-service's
 * `CheckPublishIdentity`: at most `META_DSA_NAME_MAX_LENGTH` code points (Go counts runes, so no native
 * `maxlength`), no C0/C1 control, line/paragraph separator or bidi control, and present whenever the other
 * one is OR an EU/EEA country is targeted. Both values are trimmed first, as upstream trims.
 */
export function metaDsaFieldError(available: boolean, value: string, other: string, dsaCountries: readonly string[]): string | null {
  if (!available) return null;
  const trimmed = value.trim();
  if ([...trimmed].length > META_DSA_NAME_MAX_LENGTH) return `Enter at most ${META_DSA_NAME_MAX_LENGTH} characters.`;
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(trimmed))
    return 'Enter the name on one line, without tabs, line breaks or invisible formatting characters.';
  if (trimmed !== '') return null;
  if (dsaCountries.length > 0) return `Required when targeting the EU/EEA (${dsaCountries.join(', ')}).`;
  if (other.trim() !== '') return 'Enter both the beneficiary and the payor, or neither.';
  return null;
}

/**
 * The three keys a create adds to `metaConfig`, or none while the capability is off. The Instagram id only
 * for an Instagram placement; the disclosures only as a pair (Create has already blocked a one-sided state).
 */
export function metaInstagramDsaFields(
  available: boolean,
  usesInstagram: boolean,
  input: MetaInstagramDsaInput
): Pick<MetaCampaignCreateRequest, 'instagramUserId' | 'dsaBeneficiary' | 'dsaPayor'> {
  if (!available) return {};
  const instagramUserId = input.instagramUserId.trim();
  const dsaBeneficiary = input.dsaBeneficiary.trim();
  const dsaPayor = input.dsaPayor.trim();
  return {
    ...(usesInstagram && instagramUserId !== '' ? { instagramUserId } : {}),
    ...(dsaBeneficiary !== '' && dsaPayor !== '' ? { dsaBeneficiary, dsaPayor } : {}),
  };
}

/**
 * Whether the restored `objective` is one the picker no longer offers (today only `leads` without lead
 * forms). The tab renders it as a disabled option so the screen and the payload agree.
 */
export function metaObjectiveIsUnavailable(options: readonly MetaObjective[], objective: MetaObjective): boolean {
  return !options.includes(objective);
}

/**
 * What a brief seeds the Meta section with, or `null` when it carries no Meta copy. The AI's
 * `structuredCopy.meta_ads` (snake_case, untyped JSON) wins over the typed `metaCopy`; geos go through
 * {@link metaAcceptedGeos}, so a chip the operator sees is a chip the request buys.
 */
export function metaBriefSeed(brief: Pick<CampaignBriefOutput, 'structuredCopy' | 'metaCopy'>): MetaBriefSeed | null {
  const metaCopy = brief.structuredCopy?.['meta_ads'] as Record<string, unknown> | undefined;
  if (metaCopy) {
    const rawVariants = metaCopy['variants'];
    const variants = Array.isArray(rawVariants) ? (rawVariants as { primary_text?: string; headline?: string; description?: string }[]) : [];
    const rawGeos = metaCopy['recommended_geos'];
    return {
      variants: variants.map((v) => ({ primaryText: v.primary_text ?? '', headline: v.headline ?? '', description: v.description })),
      geoTargets: metaAcceptedGeos(Array.isArray(rawGeos) ? (rawGeos as string[]) : []),
    };
  }
  if (brief.metaCopy) return { variants: brief.metaCopy.variants, geoTargets: metaAcceptedGeos(brief.metaCopy.recommendedGeos) };
  return null;
}

/**
 * Why a Meta create is refused before the per-platform form checks, or `null`: the budget, then a geo
 * list with nothing usable in it (which would let the server default to `US`). Split from
 * {@link metaCreateRefusal} because `createBlockedReason` checks Reddit's budget and geo between the two.
 */
export function metaBasicsRefusal(budgetUsd: number, effectiveGeoTargets: readonly string[]): string | null {
  if (budgetUsd < 1) return 'Meta Ads: set a budget of at least $1.';
  if (effectiveGeoTargets.length === 0) return 'Meta Ads: add a location, or a country code.';
  return null;
}

/** Why the Meta form refuses Create, or `null`. The first failing check wins, in this order. */
export function metaCreateRefusal(input: MetaCreateRefusalInput): string | null {
  if (!input.variants.some((v) => v.primaryText.trim() && v.headline.trim())) return 'Meta Ads: give at least one ad both primary text and a headline.';
  if (!input.hasPlacement) return 'Meta Ads: choose at least one placement.';
  if (!input.pixelValid) return 'Meta Ads: fix the pixel.';
  if (input.instagramDsaInvalid) return 'Meta Ads: fix the Instagram account or the EU disclosure fields.';
  const message =
    input.audienceTargetingBlock ??
    input.audienceTargetingError ??
    input.detailedTargetingBlock ??
    input.detailedTargetingError ??
    input.deliveryBlock ??
    input.deliveryError ??
    input.deviceOsBlock ??
    input.deviceOsError ??
    input.adOptionsBlock ??
    input.adOptionsError ??
    input.leadFormError;
  return message === null ? null : `Meta Ads: ${message}`;
}
