// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_PROXY_DEFAULT_MAX_BODY_BYTES, GW_PROXY_DEFAULT_TIMEOUT_MS } from '@lfx-one/shared/constants';

/**
 * Reads a positive-integer env override, falling back to the compiled default.
 *
 * Both limits on the `/api/gw` proxy are per-environment concerns: #2263 asks for them as
 * deployment variables so a slow upstream or a larger media ceiling can be accommodated without a
 * code change and an image promotion. They were compiled-in constants, which meant neither could be
 * tuned at all.
 *
 * Invalid values fall back rather than throwing. These are read on the request path, and a typo in
 * one tuning knob should not take the route down — the default is a known-good value, and the
 * misconfiguration is visible because the env var plainly does not match observed behaviour.
 * Rejecting zero and negatives matters more than rejecting nonsense: `0` would make every request
 * time out instantly or every body too large, which looks like an outage rather than a setting.
 *
 * Read per call rather than captured at module load, matching `isServerFeatureEnabled` — a running
 * process's environment cannot change from outside, so this buys testability rather than dynamism.
 *
 * Both callers honour that. The body cap briefly did not: it was a constructor default parameter on
 * a controller the route module instantiates at import time, so the env var was read once for the
 * life of the process while the timeout was read per request. Same stated contract, two behaviours,
 * and nothing that would have failed if either changed.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/** How long a proxied upstream request may take before it is aborted, in ms. */
export function getGwProxyTimeoutMs(): number {
  return readPositiveIntEnv('GW_PROXY_TIMEOUT_MS', GW_PROXY_DEFAULT_TIMEOUT_MS);
}

/** Ceiling on a proxied request body, in bytes. */
export function getGwProxyMaxBodyBytes(): number {
  return readPositiveIntEnv('GW_PROXY_MAX_BODY_BYTES', GW_PROXY_DEFAULT_MAX_BODY_BYTES);
}
