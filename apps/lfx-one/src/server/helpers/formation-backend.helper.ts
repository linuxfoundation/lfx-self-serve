// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The single swap point for the real `lfx-v2-formation-service` (GH-2267/#1957). `true` when either
 * a formation-only base-URL override is configured (`LFX_V2_FORMATION_SERVICE`, e.g. pointing the
 * BFF at dev while everything else still talks to prod) or the operator opts in explicitly
 * (`FORMATION_BACKEND=live`). Both are env-driven rather than a hardcoded flip so the same build can
 * be pointed at either backend per-environment.
 *
 * This is the **only** switch — every formation read and mutation
 * (`getProjectFormation`/`getFormationsQueue`/`completeFormationItem`/`skipFormationItem`/
 * `requestFormationItem`/`updateFormationItem`/`updateFormationItemStatus`) branches on it. Per
 * Phase 7 of GH-2267, this stays the single documented switch for a staged cutover; if no staged
 * rollout turns out to be needed, delete this helper entirely and call the real proxy directly.
 *
 * No `NODE_ENV==='production'` hard-block (unlike the mock-backend precedents `isEngagementMockBackend()`/
 * `WEEKLY_BRIEF_BACKEND`): production isn't "reachable with a misconfigured env var flipping on
 * fabricated data next to real data" — it is the only mode there is right now, and this switch
 * turns the live client on rather than a fixture off.
 */
export function isFormationServiceLive(): boolean {
  return !!process.env['LFX_V2_FORMATION_SERVICE'] || process.env['FORMATION_BACKEND'] === 'live';
}
