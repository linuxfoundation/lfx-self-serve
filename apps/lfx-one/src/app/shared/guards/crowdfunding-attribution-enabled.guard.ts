// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { CROWDFUNDING_ATTRIBUTION_STEP_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard gating the Project/Foundation lens Initiatives routes (#347) behind the
 * `crowdfunding-attribution-step` flag, shared with the Crowdfunding app. SSR defers to the browser,
 * a local override decides before the provider is consulted, and an unready provider fails closed.
 */
export const crowdfundingAttributionEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  // A locally pinned value decides on its own; see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(CROWDFUNDING_ATTRIBUTION_STEP_FLAG);
  if (override !== undefined) {
    return override ? true : router.parseUrl('/');
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'crowdfundingAttributionEnabledGuard', flag: CROWDFUNDING_ATTRIBUTION_STEP_FLAG });
    // Dark launch: fail CLOSED when LaunchDarkly never becomes ready. waitForReady() reports the timeout to RUM.
    if (!ready) {
      return router.parseUrl('/');
    }
  }

  return featureFlagService.getBooleanFlag(CROWDFUNDING_ATTRIBUTION_STEP_FLAG, false)() ? true : router.parseUrl('/');
};
