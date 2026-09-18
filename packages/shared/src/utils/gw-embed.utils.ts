// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_EMBED_ALLOWED_PROJECT_SLUGS, GW_EMBED_ROUTE_PREFIX, GW_EMBED_ROUTE_PREFIXES, GW_EMBED_STORAGE_KEY_SUFFIX } from '../constants/gw-embed.constants';
import { sha256Hex } from './sha256.utils';

/**
 * Picks the prefix the given path is mounted under.
 *
 * Falls back to the Foundation Lens prefix so a caller always gets a usable basename, which keeps
 * the embed mountable from a test or a future route without special-casing.
 *
 * Lives here rather than beside the constants it reads: constants files export runtime values
 * only, and a pure function belongs in `utils/` per the shared package's own layout rules.
 */
export function resolveGwEmbedRoutePrefix(pathname: string): string {
  // Anchored on a segment boundary, not a bare startsWith: a future `/project/gwidgets` would
  // otherwise resolve to the `/project/gw` basename and have its links built under the wrong mount.
  // server.ts guards the `/api/gw` mount the same way, for the same reason.
  //
  // `/project/gwidgets` rather than `/foundation/gwidgets` deliberately — the foundation case does
  // not distinguish the two implementations. A bare startsWith resolves it to `/foundation/gw`, and
  // so does the anchored version, via the GW_EMBED_ROUTE_PREFIX fallback below. Only the second
  // prefix makes the difference observable.
  return GW_EMBED_ROUTE_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ?? GW_EMBED_ROUTE_PREFIX;
}

/**
 * Whether the embed may be shown for a given project/foundation slug.
 *
 * Fails CLOSED on an absent slug. A missing context is not evidence that the context is AAIF, and
 * showing the embed while the host does not know which project it is in is precisely the case that
 * renders the wrong tenant's data under the wrong brand.
 */
export function isGwEmbedAllowedForSlug(slug: string | null | undefined): boolean {
  return !!slug && (GW_EMBED_ALLOWED_PROJECT_SLUGS as readonly string[]).includes(slug);
}

/**
 * Scopes the embed's session storage to one LFX identity.
 *
 * The suffix used to be the bare `GW_EMBED_STORAGE_KEY_SUFFIX` constant, which isolated the
 * embedded session from a standalone Gatewaze session on the same origin but was otherwise
 * browser-wide. That is a cross-user leak on any shared browser: LFX logout does not clear
 * `localStorage`, `hasUsableStoredSession()` checks only token and expiry, and the LFX-vs-Gatewaze
 * email comparison runs only in `adoptAuthFragment` — i.e. only for a fragment arriving from a
 * sign-in, never for a session already sitting in storage. So the next LFX user to open the embed
 * on that browser mounted it holding the PREVIOUS user's Gatewaze token, and composed and sent
 * newsletters as them.
 *
 * Deriving the suffix from the subject claim fixes it at the source: a session stored for one
 * identity is not addressable by another, so the successor simply finds nothing and signs in
 * normally. No clearing, no logout hook to keep in sync, and nothing to get wrong on a path that
 * only runs when someone has already switched accounts.
 *
 * Returns the bare constant when no identity is known, which is the unauthenticated case — there
 * is no session to protect, and the embed still needs a usable key.
 *
 * The subject is hashed rather than embedded: `localStorage` keys are readable by any script on
 * the origin, and an Auth0 `sub` is a durable account identifier.
 *
 * SHA-256 rather than the 32-bit FNV-1a this used first. FNV-1a separated keys correctly and the
 * cross-user leak above was already closed by it, but its collision space is small enough to reason
 * about: two subjects colliding in 32 bits puts the second user back on the first user's key, which
 * is the exact failure this function exists to prevent. The birthday bound there is roughly 2^16
 * distinct identities on ONE browser profile — unreachable in practice, and not a bound worth
 * carrying when the alternative is a digest whose collision probability is negligible outright. A
 * shared or kiosk profile is precisely where both the identity count and the cost of being wrong
 * are highest.
 *
 * Still not authentication: the digest keeps two identities off each other's keys, and the session
 * behind the key is validated on its own merits.
 *
 * Changing the derivation orphans any session stored under the old suffix. That costs a pilot user
 * one sign-in and nothing else — the stale entry is unreadable rather than wrong, which is the same
 * outcome as a first visit.
 */
export function buildGwEmbedStorageSuffix(subject: string | null | undefined): string {
  if (!subject) {
    return GW_EMBED_STORAGE_KEY_SUFFIX;
  }

  return `${GW_EMBED_STORAGE_KEY_SUFFIX}_${sha256Hex(subject)}`;
}
