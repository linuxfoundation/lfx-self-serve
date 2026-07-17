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
 * - Me lens: redirect to `/profile/settings` (canonical home for account settings now
 *   that they live as a Profile tab), carrying the query params and fragment
 *   through so the header's `/settings#developer-settings` anchor link still lands on
 *   the right section. `RouterStateSnapshot.url` omits the fragment, so build the tree
 *   from the snapshot's `queryParams`/`fragment` rather than string-prefixing `state.url`.
 * - Any other lens (e.g. org): let the request through unchanged.
 */
export const settingsLensRedirectGuard: CanActivateFn = (route, state) => {
  const lensService = inject(LensService);
  const router = inject(Router);

  const lens = lensService.activeLens();
  if (lens === 'foundation' || lens === 'project') {
    return router.parseUrl(`/${lens}${state.url}`);
  }
  if (lens === 'me') {
    return router.createUrlTree(['/profile/settings'], {
      queryParams: route.queryParams,
      fragment: route.fragment ?? undefined,
    });
  }
  return true;
};
