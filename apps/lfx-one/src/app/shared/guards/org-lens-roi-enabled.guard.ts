// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { ORG_LENS_ROI_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

export const orgLensRoiEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  // A locally pinned value decides on its own, before the provider is consulted at all — waiting
  // first would let a readiness timeout answer for it, and a pinned `false` must never be
  // overridden. Non-production builds only; see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(ORG_LENS_ROI_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : router.parseUrl('/org/overview');
  }

  if (!featureFlagService.providerReady()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    // Provider never became ready in time (LD slow / unreachable) → fail CLOSED, deliberately
    // unlike `myClasEnabledGuard`, which fails open. That guard's flag is enabled for all
    // production users, so allowing the route grants access they already have; this one is a dark
    // launch, so the same behaviour would show an unfinished page to any Org Lens viewer whenever
    // LaunchDarkly is slow — turning an outage into a release.
    //
    // Revisit at GA: once the flag is on for everyone, failing open becomes the better trade and
    // this should match its sibling.
    if (!ready) {
      return router.parseUrl('/org/overview');
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_ROI_ENABLED_FLAG, false)() ? true : router.parseUrl('/org/overview');
};
