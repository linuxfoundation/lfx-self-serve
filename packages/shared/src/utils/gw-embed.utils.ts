// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_EMBED_ALLOWED_PROJECT_SLUGS, GW_EMBED_ROUTE_PREFIX, GW_EMBED_ROUTE_PREFIXES } from '../constants/gw-embed.constants';

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
  // `isGwProxyPath` guards the `/api/gatewaze` mount the same way, for the same reason.
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
