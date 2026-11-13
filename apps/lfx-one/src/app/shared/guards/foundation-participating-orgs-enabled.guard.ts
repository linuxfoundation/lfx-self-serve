// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for `foundation/participating-orgs` (#5697). Dark-launch gate behind
 * `foundation-participating-orgs-enabled`, same shape as `formationEnabledGuard`: SSR defers to the browser
 * (the flag provider never initializes server-side), and the browser run waits for provider readiness through the
 * shared `waitForReady` and fails closed on timeout, because the page runs on demo data and must not appear when the provider is slow.
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

  // The shared readiness wait (its timeout, error recovery and RUM report), as the other flag guards use; fails closed.
  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'foundationParticipatingOrgsEnabledGuard', flag: FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG });
    if (!ready) {
      return fallback;
    }
  }

  return featureFlagService.getBooleanFlag(FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG, false)() ? true : fallback;
};
