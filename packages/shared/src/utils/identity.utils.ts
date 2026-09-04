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

/**
 * The single LF username shared by a group of rows, or `null` when the group does not agree on one.
 *
 * The Org Lens governance tables group people by email and take the first row's values for the
 * header, so a group is not guaranteed to be one human. Picking the first username found would let a
 * group whose rows disagree resolve one person's identity while displaying another's name — and the
 * drawer would then show that person's real email addresses under someone else's heading. That is the
 * misattribution the whole company-address feature exists to help administrators detect, so it must
 * not be introduced by the lookup itself.
 *
 * Agreement means EVERY row carries the same username. A row with no username is a disagreement, not
 * an abstention: `[null, 'bob']` is a group whose header may well be Alice's row, and resolving it to
 * Bob would show Bob's addresses under Alice's name. Skipping such rows would reintroduce exactly the
 * misattribution this helper exists to prevent, so an incomplete group fails closed — the caller
 * passes no identity and the panel says it cannot resolve addresses from this view.
 */
export function agreedUsername(usernames: readonly (string | null | undefined)[]): string | null {
  // An empty group agrees on nothing.
  if (usernames.length === 0) {
    return null;
  }

  const distinct = new Set<string>();

  for (const raw of usernames) {
    const normalized = raw?.trim().toLowerCase();
    // A missing username makes the group unresolvable: we cannot tell whether this row is the same
    // human as the rows that do carry one.
    if (!normalized) {
      return null;
    }
    distinct.add(normalized);
  }

  if (distinct.size !== 1) {
    return null;
  }

  // Return the original casing of the agreed value, since the lookup key is matched as stored.
  const agreed = [...distinct][0];
  return usernames.find((u) => u?.trim().toLowerCase() === agreed)?.trim() ?? null;
}
