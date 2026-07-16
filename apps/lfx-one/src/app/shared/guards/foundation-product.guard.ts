// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { PersonaService } from '../services/persona.service';

/**
 * Blocks marketing-only foundation users from non-marketing product routes (FR-017).
 *
 * Marketing Ops / Auditors gain the foundation lens via `isRootMarketingAuditor` so they can
 * reach Marketing surfaces, but MUST NOT inherit Meetings, Events, Groups, Documents, etc.
 * Overview stays open (no this guard) so they can land on Marketing Overview.
 *
 * Steady-state: deny **only** `isMarketingOnlyFoundationUser` so pre-existing
 * `projectQueryParamGuard`-only access stays unchanged for everyone else (FR-017).
 *
 * Hydration failure / timeout (FR-015): fail closed for anyone who is not already confirmed
 * full-product (board / root writer). That covers unseeded marketing-only users when the
 * personas API is slow or unavailable, at the cost of a transient redirect for other
 * non-full-product deep links until personas recovers.
 *
 * `isRootWriter` / `isRootMarketingAuditor` are TransferState- and cookie-seeded so SSR and
 * the browser fast paths can decide without awaiting the personas API when seeds are present.
 */
export const foundationProductGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  const deny = () => {
    const slug = route.queryParamMap.get('project');
    return slug ? router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } }) : router.parseUrl('/foundation/overview');
  };

  // Steady-state: deny only the newly admitted marketing-only audience.
  const decide = () => (personaService.isMarketingOnlyFoundationUser() ? deny() : true);

  // Fast path: full product audience never blocked here.
  if (personaService.canAccessFullFoundationProduct()) {
    return true;
  }

  // Fast path: seeded marketing-only → deny without waiting for API.
  if (personaService.isMarketingOnlyFoundationUser()) {
    return deny();
  }

  // SSR: decide from seeded entitlements (no personaLoaded on server).
  if (!isPlatformBrowser(platformId)) {
    return decide();
  }

  // Browser: wait for hydration so a late-arriving ROOT marketing flag still blocks product routes.
  if (!personaService.personaLoaded()) {
    const loaded = await firstValueFrom(
      toObservable(personaService.personaLoaded).pipe(
        filter((ready): ready is true => ready === true),
        timeout(10_000),
        catchError(() => of(false))
      )
    );
    if (!loaded) {
      // Timeout with no confirmation of entitlements → fail closed (FR-015).
      return deny();
    }
  }

  // Personas API failed: fail closed for unconfirmed non-full-product users (covers unseeded
  // marketing-only). Seeded marketing-only already denied above; board/root-writer already allowed.
  if (personaService.personaHydrationFailed()) {
    return deny();
  }

  return decide();
};
