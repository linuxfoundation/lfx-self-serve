// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, Observable, of } from 'rxjs';

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
 *      fallback only when the uid lookup confirms the project is gone
 *      (400/404); a transient lookup failure fails closed instead of
 *      re-checking the writer bit against a possibly-stale context.
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
  // duration (GH-1570). Fail-open: lookup errors are swallowed to null and the ED
  // is never denied here.
  if (personaService.currentPersona() === 'executive-director') {
    if (projectUid) {
      // Same shareReplay-cached strict lookup as the writer path below, so the ED
      // deep link also resolves the route project with the one shared request.
      return projectService.getProjectStrict(projectUid).pipe(
        catchError((error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          // Bounded diagnostics (uid + status only) before the fail-open fallback — §14.6.
          console.warn(`newsletterAccessGuard: ED route-project lookup failed for uid ${projectUid} (status ${status}) — failing open`);
          return of(null);
        }),
        map(() => true)
      );
    }
    return true;
  }

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  const checkWriterAccess = (slug: string): Observable<boolean | UrlTree> =>
    projectService.getProject(slug, false).pipe(
      map((project) => {
        if (project?.writer !== true) {
          // Legacy list/create denial — plain redirect, no `_notice` toast: GH-1570 requires
          // the no-`:projectUid` pages to behave exactly as before.
          return router.createUrlTree([overviewPath], { queryParams: { project: slug } });
        }
        return true;
      })
    );

  // Legacy slug chain: prefer the URL's `?project=` query param (authoritative
  // for deep links before the lens has synced), then the active context for
  // routes that carry neither (e.g., the `/newsletters` lens-redirect parent).
  const contextSlug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  if (projectUid) {
    // Status-preserving lookup (getProjectStrict propagates HttpErrorResponse where
    // getProject would collapse every failure to null) so the legacy chain below runs
    // only for a CONFIRMED missing project — a transient 5xx must not silently
    // re-check the writer bit against the possibly-stale contextSlug, reintroducing
    // the wrong-context authorization this guard removed (GH-1570). The lookup is
    // shareReplay-cached, so this guard's mount- and child-route invocations and
    // reconcileRouteProjectContext share the one request per deep link.
    return projectService.getProjectStrict(projectUid).pipe(
      map((resolved): boolean | UrlTree => {
        // The uid lookup already returned the project entity, so check writer
        // directly on it; the resolved slug is only needed for the denial redirect.
        if (resolved.writer !== true) {
          // `_notice: 'access'` mirrors writerGuard's denial convention — AppComponent turns it
          // into the generic "Access Denied" toast (survives the SSR redirect, unlike a
          // guard-side MessageService.add, which has no DOM on the server). Only the
          // route-project denial carries it; the legacy chain above stays notice-free.
          return router.createUrlTree([overviewPath], { queryParams: { project: resolved.slug, _notice: 'access' } });
        }
        return true;
      }),
      catchError((error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        // Bounded diagnostics (uid + status only) before the fallback — §14.6.
        console.warn(`newsletterAccessGuard: route-project lookup failed for uid ${projectUid} (status ${status})`);
        if (status === 400 || status === 404) {
          // Confirmed deleted/unknown project — degrade to the legacy chain rather
          // than deny outright.
          return contextSlug ? checkWriterAccess(contextSlug) : of(router.parseUrl(overviewPath));
        }
        // Transient/unknown failure — fail closed rather than authorize against a
        // stale context. Plain overview redirect without `_notice: 'access'`: a blip
        // is not a denial, and the user can retry the navigation.
        return of(router.parseUrl(overviewPath));
      })
    );
  }

  if (!contextSlug) {
    return router.parseUrl(overviewPath);
  }
  return checkWriterAccess(contextSlug);
};
