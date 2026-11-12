// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for `foundation/participating-orgs` (#5697). Dark-launch gate behind
 * `foundation-participating-orgs-enabled`, same shape as `formationEnabledGuard`: SSR defers to the browser
 * (the flag provider never initializes server-side), and the browser run waits for provider readiness and
 * fails closed on timeout, because the page runs on demo data and must not appear when the provider is slow.
 */
export const foundationParticipatingOrgsEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);
  const fallback = router.createUrlTree(['/foundation/overview']);

  const override = featureFlagService.getFlagOverride(FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : fallback;
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
      return fallback;
    }
  }

  return featureFlagService.getBooleanFlag(FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG, false)() ? true : fallback;
};
