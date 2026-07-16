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
 * FR-017 also requires that non-marketing product permissions stay unchanged: before this
 * feature those routes used only `projectQueryParamGuard`. This guard therefore denies
 * **only** `isMarketingOnlyFoundationUser` and allows everyone else (board, root writer,
 * project-scoped deep links, etc.).
 *
 * `isRootWriter` / `isRootMarketingAuditor` are TransferState- and cookie-seeded so SSR can
 * decide without awaiting the personas API. On the browser, cold sessions wait for
 * `personaLoaded` before deciding. Hydration timeout uses seeded flags (deny only when
 * already known marketing-only).
 */
export const foundationProductGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  const deny = () => {
    const slug = route.queryParamMap.get('project');
    return slug ? router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } }) : router.parseUrl('/foundation/overview');
  };

  // Deny only the newly admitted marketing-only audience; preserve pre-existing access otherwise.
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
      // Prefer seeded entitlements (decide): marketing-only still denied; everyone else keeps
      // pre-existing access (FR-017). Do not blanket-allow — that would widen product routes if
      // isRootMarketingAuditor was seeded after the fast-path checks above ran as false.
      return decide();
    }
  }

  return decide();
};
