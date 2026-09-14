// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_EMBED_ROUTE_PREFIX, GW_EMBED_ROUTE_PREFIXES } from '../constants/gw-embed.constants';

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
