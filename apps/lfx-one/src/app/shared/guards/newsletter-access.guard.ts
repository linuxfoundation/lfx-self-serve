// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, Observable, of, switchMap } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Route guard for the newsletters feature.
 *
 * Grants access to:
 *   - Executive Director persona (fast path — synchronous except on `:projectUid`
 *     deep links, which await the route-project resolution so page chrome never
 *     paints a stale cookie-restored context, GH-1570), OR
 *   - Users with writer (or owner-equivalent) permission on the route's
 *     foundation/project — `project.writer === true` set by the backend's
 *     FGA-driven role check.
 *
 * Project resolution order:
 *   1. The route's own `:projectUid` param (edit/analytics routes) — the URL
 *      carries the owning project, so a stale `?project=` or cookie-restored
 *      context can't deny a legitimate manager (or authorize against the wrong
 *      project) (GH-1570).
 *   2. The URL's `?project=<slug>` query param, then the active context's
 *      slug — the legacy chain, used by the list/create routes and as the
 *      fallback when uid resolution fails (deleted/unknown project), so a
 *      fetch error degrades to the old behavior instead of denying.
 *
 * Redirects to the lens-appropriate overview on denial to preserve
 * the active project context without triggering a lens switch.
 */
export const newsletterAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  // Edit/analytics routes carry the owning project as `:projectUid` — for writer
  // checks it wins over the query param and the cookie-restored context, both of
  // which can be stale when a link is shared or the user switched projects since
  // it was cut. The /foundation|project/newsletters mounts run this guard at the
  // parent too (the flat mount deliberately omits it), where the param lives on
  // the child snapshot being activated — look one level down so the mount-level
  // invocation resolves the same route project.
  const projectUid = route.paramMap.get('projectUid') ?? route.firstChild?.paramMap.get('projectUid') ?? null;

  // Fast path: ED persona. Synchronous (cookie-seeded) on routes without a
  // :projectUid, so SSR + first-paint navigations don't need to await an HTTP
  // round-trip. Edit/analytics deep links are the exception: they await the
  // route-project resolution because the page's reconcileRouteProjectContext
  // reuses this shareReplay-cached lookup — returning before it resolves would
  // let chrome paint the stale cookie-restored context for the request's
  // duration (GH-1570). Fail-open: getProject maps errors to null, and the ED
  // is never denied here.
  if (personaService.currentPersona() === 'executive-director') {
    if (projectUid) {
      return projectService.getProject(projectUid, false).pipe(map(() => true));
    }
    return true;
  }

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  const checkWriterAccess = (slug: string): Observable<boolean | UrlTree> =>
    projectService.getProject(slug, false).pipe(
      map((project) => {
        if (project?.writer !== true) {
          // `_notice: 'access'` mirrors writerGuard's denial convention — AppComponent turns it
          // into the generic "Access Denied" toast (survives the SSR redirect, unlike a
          // guard-side MessageService.add, which has no DOM on the server).
          return router.createUrlTree([overviewPath], { queryParams: { project: slug, _notice: 'access' } });
        }
        return true;
      })
    );

  // Legacy slug chain: prefer the URL's `?project=` query param (authoritative
  // for deep links before the lens has synced), then the active context for
  // routes that carry neither (e.g., the `/newsletters` lens-redirect parent).
  const contextSlug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  if (projectUid) {
    return projectService.getProject(projectUid, false).pipe(
      switchMap((resolved) => {
        if (!resolved) {
          // Deleted/unknown project — degrade to the legacy chain rather than
          // deny on a fetch error.
          return contextSlug ? checkWriterAccess(contextSlug) : of(router.parseUrl(overviewPath));
        }
        // The uid lookup already returned the project entity, so check writer
        // directly on it; the resolved slug is only needed for the denial redirect.
        if (resolved.writer !== true) {
          return of(router.createUrlTree([overviewPath], { queryParams: { project: resolved.slug, _notice: 'access' } }));
        }
        return of(true);
      })
    );
  }

  if (!contextSlug) {
    return router.parseUrl(overviewPath);
  }
  return checkWriterAccess(contextSlug);
};
