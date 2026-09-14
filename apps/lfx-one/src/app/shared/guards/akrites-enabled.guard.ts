// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AKRITES_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/** CanMatch guard gating the Akrites admin dashboard behind the `akrites-enabled` flag; SSR defers to browser, browser waits for provider READY and fails closed. */
export const akritesEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // On the server LaunchDarkly is unavailable — let the route match and let the
  // browser-side run of this guard make the real decision after hydration.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'akritesEnabledGuard', flag: AKRITES_ENABLED_FLAG });
    // Provider never became ready (no client id / LD unreachable) → fail closed. waitForReady()
    // reports the timeout to RUM.
    if (!ready) {
      return router.parseUrl('/');
    }
  }

  return featureFlagService.getBooleanFlag(AKRITES_ENABLED_FLAG, false)() ? true : router.parseUrl('/');
};
