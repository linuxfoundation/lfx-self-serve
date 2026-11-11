// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, GuardResult, Router, RouterStateSnapshot } from '@angular/router';
import type { SocialListeningAccessResponse } from '@lfx-one/shared/interfaces';
import { from, isObservable, map, Observable, of, switchMap } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { SocialListeningService } from '../services/social-listening.service';
import { projectQueryParamGuard } from './project-query-param.guard';

/**
 * Route guard for the foundation Social Listening page: the executive-dashboard audience (ED, LF Staff)
 * plus members of the foundation's groups that have opted in (lfx-self-serve-ops#387).
 *
 * The ED fast path mirrors `dashboardAccessGuard`: it trusts the persona cookie and leaves per-foundation
 * ED scope to the API. Everyone else is checked against the foundation in `?project=` (falling back to the
 * selected foundation) via `/api/social-listening/access`, the same policy the API enforces.
 *
 * It also seeds the foundation context. ED and staff go through `projectQueryParamGuard`; a group member
 * may lack project viewer access, which that lookup needs, so the access response carries the context
 * and the Salesforce ID that keys the page's preferences.
 */
export const socialListeningAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const socialListeningService = inject(SocialListeningService);
  const router = inject(Router);
  const injector = inject(EnvironmentInjector);

  const seedFromQueryParam = (): Observable<GuardResult> => {
    const result = runInInjectionContext(injector, () => projectQueryParamGuard(route, state));
    return isObservable(result) ? result : from(Promise.resolve(result));
  };

  const projectParam = route.queryParamMap.get('project');
  const foundationSlug = projectParam ?? projectContextService.selectedFoundation()?.slug;
  const deny = router.createUrlTree(['/foundation/overview'], { queryParams: { project: projectParam } });

  const applyGroupGrant = (access: SocialListeningAccessResponse): boolean => {
    if (!access.canView || !access.foundation) {
      return false;
    }
    projectContextService.setRouteLensKind('foundation');
    projectContextService.setFoundation(access.foundation);
    socialListeningService.groupGrant.set({ foundation: access.foundation, foundationSfid: access.foundationSfid ?? null });
    return true;
  };

  // ED or staff: the project lookup needs project viewer. An ED of another foundation can still hold a
  // group grant on this one, so when the lookup can't resolve it, fall back to the probe's context.
  const seedExecutive = (): Observable<GuardResult> =>
    seedFromQueryParam().pipe(
      switchMap((result) => {
        if (result === true || !foundationSlug) {
          return of(result);
        }
        return socialListeningService.getAccess(foundationSlug).pipe(map((access) => (applyGroupGrant(access) ? true : result)));
      })
    );

  if (personaService.currentPersona() === 'executive-director') {
    return seedExecutive();
  }

  return personaService.refreshEnrichedPersonas().pipe(
    switchMap(() => {
      if (personaService.canViewExecutiveDashboards()) {
        return seedExecutive();
      }
      if (!foundationSlug) {
        return of(deny);
      }
      return socialListeningService.getAccess(foundationSlug).pipe(
        switchMap((access) => {
          if (!access.canView) {
            return of(deny);
          }
          return applyGroupGrant(access) ? of(true) : seedFromQueryParam();
        })
      );
    })
  );
};
