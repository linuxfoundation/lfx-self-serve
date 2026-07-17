// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { LensService } from '../services/lens.service';

/**
 * Route guard for the flat `/settings` route.
 *
 * - Foundation / project lens: redirect to the lens-prefixed equivalent
 *   (`/foundation/settings`, `/project/settings`) — same behavior as `lensRedirectGuard`.
 * - Me lens: redirect to `/profile/settings`, the canonical home for account settings
 *   now that they live as a tab in the Profile & Account page.
 * - Any other lens (e.g. org): let the request through unchanged.
 *
 * Reads `state.url` so query params and trailing segments survive the lens redirect.
 */
export const settingsLensRedirectGuard: CanActivateFn = (_route, state) => {
  const lensService = inject(LensService);
  const router = inject(Router);

  const lens = lensService.activeLens();
  if (lens === 'foundation' || lens === 'project') {
    return router.parseUrl(`/${lens}${state.url}`);
  }
  if (lens === 'me') {
    return router.parseUrl('/profile/settings');
  }
  return true;
};
