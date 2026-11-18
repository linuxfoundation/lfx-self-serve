// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CHAR_LIMITS, LINKEDIN_TARGETING_PROFILE_ALIASES } from '../constants/campaign.constants';
import type {
  LinkedInTargetingProfile,
  LinkedInTargetingFacets,
  LinkedInTargetingProfileConfig,
  LinkedInTargetingRemovals,
} from '../interfaces/campaign.interface';

/**
 * LinkedIn ad copy as campaign-service sends it: trimmed, em and en dashes turned into commas, then
 * trimmed again. The client-side mirror of `normalizeCreativeText` and `stripDashes`
 * (`internal/platform/linkedin/client.go`), which both the empty-copy check and the length cut run on.
 */
export function normalizeLinkedInCreativeText(text: string): string {
  let stripped = goTrimSpace(text).replaceAll(' — ', ', ').replaceAll(' – ', ', ').replaceAll('—', ', ').replaceAll('–', ', ');
  // Go's TrimPrefix and TrimSuffix: one ", " off each end, at most.
  if (stripped.startsWith(', ')) stripped = stripped.slice(2);
  if (stripped.endsWith(', ')) stripped = stripped.slice(0, -2);
  return goTrimSpace(stripped);
}

/**
 * Go's `strings.TrimSpace`: trims the Unicode White_Space set `unicode.IsSpace` reads. JavaScript's
 * `trim()` differs both ways (it keeps U+0085 and drops U+FEFF), which would let copy through that
 * campaign-service then blanks or cuts.
 */
function goTrimSpace(text: string): string {
  // An index scan rather than an anchored regex, whose trailing `[…]+$` backtracks polynomially on a
  // long run of spaces (CodeQL js/polynomial-redos).
  let start = 0;
  let end = text.length;
  while (start < end && isGoSpace(text.charCodeAt(start))) start++;
  while (end > start && isGoSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** `unicode.IsSpace`: tab through carriage return, space, U+0085, U+00A0, and the rest of Unicode White_Space. */
function isGoSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/**
 * The length campaign-service measures LinkedIn copy by: code points (Go runes) of the normalized
 * text. A dash counts as the two characters ", " it becomes.
 */
export function linkedInCreativeTextLength(text: string): number {
  return Array.from(normalizeLinkedInCreativeText(text)).length;
}

/**
 * Why a LinkedIn variant's intro text or headline cannot be sent, or `null` when it can.
 *
 * campaign-service refuses a variant whose copy is empty after normalization before anything is
 * created, and cuts longer copy to `LINKEDIN_CHAR_LIMITS` without saying so (`CreateCampaign` and
 * `createDarkPost`, `internal/platform/linkedin/client.go`). Both are refused here instead.
 */
export function linkedInVariantTextError(field: 'introText' | 'headline', text: string): string | null {
  const label = field === 'introText' ? 'intro text' : 'headline';
  const length = linkedInCreativeTextLength(text);
  if (length === 0) return `Enter the ${label}.`;
  const limit = LINKEDIN_CHAR_LIMITS[field];
  if (length > limit) return `The ${label} is ${length} characters, over LinkedIn's ${limit}. Shorten it.`;
  return null;
}

/** The configured profile id campaign-service reads the facets of for a selection (`custom` reads `cloud-native`). */
export function resolveLinkedInTargetingProfileId(profile: LinkedInTargetingProfile): LinkedInTargetingProfile {
  return LINKEDIN_TARGETING_PROFILE_ALIASES[profile] ?? profile;
}

/**
 * The selected profile's facets that are KEPT once the operator's removals are taken out, in the
 * profile's own order. An empty list here means everything was removed.
 * A removal naming a URN the profile does not carry is ignored, so a draft restored after the
 * ConfigMap changed cannot hide an entry it never saw.
 */
export function linkedInTargetingAfterRemovals(profile: LinkedInTargetingProfileConfig, removals: LinkedInTargetingRemovals): LinkedInTargetingFacets {
  return {
    skills: profile.skills.filter((urn) => !removals.skills.includes(urn)),
    groups: profile.groups.filter((urn) => !removals.groups.includes(urn)),
  };
}

/**
 * A US-dollar amount rounded to whole cents exactly as campaign-service puts it on the wire:
 * `strconv.FormatFloat(x, 'f', 2, 64)`, which rounds the double's EXACT decimal value and breaks an
 * exact tie to the even cent. `Math.round(x * 100) / 100` disagrees on such ties — 100.125 (exact in
 * binary) is 100.12 in Go but 100.13 that way — so a limit judged with it can pass here and be refused
 * upstream (#5774).
 *
 * `toFixed(60)` spells out the exact binary value of any amount from $1 up to 2^53 (such a double
 * carries at most 52 fractional bits, so at most 52 decimal places), and the tie is then decided on
 * that exact expansion. Below $1 the expansion can be cut short, which only matters for amounts every
 * caller already refuses (LinkedIn's minimums are $10 and up). Non-finite input is returned unchanged for the caller to refuse.
 */
export function roundUsdToCentsLikeGo(amount: number): number {
  if (!Number.isFinite(amount)) return amount;
  if (Math.abs(amount) >= 1e15) return Math.round(amount * 100) / 100;
  const sign = amount < 0 ? -1 : 1;
  const [whole, fraction] = Math.abs(amount).toFixed(60).split('.');
  let cents = BigInt(whole + fraction.slice(0, 2));
  const rest = fraction.slice(2);
  const firstDropped = rest.charCodeAt(0) - 48;
  const restAfterFirstIsZero = /^0*$/.test(rest.slice(1));
  if (firstDropped > 5 || (firstDropped === 5 && !restAfterFirstIsZero) || (firstDropped === 5 && restAfterFirstIsZero && cents % 2n === 1n)) {
    cents += 1n;
  }
  return (sign * Number(cents)) / 100;
}
