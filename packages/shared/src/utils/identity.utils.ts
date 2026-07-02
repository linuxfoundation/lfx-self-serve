// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Strict `local@host.tld` shape detection. Used to distinguish email vs
 * username CDP identity values when the platform doesn't carry that
 * information (legacy CDP rows without a `type` field). The platform
 * default (e.g. CDP_PLATFORM_TO_TYPE_MAP) is intentionally not consulted
 * here — POST defaults reflect what Auth0 gives us, not a guarantee about
 * what is stored in any given row.
 *
 * The middle character class excludes `.` so the greedy `+` deterministically
 * stops at the first dot in the host portion, eliminating the polynomial
 * backtracking that would otherwise occur on pathological inputs like
 * `x@x.x.x.x.…`. The trailing class still allows `.` so the TLD/subdomain
 * tail (e.g. `co.uk`, `users.noreply.github.com`) can contain dots.
 */
export const EMAIL_SHAPE_REGEX = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Returns true if the value matches a strict `local@host.tld` email shape
 * after trimming surrounding whitespace.
 */
export function isEmailShape(value: string): boolean {
  return EMAIL_SHAPE_REGEX.test(value.trim());
}

/**
 * Case-insensitive substrings that mark an upstream identity-link / email
 * verification failure caused by the identity already belonging to another
 * account. The auth-service phrases this conflict differently per endpoint —
 * "email already linked" from the email send-code check, and "the provided
 * identity token belongs to an existing LFID account and cannot be linked" from
 * the identity-link call — so we match on any known marker rather than a single
 * word (grepping for "already" alone misses the social/link phrasing).
 */
const IDENTITY_ALREADY_LINKED_MARKERS = ['already linked', 'belongs to an existing', 'existing lfid account'];

/**
 * Returns true if any of the provided upstream error/message strings indicate the
 * identity (email or social) is already linked to another account.
 */
export function isIdentityAlreadyLinkedError(...texts: (string | undefined | null)[]): boolean {
  return texts.some((text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return IDENTITY_ALREADY_LINKED_MARKERS.some((marker) => lower.includes(marker));
  });
}
