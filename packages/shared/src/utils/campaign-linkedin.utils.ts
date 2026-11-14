// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CALLS_TO_ACTION, LINKEDIN_CHAR_LIMITS, LINKEDIN_TARGETING_PROFILE_ALIASES } from '../constants/campaign.constants';
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

/**
 * A LinkedIn creative name as campaign-service sends it: every run of whitespace collapsed to one
 * space and the ends trimmed — `strings.Join(strings.Fields(name), " ")` in `normalizeCreativeName`
 * (`internal/platform/linkedin/variants.go`). Dashes are kept, unlike ad copy. `''` means no name.
 */
export function normalizeLinkedInCreativeName(name: string): string {
  const words: string[] = [];
  let word = '';
  for (let i = 0; i < name.length; i++) {
    if (isGoSpace(name.charCodeAt(i))) {
      if (word !== '') words.push(word);
      word = '';
    } else {
      word += name[i];
    }
  }
  if (word !== '') words.push(word);
  return words.join(' ');
}

/** A creative name's length as campaign-service measures it: code points of the normalized name. */
export function linkedInCreativeNameLength(name: string): number {
  return Array.from(normalizeLinkedInCreativeName(name)).length;
}

/**
 * Why each LinkedIn variant's creative name cannot be sent, by index (`''` when it can), for the
 * names as typed and the event the campaign is for.
 *
 * campaign-service cuts a name longer than `LINKEDIN_CHAR_LIMITS.name` without saying so, and
 * refuses two variants whose creative names match once normalized — including a typed name equal
 * to an unnamed variant's `"<event> | variant-N"` default (`ValidateVariantFields` and
 * `distinctCreativeNames`, `internal/platform/linkedin/variants.go`). Both are refused here instead,
 * against the variant that repeats the other. A blank name is never an error: it keeps the default.
 */
export function linkedInVariantNameErrors(names: readonly string[], eventName: string): string[] {
  const limit = LINKEDIN_CHAR_LIMITS.name;
  const resolved = names.map((name, i) => {
    const normalized = normalizeLinkedInCreativeName(name);
    return normalized === '' ? `${eventName} | variant-${i + 1}` : normalized;
  });
  return names.map((name, i) => {
    const normalized = normalizeLinkedInCreativeName(name);
    if (normalized === '') return '';
    const length = Array.from(normalized).length;
    if (length > limit) return `The name is ${length} characters, over LinkedIn's ${limit}. Shorten it.`;
    const earlier = resolved.findIndex((other, j) => j < i && other === resolved[i]);
    if (earlier !== -1) return `This name repeats variant ${earlier + 1}'s. Give each variant its own name.`;
    const defaulted = resolved.findIndex((other, j) => j > i && normalizeLinkedInCreativeName(names[j]) === '' && other === resolved[i]);
    if (defaulted !== -1) return `This name is variant ${defaulted + 1}'s default name. Give each variant its own name.`;
    return '';
  });
}

/**
 * Why a LinkedIn variant's article description cannot be sent, or `null` when it can. Blank is
 * fine (no description); longer than `LINKEDIN_CHAR_LIMITS.description` once normalized like the
 * intro text is refused, since campaign-service would cut it (`normalizeDescription`).
 */
export function linkedInVariantDescriptionError(description: string): string | null {
  const length = linkedInCreativeTextLength(description);
  const limit = LINKEDIN_CHAR_LIMITS.description;
  if (length > limit) return `The description is ${length} characters, over LinkedIn's ${limit}. Shorten it.`;
  return null;
}

/** Whether a value is one of `LINKEDIN_CALLS_TO_ACTION`'s, matched exactly as campaign-service matches it. `''` (none) is not. */
export function isLinkedInCallToAction(value: string): boolean {
  return LINKEDIN_CALLS_TO_ACTION.some((option) => option.value === value);
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
