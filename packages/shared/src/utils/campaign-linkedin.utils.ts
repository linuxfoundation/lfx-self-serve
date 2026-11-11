// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_CHAR_LIMITS } from '../constants/campaign.constants';

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
  return text.replace(
    /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/g,
    ''
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
