// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS, FORMATION_CHECKLIST_PATH } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';
import { isFormationChecklistProject, resolveFormationFlag } from '../utils/formation-checklist-gate.util';

/**
 * CanActivate guard for `/project/overview` (#2754). A project in a Formation stage gets a
 * Formation-only sidebar (`SidebarNavService`), so its lens landing page is the checklist, not the
 * dashboard: this redirects to `/project/formation` exactly when `formationProjectEnabledGuard`
 * would admit it — the same shared gate, so the two routes can never disagree and bounce.
 *
 * Runs first in the route's `canActivate` array: Angular starts every guard concurrently but
 * honours the first `UrlTree` in array order, so this decides regardless of
 * `projectQueryParamGuard`'s timing. Both read the same `shareReplay`-cached `getProject`, so the
 * redirect costs no extra request.
 *
 * The slug comes from the route snapshot (`?project=`), falling back to the selected project slot
 * for the in-app navigations that call `setProject()` then `navigate(['/project/overview'])`
 * without the query param — `selectedProject`, not `activeContext`, whose route-lens kind can
 * still describe the route being navigated away from at guard time.
 *
 * Stage first, then flag: the non-formation majority never waits on LaunchDarkly for the lens's
 * most-visited page. SSR defers to the browser (LaunchDarkly never initializes server-side; the
 * client's initial navigation re-runs this guard after hydration). The browser run fails OPEN on a
 * readiness timeout — the dashboard is the pre-formation UI an unflagged evaluation renders anyway,
 * and the checklist route itself fails closed on the same timeout, so there is nothing to redirect
 * to. Every fail-open for a Formation-stage project is recorded on
 * `ProjectContextService.formationOverviewAllowedSlug`, which `SidebarNavService` reads to keep the
 * full nav in step with the dashboard it stands on — without that, a provider becoming ready after
 * the budget (or a flag flipped on live) would collapse the nav to Formation-only under a page this
 * guard had already admitted; the next overview decision overwrites it. That wait is the short
 * `FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS` budget, not the ten-second
 * one dark-launched routes use: the dashboard is already settled and interactive underneath, and a
 * redirect landing that late would interrupt whatever the user started (a shorter budget cannot
 * bounce — readiness is monotonic, so an overview that gave up never redirects, and a checklist that
 * denied sends the user to an overview that stays). An unresolvable project also allows, so `projectQueryParamGuard`'s
 * not-found handling wins. The other query params (e.g. `_notice` from a `writerGuard` denial)
 * are carried through so the access-denied toast still fires on the checklist page.
 */
export const formationOverviewRedirectGuard: CanActivateFn = async (route) => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const projectService = inject(ProjectService);
  const projectContextService = inject(ProjectContextService);
  const router = inject(Router);

  const slug = route.queryParamMap.get('project') ?? projectContextService.selectedProject()?.slug;
  if (!slug) {
    return true;
  }

  if (!(await isFormationChecklistProject(projectService, slug))) {
    return true;
  }

  if (!(await resolveFormationFlag(featureFlagService, 'formationOverviewRedirectGuard', FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS))) {
    // Fail open — and say so: the sidebar keeps this project's full nav while this overview stands,
    // so a flag that only arrives after the budget cannot collapse the nav to Formation-only under
    // the dashboard this guard already admitted. The next overview navigation re-decides.
    projectContextService.setFormationOverviewAllowedSlug(slug);
    return true;
  }

  projectContextService.setFormationOverviewAllowedSlug(null);
  return router.createUrlTree([FORMATION_CHECKLIST_PATH], { queryParams: { ...route.queryParams, project: slug } });
};
