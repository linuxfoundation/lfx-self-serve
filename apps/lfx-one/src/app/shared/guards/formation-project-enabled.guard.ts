// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router, UrlTree } from '@angular/router';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { isFormationStage } from '@lfx-one/shared/utils';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';
import { ProjectService } from '../services/project.service';

function queryProject(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return undefined;
}

function resolveSlug(router: Router): string | undefined {
  return queryProject(router.getCurrentNavigation()?.extractedUrl.queryParams['project']) ?? queryProject(router.parseUrl(router.url).queryParams['project']);
}

function deniedOverview(router: Router, slug: string | undefined): UrlTree {
  return router.createUrlTree(['/project/overview'], { queryParams: slug ? { project: slug } : {} });
}

/**
 * CanMatch guard for `/project/formation` (GH-1958). Dark-launch gate behind `formation-enabled`,
 * same shape as `formationEnabledGuard` and `mktgOsAgentsEnabledGuard` — plus a Formation
 * sub-stage check on the project named by `?project=`, since a project not currently in a
 * `Formation - *` stage must not resolve this route.
 *
 * `ProjectContextService.activeContext()` is not available here: this is a `CanMatch` guard, which
 * runs before `projectQueryParamGuard` (a `CanActivate`) populates it for this navigation — reading
 * it here would see the *previous* route's project. The slug is resolved directly from the
 * navigation's query params instead (same pattern as `mktgOsAgentsEnabledGuard`'s `deniedOverview`),
 * and the stage is fetched directly via `ProjectService.getProject` — not the dead
 * `ProjectService.project` signal (see the PR description for that diagnosis).
 *
 * SSR defers to the browser (LaunchDarkly never initializes server-side); the browser run waits for
 * provider readiness and fails closed on timeout, since this is a dark launch and failing open would
 * expose the checklist to anyone whenever LaunchDarkly is slow.
 */
export const formationProjectEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);
  const projectService = inject(ProjectService);

  const override = featureFlagService.getFlagOverride(FORMATION_ENABLED_FLAG);
  if (override !== undefined && !override) {
    return deniedOverview(router, resolveSlug(router));
  }

  if (override === undefined) {
    if (!featureFlagService.providerReady()) {
      const ready = await firstValueFrom(
        toObservable(featureFlagService.providerReady).pipe(
          filter((isReady): isReady is true => isReady === true),
          timeout(5000),
          catchError(() => of(false))
        )
      );
      if (!ready) {
        return deniedOverview(router, resolveSlug(router));
      }
    }

    if (!featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false)()) {
      return deniedOverview(router, resolveSlug(router));
    }
  }

  const slug = resolveSlug(router);
  if (!slug) {
    return deniedOverview(router, undefined);
  }

  const project = await firstValueFrom(projectService.getProject(slug, false).pipe(catchError(() => of(null))));
  return isFormationStage(project?.stage) ? true : deniedOverview(router, slug);
};
