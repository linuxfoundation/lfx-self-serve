// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { LensService } from '../services/lens.service';

/**
 * Route guard for flat module routes (e.g. `/meetings`, `/groups`) that redirects
 * the user to the lens-prefixed equivalent (`/foundation/...` or `/project/...`)
 * when foundation or project lens is active. Lets the request through unchanged
 * for `me` and `org` lenses, where the flat routes are the canonical destination.
 * Carve-out: ENRICHED meeting EDIT links bypass this guard entirely — they canonicalize on the
 * meeting's own project tier (`is_foundation`) via `getEntityCommands`, so me/org-lens
 * users land on the tier-prefixed `/foundation|project/meetings/{id}/edit` URL. When
 * `is_foundation` is absent (unenriched payload), callers fall back to the flat
 * `/meetings/{id}/edit` path, which still runs this guard and redirects by active lens.
 *
 * Reads `state.url` so query params and trailing path segments (e.g.
 * `/groups/abc?tab=meetings`) are preserved verbatim across the redirect.
 */
export const lensRedirectGuard: CanActivateFn = (_route, state) => {
  const lensService = inject(LensService);
  const router = inject(Router);

  // Reads `activeLens` synchronously, and the allowed lens set is partly derived from `writer`
  // grants that resolve after hydration (LFXV2-2754). A user whose only route to a lens is a writer
  // grant therefore gets no redirect on the first navigation after load, and the redirect on
  // subsequent ones — the same URL resolving differently by timing. Accepted rather than gated on a
  // readiness signal, which would block every flat-route navigation on the grants request.
  //
  // Since LFXV2-2857, a direct writer grant resolves this quickly (sub-second, WriterGrantsService's
  // fast path), but an *inherited-only* grant (e.g. foundation-level writer reaching a non-foundation
  // child with no direct tuple on it) only resolves once the idle-deferred full sweep runs — and that
  // sweep is scheduled behind three sequential budgets: up to `WRITER_SUMMARY_TIMEOUT_MS` (10s) for
  // the fast path to settle, then `IDLE_SWEEP_MIN_DELAY_MS` (2s) before idle scheduling is even
  // attempted, then up to `IDLE_SWEEP_TIMEOUT_MS` (15s) for it to actually fire — plus the sweep's
  // own request latency on top of all of that. So the un-redirected window for that user class is
  // meaningfully longer than a single hydration tick.
  //
  // The un-redirected flat route is a functional page, and — crucially — the create flows on it no
  // longer resolve the wrong target while it is un-redirected: the flat write routes also run
  // `projectQueryParamGuard`, which seeds the context slot from the `?project=` param (deriving
  // foundation-vs-project from the project itself, not the lens), so `activeContextUid()` reflects
  // the authorised target regardless of the active lens. This redirect is now cosmetic/navigational
  // only. Revisit if the grants move into the SSR payload, which removes the timing asymmetry.
  const lens = lensService.activeLens();
  if (lens === 'foundation' || lens === 'project') {
    return router.parseUrl(`/${lens}${state.url}`);
  }
  return true;
};
