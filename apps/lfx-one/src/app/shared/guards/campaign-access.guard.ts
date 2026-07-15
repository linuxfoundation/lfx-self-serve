// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Route guard for the Campaigns surface (full view + management actions).
 *
 * Grants access only when the current user holds `campaign_manager` on the target project
 * (`project.campaignManager === true`, set by the backend's FGA-driven role check). This
 * relation resolves for EDs and Marketing Ops only (Marketing Auditors are excluded), so
 * there is deliberately NO ED persona fast-path — per-project correctness is the requirement.
 *
 * Slug resolution and fail-closed denial mirror {@link marketingViewGuard}: prefer the URL's
 * `?project=<slug>` query param, fall back to the active context, and redirect to the foundation
 * overview (preserving the project context) on any missing slug, false/undefined flag, or probe error.
 */
export const campaignAccessGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  if (!slug) {
    return router.parseUrl('/foundation/overview');
  }

  const deniedUrl = router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } });

  return projectService.getProject(slug, false, { marketing: true }).pipe(
    map((project) => (project?.campaignManager === true ? true : deniedUrl))
  );
};
