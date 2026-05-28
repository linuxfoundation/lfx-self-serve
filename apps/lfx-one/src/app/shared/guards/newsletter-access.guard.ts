// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

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
 * path). Falls back to `/foundation/overview` on denial / unrecoverable
 * error to match the existing executiveDirectorGuard's behavior.
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
  if (!slug) {
    return router.parseUrl('/foundation/overview');
  }

  // Writer / owner check on the resolved project. project.writer is set
  // server-side by the FGA-driven authorization check and is true for
  // both explicit writer grants and owner-equivalent roles.
  return projectService.getProject(slug, false).pipe(
    map((project) => (project?.writer === true ? true : router.parseUrl('/foundation/overview'))),
    catchError((err) => {
      // Surface the failure to Datadog RUM rather than silently bouncing —
      // a 5xx / transport error looks identical to a legitimate deny from
      // the user's perspective and we want it triageable.
      console.error('newsletterAccessGuard: writer-permission lookup failed', { slug, error: err });
      return of(router.parseUrl('/foundation/overview'));
    })
  );
};
