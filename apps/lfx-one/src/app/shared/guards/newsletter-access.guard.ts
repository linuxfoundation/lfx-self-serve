// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Route guard for the newsletters feature.
 *
 * Grants access to:
 *   - Executive Director persona (fast path, synchronous), OR
 *   - Users with writer (or owner-equivalent) permission on the currently
 *     active foundation/project — `project.writer === true` set by the
 *     backend's FGA-driven role check.
 *
 * Slug resolution prefers the URL's `?project=<slug>` query param so deep
 * links and hard reloads work before the lens has finished syncing the
 * active context. Falls back to the active context's slug only when no
 * query param is present (e.g., the bare `/newsletters` lens-redirect
 * path). Redirects to the lens-appropriate overview on denial to preserve
 * the active project context without triggering a lens switch.
 */
export const newsletterAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  // Fast path: ED persona. Synchronous (cookie-seeded) so SSR + first-paint
  // navigations don't need to await an HTTP round-trip.
  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  // Prefer the URL's project query param: it's authoritative for the
  // navigation target and doesn't depend on the lens having synced yet.
  // Fall back to the active context for cases where the URL doesn't carry
  // it (e.g., the `/newsletters` lens-redirect parent).
  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

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
