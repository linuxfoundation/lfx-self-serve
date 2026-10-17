// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { SocialListeningService } from '../services/social-listening.service';

/**
 * Route guard for the foundation Social Listening page: the executive-dashboard audience (ED, LF Staff)
 * plus members of the foundation's groups that have opted in (lfx-self-serve-ops#387).
 *
 * The ED fast path mirrors `dashboardAccessGuard`: it trusts the persona cookie and leaves per-foundation
 * ED scope to the API. Everyone else is checked against the foundation in `?project=` (falling back to the
 * selected foundation) via `/api/social-listening/access`, the same policy the API enforces.
 */
export const socialListeningAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const socialListeningService = inject(SocialListeningService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const projectParam = route.queryParamMap.get('project');
  const foundationSlug = projectParam ?? projectContextService.selectedFoundation()?.slug;
  const deny = router.createUrlTree(['/foundation/overview'], { queryParams: { project: projectParam } });

  return personaService.refreshEnrichedPersonas().pipe(
    switchMap(() => {
      if (personaService.canViewExecutiveDashboards()) {
        return of(true);
      }
      if (!foundationSlug) {
        return of(deny);
      }
      return socialListeningService.getAccess(foundationSlug).pipe(map((access) => access.canView || deny));
    })
  );
};
