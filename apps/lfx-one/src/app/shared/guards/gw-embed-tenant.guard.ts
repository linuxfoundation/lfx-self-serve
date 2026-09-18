// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
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
 * bare mount — and reads the slot matching the mount's own lens, since the two slots persist
 * independently and either one can be stale with respect to the other. Fails closed when that slot
 * is empty, because not knowing the tenant is exactly the case that renders the wrong one.
 */
export const gwEmbedTenantGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const projectContextService = inject(ProjectContextService);
  const router = inject(Router);

  const lens = route.data?.['lens'] === 'project' ? 'project' : 'foundation';

  // The child snapshot matters too: both mounts are `**` wildcards, so a deep link's query params
  // can sit on a child rather than the route this guard is attached to.
  const requestedSlug = route.queryParamMap.get('project') ?? route.firstChild?.queryParamMap.get('project') ?? null;

  /**
   * Refuses into this mount's own lens rather than dropping the user out of it.
   *
   * This used to be `router.parseUrl('/')`, which lands on the Me Lens dashboard. That is the
   * wrong destination for a guard whose whole reason to exist is shareable URLs: an ED opening a
   * forwarded `/foundation/gw?project=<other-tenant>` was refused correctly and then lost the
   * foundation they were working in.
   *
   * `newsletterAccessGuard` — the only other guard in this route's `canActivate` that can deny,
   * the third member being `projectQueryParamGuard` — denies to `/<lens>/overview` with the
   * project param intact, and `mktgOsAgentsEnabledGuard` builds the same UrlTree on the sibling
   * feature-gate routes (it is a `CanMatchFn` on `mktg-os-agents`, not a member of this array).
   * So `/` was a divergence from both rather than a decision. (`gatewazeEmbedEnabledGuard` does
   * still deny to `/`, but its docblock says so explicitly and explains why; this one said
   * nothing.)
   *
   * Carries whichever slug the navigation named, so the user lands on the tenant they asked for
   * rather than an unrelated one — the refusal is about the embed, not about the foundation.
   */
  const deniedOverview = (slug: string | null | undefined): UrlTree =>
    router.createUrlTree([`/${lens}/overview`], { queryParams: slug ? { project: slug } : {} });

  if (requestedSlug) {
    return isGwEmbedAllowedForSlug(requestedSlug) ? true : deniedOverview(requestedSlug);
  }

  // The slot matching THIS mount's lens, not either slot. `selectedFoundation` and
  // `selectedProject` are independent persisted values, so accepting either let a stale AAIF
  // project selection admit `/foundation/gw` while the active foundation was a different tenant,
  // and the mirror image on `/project/gw`. Both mounts declare `data.lens`, so there is no need to
  // guess which one is being asked about.
  const contextSlug = lens === 'project' ? projectContextService.selectedProject()?.slug : projectContextService.selectedFoundation()?.slug;

  return isGwEmbedAllowedForSlug(contextSlug) ? true : deniedOverview(contextSlug);
};
