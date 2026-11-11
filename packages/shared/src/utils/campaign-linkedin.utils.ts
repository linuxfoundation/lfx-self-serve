// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CHAR_LIMITS, LINKEDIN_TARGETING_PROFILE_ALIASES } from '../constants/campaign.constants';
import type { LinkedInTargetingProfile, LinkedInTargetingProfileConfig, LinkedInTargetingRemovals } from '../interfaces/campaign.interface';

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
 * The selected profile's facets with the operator's removals taken out, in the profile's own order.
 * A removal naming a URN the profile does not carry is ignored, so a draft restored after the
 * ConfigMap changed cannot hide an entry it never saw.
 */
export function linkedInTargetingAfterRemovals(profile: LinkedInTargetingProfileConfig, removals: LinkedInTargetingRemovals): LinkedInTargetingRemovals {
  return {
    skills: profile.skills.filter((urn) => !removals.skills.includes(urn)),
    groups: profile.groups.filter((urn) => !removals.groups.includes(urn)),
  };
}
