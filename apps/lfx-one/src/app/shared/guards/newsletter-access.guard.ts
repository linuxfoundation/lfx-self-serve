// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { isUuid, toValidUuid } from '@lfx-one/shared/utils';
import { map } from 'rxjs';

import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Recovers a :projectUid path segment straight off the navigated URL.
 *
 * On the lens-prefixed mounts (`foundation/newsletters`, `project/newsletters`
 * in app.routes.ts), this guard is applied twice per navigation into a
 * :projectUid-carrying route (the publication editions route, and the
 * edit/analytics routes): once at the parent mount, and again at the matched
 * leaf route in newsletters.routes.ts. At the parent-mount invocation the
 * child segments haven't been matched into params yet, so `route.paramMap`
 * has no `projectUid` even though the destination URL clearly carries one —
 * without this, that first invocation would fall through to the query
 * param/active context and could deny or misroute a valid deep link before
 * the (correctly-resolving) leaf invocation ever runs. On the flat
 * `newsletters` mount this guard isn't applied at the parent at all (only at
 * the leaf, where `route.paramMap` already has `projectUid` directly), so
 * this fallback is unused there but harmless. Matches only a UUID-shaped
 * segment so `/newsletters/list`, `/newsletters/create`, and `/newsletters/my`
 * are never mistaken for a project UID. Exported for
 * newsletter-access.guard.spec.ts — it's a pure string-in/string-out
 * function feeding an authorization decision, worth pinning directly rather
 * than only indirectly through the guard.
 */
export function projectUidFromUrl(url: string): string | null {
  // RouterStateSnapshot.url is the serialized UrlTree's full string form —
  // query string and fragment included. Strip both before matching: an
  // unanchored match against the whole url would let an unrelated query
  // value (e.g. `?x=/newsletters/<uuid>`) outrank the real ?project= param
  // and active context below. Anchor to one of the three newsletters mounts
  // at the start of the path (all three sit at the root of app.routes.ts's
  // children array) rather than a bare `/newsletters/`, so a match can only
  // come from the mount itself, never from some other route's segment that
  // happens to contain the literal word "newsletters".
  const path = url.split(/[?#]/)[0];
  const candidate = /^\/(?:foundation\/|project\/)?newsletters\/([^/;]+)/.exec(path)?.[1];
  return candidate && isUuid(candidate) ? candidate : null;
}

/**
 * Route guard for the newsletters feature.
 *
 * Grants access to:
 *   - Executive Director persona (fast path, synchronous), OR
 *   - Users with writer (or owner-equivalent) permission on the currently
 *     active foundation/project — `project.writer === true` set by the
 *     backend's FGA-driven role check.
 *
 * Slug/UID resolution prefers, in order: the route's own :projectUid path
 * segment (or the same segment recovered from the raw URL when this guard
 * runs at a parent mount that hasn't matched it into params yet — see
 * projectUidFromUrl), then the URL's `?project=<slug>` query param, then the
 * active context. The path/URL-derived UID is authoritative for the link
 * being opened even beside a stale or different active-context cookie; the
 * query param and active-context fallbacks exist for routes with no
 * :projectUid segment (e.g., the bare `/newsletters` lens-redirect path).
 * Redirects to the lens-appropriate overview on denial to preserve the
 * active project context without triggering a lens switch.
 */
export const newsletterAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  // Fast path: ED persona. Synchronous (cookie-seeded) so SSR + first-paint
  // navigations don't need to await an HTTP round-trip.
  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  // ProjectService.getProject accepts either a slug or a UID, so every source
  // below works unmodified regardless of which one it resolves — hence
  // projectRef rather than "slug" for a value that's a UID from either of
  // the first two sources.
  //
  // route.paramMap.get('projectUid') is gated with the shared toValidUuid
  // here too, matching projectUidFromUrl's own gating: Angular decodes a %2F
  // inside a path segment before it reaches paramMap, so an unvalidated value
  // here could carry an embedded "/" through to getProject's unencoded
  // `/api/projects/${slugOrUid}` request path. The route's own :projectUid
  // segment is expected to always be a UUID already — this only rejects a
  // malformed one rather than forwarding it, falling through to the
  // remaining sources instead.
  const projectRef =
    toValidUuid(route.paramMap.get('projectUid')) ??
    projectUidFromUrl(state.url) ??
    route.queryParamMap.get('project') ??
    projectContextService.activeContext()?.slug ??
    null;

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  if (!projectRef) {
    return router.parseUrl(overviewPath);
  }

  return projectService.getProject(projectRef, false).pipe(
    map((project) => {
      if (project?.writer !== true) {
        // ?project= is a slug everywhere else it's produced in this app;
        // projectRef can be a UID here (from the path segment or
        // projectUidFromUrl above). Prefer the resolved project's own slug so
        // the denial redirect keeps that convention instead of leaking a raw
        // UID into the address bar, falling back to projectRef only if the
        // project itself couldn't be resolved (getProject returned null).
        const deniedSlug = project?.slug ?? projectRef;
        return router.createUrlTree([overviewPath], { queryParams: { project: deniedSlug } });
      }
      return true;
    })
  );
};
