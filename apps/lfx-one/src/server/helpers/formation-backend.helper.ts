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
 * call the real proxy directly if no staged rollout is required — every call site in
 * `formation.service.ts` already branches on this function, so the swap is contained here.
 *
 * No `NODE_ENV==='production'` hard-block either (unlike the mock-backend precedents): production
 * isn't "reachable with a misconfigured env var flipping on fabricated data next to real data," it
 * is the only mode there is right now. The two read endpoints (`getProjectFormation`,
 * `getFormationsQueue`) label their response bodies `data_source: 'fixture'`; the mutation
 * endpoints don't carry that field today but only ever touch the in-memory fixture store, never a
 * real record — see `formation.service.ts`'s per-method `// TODO(#1957)` comments. Formation
 * fixture data is synthetic end-to-end — there's no real-identity-plus-fake-numbers juxtaposition
 * risk to guard against the way `isEngagementMockBackend()` does.
 */
export function isFormationServiceLive(): boolean {
  return false;
}
