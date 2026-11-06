// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GOOGLE_ADS_MAX_EXCLUDED_PLACEMENTS, GOOGLE_ADS_MAX_PLACEMENT_DOMAIN_BYTES, googleAdsTrimSpace } from '../constants/campaign.constants';

/**
 * Display placement exclusions (campaign-service v1.0.31, #462): the refusals campaign-service makes
 * on `excludedPlacements` before the budget mutate (`validateExcludedPlacements` in
 * `internal/platform/googleads/display_targeting.go`).
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the
 * create with the same sentence. A refusal names an entry by its position, never by its text: the BFF
 * logs the refusal, and an entry may carry a query or credentials.
 */

/** The characters `validateExcludedPlacements` refuses after the scheme check: a path, query, fragment, port or credentials. */
const NOT_BARE_DOMAIN = /[/?#:@]/;

/**
 * Whether `domain`, already lower-cased ASCII, is a domain name as `placementDomain` reads one: at most
 * 253 bytes, at least two dot-separated labels, each 1 to 63 of `a-z`, `0-9` and `-` with no hyphen at
 * either end, and a last label that is not all digits (that would be an IPv4 literal, `numericID`).
 */
function placementDomain(domain: string): boolean {
  if (domain.length > GOOGLE_ADS_MAX_PLACEMENT_DOMAIN_BYTES) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-'))) return false;
  return !/^[0-9]+$/.test(labels[labels.length - 1]);
}

/**
 * Why campaign-service would refuse this `excludedPlacements` list, or `null`, in its order: a value
 * that is not a list of strings (Go's decode into `[]string`), the count over
 * `GOOGLE_ADS_MAX_EXCLUDED_PLACEMENTS` on the list as sent, then each entry trimmed as Go's
 * `strings.TrimSpace` trims it: blank, a scheme (`://`, refused rather than stripped), a path, query,
 * fragment, port or credentials, a character outside ASCII (an international domain is written in its
 * `xn--` form), and a name that is not a domain. A repeat is not refused: upstream folds case and
 * sends each domain once.
 */
export function googleExcludedPlacementsRefusal(placements: unknown): string | null {
  if (!Array.isArray(placements) || placements.some((entry) => typeof entry !== 'string')) {
    return 'Google Ads placement exclusions must be a list of website domains.';
  }
  if (placements.length > GOOGLE_ADS_MAX_EXCLUDED_PLACEMENTS) {
    return `A Display campaign takes at most ${GOOGLE_ADS_MAX_EXCLUDED_PLACEMENTS} placement exclusions, and ${placements.length} are set. Remove ${placements.length - GOOGLE_ADS_MAX_EXCLUDED_PLACEMENTS} and create again.`;
  }
  for (const [index, raw] of (placements as string[]).entries()) {
    const position = index + 1;
    const entry = googleAdsTrimSpace(raw);
    if (entry === '') return `Placement exclusion ${position} is blank. Enter a domain such as example.com, or remove it.`;
    if (entry.includes('://')) {
      return `Placement exclusion ${position} starts with a scheme such as https://. Enter the bare domain, such as example.com; Google Ads does not strip it for you.`;
    }
    if (NOT_BARE_DOMAIN.test(entry)) {
      return `Placement exclusion ${position} must be a bare domain such as example.com, with no path, query, fragment, port or sign-in details.`;
    }
    // Checked before case is folded, as upstream checks it: lower-casing maps some non-ASCII characters
    // (the Kelvin sign) to ASCII letters, which would turn the entry into a different domain.
    if ([...entry].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f)) {
      return `Placement exclusion ${position} is not plain ASCII. Write an international domain in its xn-- form.`;
    }
    if (!placementDomain(entry.toLowerCase())) {
      return `Placement exclusion ${position} is not a domain name. Use letters, digits and hyphens in at least two dot-separated parts, with a last part that is not all digits, no trailing dot and at most ${GOOGLE_ADS_MAX_PLACEMENT_DOMAIN_BYTES} characters.`;
    }
  }
  return null;
}
