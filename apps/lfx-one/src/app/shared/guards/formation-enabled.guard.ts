// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for `foundation/formations` (GH-1958). Dark-launch gate behind
 * `formation-enabled` — same shape as `mktgOsAgentsEnabledGuard`. SSR defers to the browser
 * (LaunchDarkly never initializes server-side); the browser run waits for provider readiness and
 * fails closed on timeout, since this is a dark launch and failing open would expose the queue to
 * anyone whenever LaunchDarkly is slow.
 */
export const formationEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  const override = featureFlagService.getFlagOverride(FORMATION_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : router.createUrlTree(['/foundation/overview']);
  }

  if (!featureFlagService.providerReady()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    if (!ready) {
      return router.createUrlTree(['/foundation/overview']);
    }
  }

  return featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false)() ? true : router.createUrlTree(['/foundation/overview']);
};
