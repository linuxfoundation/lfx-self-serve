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
 *
 * Reads `state.url` so query params and trailing path segments (e.g.
 * `/groups/abc?tab=meetings`) are preserved verbatim across the redirect.
 */
export const lensRedirectGuard: CanActivateFn = (_route, state) => {
  const lensService = inject(LensService);
  const router = inject(Router);

  const lens = lensService.activeLens();
  if (lens === 'foundation' || lens === 'project') {
    return router.parseUrl(`/${lens}${state.url}`);
  }
  return true;
};
