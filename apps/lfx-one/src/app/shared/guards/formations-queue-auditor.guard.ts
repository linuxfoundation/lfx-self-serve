// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, Observable } from 'rxjs';

import { PersonaService } from '../services/persona.service';

/**
 * CanActivate guard for `foundation/formations` (GH-1958) — root-scoped `auditor` FGA grant, with
 * a root-writer bypass matching every sibling ED/marketing-access guard's convention. No
 * per-project fallback: the queue is locked to the LF root, so unlike `writerGuard`/
 * `marketingImpactAccessGuard` there is no `?project=` scope to also check.
 *
 * On the server this returns `true` directly (matching `marketingImpactAccessGuard`) and defers
 * the real decision to the client-side rerun after hydration — `PersonaService`'s FGA signals are
 * request-scoped and only meaningfully populated in the browser.
 */
export const formationsQueueAuditorGuard: CanActivateFn = (): boolean | Observable<boolean | UrlTree> => {
  const personaService = inject(PersonaService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  if (personaService.isRootWriter()) {
    return true;
  }

  return personaService.refreshEnrichedPersonas().pipe(
    map((response) => {
      const isAuditor = response && !response.error ? (response.isAuditor ?? false) : personaService.isAuditor();
      const isRootWriter = response && !response.error ? (response.isRootWriter ?? false) : personaService.isRootWriter();
      if (isAuditor || isRootWriter) {
        return true;
      }
      return router.createUrlTree(['/foundation/overview']);
    })
  );
};
