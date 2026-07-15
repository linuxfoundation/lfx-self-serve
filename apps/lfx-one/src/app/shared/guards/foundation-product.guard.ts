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
 * `isRootWriter` is API-hydrated (not cookie-seeded), so on a cold browser session this
 * guard waits for `personaLoaded` before denying — otherwise a root writer would be
 * redirected from every product route before the personas response arrives. If hydration
 * times out, the guard fails open (allow) rather than deny with a stale `isRootWriter=false`.
 * SSR defers the real decision to the browser re-run (same pattern as `orgLensEnabledGuard`).
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

  // Fast path: board persona is cookie-seeded and available immediately.
  if (personaService.hasBoardRole() || personaService.isRootWriter()) {
    return true;
  }

  // SSR cannot await the personas API — allow match and let the browser guard decide.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  if (!personaService.personaLoaded()) {
    const loaded = await firstValueFrom(
      toObservable(personaService.personaLoaded).pipe(
        filter((ready): ready is true => ready === true),
        timeout(10_000),
        // Timeout/error → treat as not loaded (do NOT proceed to decide() with stale false).
        catchError(() => of(false))
      )
    );
    // Fail open when hydration never completes: deciding with isRootWriter still false would
    // redirect legitimate root writers off Meetings/Events/etc. Marketing-only FR-017 is still
    // enforced by the sidebar (product items hidden) once personas eventually load.
    if (!loaded) {
      return true;
    }
  }

  return decide();
};
