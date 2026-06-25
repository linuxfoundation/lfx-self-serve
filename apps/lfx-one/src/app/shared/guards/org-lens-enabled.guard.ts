// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanMatchFn, Router } from '@angular/router';
import { ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { FeatureFlagService } from '../services/feature-flag.service';

/** CanMatch guard for /org/* gating the dark-launched Org Lens behind the `org-lens-enabled` flag; SSR defers to browser, browser waits for provider READY. See specs/025-org-lens-access-tab. */
export const orgLensEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // On the server LaunchDarkly is unavailable — let the route match and let the
  // browser-side run of this guard make the real decision after hydration.
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
    // Provider never became ready (no client id / LD unreachable) → fail closed.
    if (!ready) {
      return router.parseUrl('/');
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false)() ? true : router.parseUrl('/');
};
