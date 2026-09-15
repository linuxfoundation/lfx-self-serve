// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_EMBED_ALLOWED_PROJECT_SLUGS, GW_EMBED_ROUTE_PREFIX, GW_EMBED_ROUTE_PREFIXES, GW_EMBED_STORAGE_KEY_SUFFIX } from '../constants/gw-embed.constants';

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
  // Anchored on a segment boundary, not a bare startsWith: a future `/foundation/gwidgets` would
  // otherwise resolve to the `/foundation/gw` basename and have its links built under the wrong
  // mount. server.ts guards the `/api/gw` mount the same way, for the same reason.
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
 * the origin, and an Auth0 `sub` is a durable account identifier. A non-cryptographic hash is
 * enough here — this separates keys, it does not authenticate anything.
 */
export function buildGwEmbedStorageSuffix(subject: string | null | undefined): string {
  if (!subject) {
    return GW_EMBED_STORAGE_KEY_SUFFIX;
  }

  // FNV-1a, 32-bit. Deterministic across reloads, which is the only property that matters.
  let hash = 0x811c9dc5;
  for (let i = 0; i < subject.length; i++) {
    hash ^= subject.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${GW_EMBED_STORAGE_KEY_SUFFIX}_${hash.toString(36)}`;
}
