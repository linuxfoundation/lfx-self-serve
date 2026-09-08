// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { MY_CLAS_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for the Profile "CLAs" tab (`/profile/clas`), gating the
 * read-only EasyCLA view behind the `my-clas-enabled` flag. SSR defers to the
 * browser; the browser waits up to 5 s for the flag provider to be READY, then
 * fails open (allows the route) if LD is unreachable so users aren't silently
 * redirected away from a feature that is enabled for them in production.
 */
export const myClasEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // On the server LaunchDarkly is unavailable — let the route match and let the
  // browser-side run of this guard make the real decision after hydration.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'myClasEnabledGuard', flag: MY_CLAS_ENABLED_FLAG });
    // Provider never became ready in time (LD slow / unreachable) → fail open so users
    // aren't silently redirected away from a route the flag is enabled for in production.
    // waitForReady() reports the timeout to RUM so the team can monitor frequency and detect
    // drift if the flag scope ever narrows.
    if (!ready) {
      return true;
    }
  }

  return featureFlagService.getBooleanFlag(MY_CLAS_ENABLED_FLAG, false)() ? true : router.parseUrl('/profile');
};
