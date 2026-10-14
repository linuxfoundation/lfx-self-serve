// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Upstream } from '@gatewaze/host-session';
import { Request } from 'express';

/** Gatewaze API module routes: `/api/modules/<id>/...` (the API mounts each module's router there). */
const API_MODULE_PATH = /^\/api\/modules\/([^/]+)(?:\/|$)/;

/**
 * The Gatewaze module a proxied request belongs to, or null for a platform path that every embed
 * admin uses. `pathname` is the normalised upstream path from `upstreamUrl`, so dot segments are
 * already resolved.
 *
 * Today only the Gatewaze API's `/api/modules/<id>` routes map to a module. Supabase paths (tables,
 * storage buckets, edge functions) answer null; mapping them is part of the entitlement follow-up.
 */
export function gatewazeModuleForPath(upstream: Upstream, pathname: string): string | null {
  if (upstream.supabase) {
    return null;
  }
  const match = API_MODULE_PATH.exec(pathname);
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
 * It allows everything for now. A follow-up enforces LFX-permission-based module entitlements here,
 * so the proxy itself does not change when it lands. Resolves false to refuse with 403.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the follow-up's signature, unused until it enforces entitlements
export async function authorizeGatewazeModule(_req: Request, _moduleId: string): Promise<boolean> {
  return true;
}
