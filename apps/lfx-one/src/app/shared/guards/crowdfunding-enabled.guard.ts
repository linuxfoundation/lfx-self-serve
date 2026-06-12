// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn } from '@angular/router';
import { environment } from '@environments/environment';
import { CROWDFUNDING_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/** CanMatch guard for /crowdfunding/* gating the dark-launched module behind the `crowdfunding-enabled` flag.
 *  SSR defers to browser (LD is browser-only). Browser waits for provider READY (5s timeout).
 *  When flag is OFF or provider never becomes ready, redirects to the external crowdfunding app. */
export const crowdfundingEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // On the server LaunchDarkly is unavailable — let the route match and let the
  // browser-side run of this guard make the real decision after hydration.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);

  if (!featureFlagService.providerReady()) {
    const ready = await firstValueFrom(
      toObservable(featureFlagService.providerReady).pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(5000),
        catchError(() => of(false))
      )
    );
    // Provider never became ready (no client id / LD unreachable) → redirect to external app.
    if (!ready) {
      window.location.href = environment.urls.crowdfunding;
      return false;
    }
  }

  if (!featureFlagService.getBooleanFlag(CROWDFUNDING_ENABLED_FLAG, false)()) {
    window.location.href = environment.urls.crowdfunding;
    return false;
  }

  return true;
};
