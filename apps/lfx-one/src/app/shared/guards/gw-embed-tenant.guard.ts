// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { isGwEmbedAllowedForSlug } from '@lfx-one/shared/utils';

import { ProjectContextService } from '../services/project-context.service';

/**
 * Restricts the embedded Gatewaze admin pilot to the tenant Gatewaze can actually serve.
 *
 * Gatewaze has no multi-foundation scoping: one deployment serves one tenant's content. Opening the
 * embed from any other foundation would render THAT foundation's chrome around AAIF's newsletters —
 * the wrong data under the wrong brand. So this is a data-isolation control, and it belongs on the
 * route as well as the sidebar, because a URL is guessable and shareable.
 *
 * Reads the ROUTE, not the context, and the distinction is the whole correctness of this guard.
 *
 * Two earlier versions got this wrong in the same way, from opposite directions. The first read
 * `?project=` off `window.location` in a `CanMatch` guard, which runs before the URL settles. The
 * second read `ProjectContextService`, on the assumption that listing it after
 * `projectQueryParamGuard` in `canActivate` made it run afterwards. It does not: Angular subscribes
 * every same-route guard in one tick via `prioritizedGuardValue()` (`combineLatest` over the guard
 * array in router2.mjs), so array order decides only which FAILING result wins, never execution
 * order. This guard is synchronous and `projectQueryParamGuard` is not, so it always ran first and
 * read the cookie-seeded selection — the tenant being navigated AWAY from.
 *
 * That was wrong in both directions: it admitted a non-allowed tenant whenever the cookie happened
 * to hold AAIF, and refused a shared `?project=agentic-ai-foundation` link whenever it did not.
 *
 * The route snapshot carries the tenant being navigated TO, which is the only thing worth deciding
 * on. `newsletterAccessGuard` reads the route for the same reason (GH-1570).
 *
 * Falls back to the resolved context only when the route names no project — a direct hit on the
 * bare mount — and fails closed when neither is available, because not knowing the tenant is
 * exactly the case that renders the wrong one.
 */
export const gwEmbedTenantGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const projectContextService = inject(ProjectContextService);
  const router = inject(Router);

  // The child snapshot matters too: both mounts are `**` wildcards, so a deep link's query params
  // can sit on a child rather than the route this guard is attached to.
  const requestedSlug = route.queryParamMap.get('project') ?? route.firstChild?.queryParamMap.get('project') ?? null;
  if (requestedSlug) {
    return isGwEmbedAllowedForSlug(requestedSlug) ? true : router.parseUrl('/');
  }

  const foundationSlug = projectContextService.selectedFoundation()?.slug;
  const projectSlug = projectContextService.selectedProject()?.slug;

  return isGwEmbedAllowedForSlug(foundationSlug) || isGwEmbedAllowedForSlug(projectSlug) ? true : router.parseUrl('/');
};
