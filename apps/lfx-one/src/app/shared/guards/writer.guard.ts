// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Protects create/edit/admin routes that require project write permission.
 *
 * Fast path: ED persona is synchronously allowed (cookie-seeded, no HTTP round-trip).
 * Slow path: fetches the project and checks `project.writer` — set server-side by the
 * FGA-driven authorization check; covers explicit writer grants and owner-equivalent roles.
 *
 * Slug resolution: prefers the `?project=` query param (authoritative for the navigation
 * target, works before the lens has synced) then falls back to the active context's slug.
 * Redirects to the lens-appropriate overview on denial so the correct project context is
 * preserved and NavigationService.applyDefaultSelection does not override the selection.
 */
export const writerGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  // Use the lens encoded in the route ancestry (parent route carries data.lens) so the
  // denied redirect lands on the same lens the user was navigating within, preventing
  // NavigationService.applyDefaultSelection from overriding the project when it does not
  // appear in the foundation items list.
  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  if (!slug) {
    return router.parseUrl(overviewPath);
  }
  const deniedUrl = router.createUrlTree([overviewPath], { queryParams: { project: slug } });

  return projectService.getProject(slug, false).pipe(
    map((project) => {
      if (project?.writer !== true) {
        return deniedUrl;
      }
      return true;
    })
  );
};
