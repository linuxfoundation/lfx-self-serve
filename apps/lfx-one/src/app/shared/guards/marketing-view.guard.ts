// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';

/**
 * Route guard for the Marketing Impact (read-only) surface.
 *
 * Grants access only when the current user holds `marketing_auditor` on the target project
 * (`project.marketingAuditor === true`, set by the backend's FGA-driven role check). This
 * relation resolves for EDs, Marketing Ops, and Marketing Auditors upstream, so there is
 * deliberately NO ED persona fast-path — per-project correctness is the requirement, and an
 * ED of foundation A must not gain marketing access to foundation B.
 *
 * Slug resolution prefers the URL's `?project=<slug>` query param so deep links and hard
 * reloads work before the lens has synced the active context; falls back to the active
 * context's slug otherwise. Fails closed: no slug, a false/undefined flag, or a probe error
 * all redirect to the foundation overview (preserving the project context, no lens switch).
 */
export const marketingViewGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  const slug = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;

  if (!slug) {
    return router.parseUrl('/foundation/overview');
  }

  const deniedUrl = router.createUrlTree(['/foundation/overview'], { queryParams: { project: slug } });

  return projectService.getProject(slug, false, { marketing: true }).pipe(map((project) => (project?.marketingAuditor === true ? true : deniedUrl)));
};
