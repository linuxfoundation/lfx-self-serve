// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Route, Router, UrlTree } from '@angular/router';
import { MKTG_OS_AGENTS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

function deniedOverview(router: Router, route: Route): UrlTree {
  const lens = route.data?.['lens'] === 'foundation' ? 'foundation' : 'project';
  const project = router.parseUrl(router.url).queryParams['project'];
  return router.createUrlTree([`/${lens}/overview`], {
    queryParams: project ? { project } : {},
  });
}

/**
 * CanMatch guard for /project|foundation/mktg-os-agents.
 *
 * Dark-launch gate behind `mktg-os-agents-enabled`. SSR defers to the browser.
 * Browser waits for provider READY and fails closed. A local override (non-production
 * only) decides before READY so a pinned false cannot lose to a timeout.
 */
export const mktgOsAgentsEnabledGuard: CanMatchFn = async (route) => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  // A locally pinned value decides on its own, before the provider is consulted at all. Waiting
  // first would let a readiness timeout answer for it, and a pinned `false` must never be
  // overridden. Non-production builds only. See `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(MKTG_OS_AGENTS_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : deniedOverview(router, route);
  }

  if (!featureFlagService.providerReady()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    // Provider never became ready in time (LD slow / unreachable) → fail CLOSED. This is a
    // dark launch, so failing open would show the marketplace to anyone whenever LaunchDarkly
    // is slow.
    if (!ready) {
      return deniedOverview(router, route);
    }
  }

  return featureFlagService.getBooleanFlag(MKTG_OS_AGENTS_ENABLED_FLAG, false)() ? true : deniedOverview(router, route);
};
