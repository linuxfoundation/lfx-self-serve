// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Upstream } from '@gatewaze/host-session';
import { GW_HOST_SESSION_PROXY_API_MODULE_PATH } from '@lfx-one/shared/constants';
import { Request } from 'express';

/**
 * The Gatewaze module a proxied request belongs to, or null when this function cannot tell.
 * `pathname` is the normalised upstream path from `upstreamUrl`, so dot segments are already
 * resolved.
 *
 * The mapping is incomplete, and null does NOT mean "a platform path". Only the Gatewaze API's
 * `/api/modules/<id>` routes map to a module today. Modules also mount routes elsewhere under
 * `/api` (e.g. `tasks` at `/api/admin/tasks`), and Supabase paths (tables, storage buckets, edge
 * functions) are not mapped at all. The entitlement follow-up must build the mapping from the
 * API's route registry and refuse a path it cannot map, rather than enforce on this subset.
 */
export function gatewazeModuleForPath(upstream: Upstream, pathname: string): string | null {
  if (upstream.supabase) {
    return null;
  }
  const match = GW_HOST_SESSION_PROXY_API_MODULE_PATH.exec(pathname);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding: the raw segment, which no module id matches.
    return match[1];
  }
}

/**
 * The per-module entitlement hook for the `/api/gatewaze` proxy. It runs after the router's LFX
 * gates and before any Gatewaze session is loaded, for every request that `gatewazeModuleForPath`
 * maps to a module.
 *
 * It allows everything for now (#2738 tracks the entitlement follow-up), so it is a seam, not a gate.
 * The follow-up enforces LFX-permission-based module entitlements here, and must also make
 * `gatewazeModuleForPath` complete and fail closed (see its comment). Resolves false to refuse with
 * 403.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the follow-up's signature, unused until it enforces entitlements
export async function authorizeGatewazeModule(_req: Request, _moduleId: string): Promise<boolean> {
  return true;
}
