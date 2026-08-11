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

  if (!featureFlagService.providerReady()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    // Provider never became ready in time (LD slow / unreachable) → fail open, matching
    // myClasEnabledGuard. Failing closed silently bounced viewers off a page they may well be
    // entitled to, and the bounce is indistinguishable from the feature not existing.
    //
    // This flag is a dark launch rather than a fully-enabled one, so failing open can show an
    // unfinished page to an Org Lens viewer when LaunchDarkly is slow. That is bounded: every ROI
    // endpoint runs its own `assertOrgLensRead` regardless of any flag, so what leaks early is an
    // incomplete view, never data the viewer could not already request. Logged so the frequency is
    // visible rather than assumed.
    if (!ready) {
      console.warn('orgLensRoiEnabledGuard: LD provider not ready after 5 s — failing open');
      return true;
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_ROI_ENABLED_FLAG, false)() ? true : router.parseUrl('/org/overview');
};
