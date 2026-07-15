// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { PersonaService } from '../services/persona.service';

/**
 * Retains the pre-marketing-ops foundation product gate (board role or root writer) on
 * non-marketing foundation routes.
 *
 * Marketing Ops / Marketing Auditors gain the foundation lens via `isRootMarketingAuditor`
 * so they can reach Marketing surfaces (FR/SC-008), but MUST NOT inherit Meetings, Events,
 * Groups, Documents, Governance, etc. (FR-017). Those routes keep this guard; marketing
 * routes use `marketingViewGuard` / `campaignAccessGuard` instead. Overview stays open so
 * Marketing Ops can land on the dashboard Marketing Overview section.
 *
 * `isRootWriter` / `isRootMarketingAuditor` are TransferState- and cookie-seeded so SSR can
 * decide fail-closed without awaiting the personas API. On the browser, cold sessions wait for
 * `personaLoaded` before denying. Hydration timeout fails closed (FR-015 / FR-017).
 */
export const foundationProductGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  const deny = () => {
    const slug = route.queryParamMap.get('project');
    return slug ? router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } }) : router.parseUrl('/foundation/overview');
  };

  const decide = () => (personaService.hasBoardRole() || personaService.isRootWriter() ? true : deny());

  // Fast path: board persona / seeded root writer available immediately (cookie or TransferState).
  if (personaService.hasBoardRole() || personaService.isRootWriter()) {
    return true;
  }

  // SSR: decide from seeded entitlements (fail closed for marketing-only / anonymous).
  // Do not await personaLoaded — afterNextRender never runs on the server.
  if (!isPlatformBrowser(platformId)) {
    return decide();
  }

  // Browser: wait for API hydration before denying — cold sessions may still be loading root-writer.
  if (!personaService.personaLoaded()) {
    const loaded = await firstValueFrom(
      toObservable(personaService.personaLoaded).pipe(
        filter((ready): ready is true => ready === true),
        timeout(10_000),
        // Timeout/error → treat as not loaded; fail closed below (FR-015).
        catchError(() => of(false))
      )
    );
    if (!loaded) {
      return deny();
    }
  }

  return decide();
};
