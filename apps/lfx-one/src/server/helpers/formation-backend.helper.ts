// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * TODO(#1957): the single swap point for the real `lfx-v2-formation-service`. Currently hardcoded
 * `false` — there is no live backend to switch to yet, unlike `isEngagementMockBackend()`/
 * `WEEKLY_BRIEF_BACKEND`, which stand in for a real backend that already exists and is only being
 * bypassed as an explicit opt-in. Deliberately NOT an env-var pair
 * (`FORMATION_BACKEND=mock|live`): a `live` value would name a target that doesn't exist, inviting
 * someone to "fix" it into pointing at a service that isn't ready. Once #1957 ships, either flip
 * this to a real env-var/feature-flag-driven check (if a staged cutover is needed) or delete it and
 * call the real proxy directly if no staged rollout is required. Today only `getProjectFormation`
 * actually branches on this function; `getFormationsQueue` and the mutating methods in
 * `formation.service.ts` always touch the in-memory fixture store (see their own
 * `// TODO(#1957)` comments there), so the swap is not yet fully contained here — extending it to
 * those methods is part of #1957.
 *
 * No `NODE_ENV==='production'` hard-block either (unlike the mock-backend precedents): production
 * isn't "reachable with a misconfigured env var flipping on fabricated data next to real data," it
 * is the only mode there is right now. Both read endpoints (`getProjectFormation`,
 * `getFormationsQueue`) label their response bodies `data_source: 'fixture'`; every mutating
 * method in `formation.service.ts` (`completeFormationItem`, `skipFormationItem`,
 * `requestFormationItem`, `updateFormationItem`) carries its own `// TODO(#1957)` comment instead,
 * since it only ever touches the in-memory fixture store, never a real record. Formation fixture
 * data is synthetic end-to-end — there's no real-identity-plus-fake-numbers juxtaposition risk to
 * guard against the way `isEngagementMockBackend()` does.
 */
export function isFormationServiceLive(): boolean {
  return false;
}
