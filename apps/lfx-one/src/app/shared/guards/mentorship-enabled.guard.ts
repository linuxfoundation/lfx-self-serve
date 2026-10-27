// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard gating the Mentorship module behind the `mentorship-enabled` flag. SSR defers to
 * the browser, a local override decides before the provider is consulted, and an unready provider
 * fails open so a slow or blocked LaunchDarkly never bounces the user to the Me Lens dashboard.
 */
export const mentorshipEnabledGuard: CanMatchFn = async () => {
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
  const override = featureFlagService.getFlagOverride(MENTORSHIP_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : router.parseUrl('/');
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'mentorshipEnabledGuard', flag: MENTORSHIP_ENABLED_FLAG });
    // Provider never became ready in time (LD slow / unreachable / blocked) → fail open so users
    // aren't silently redirected away from the module. Before go-live this can expose the pages to a
    // non-tester during an LD outage; anything written then is replaced by the final data import.
    // waitForReady() reports the timeout to RUM so the frequency stays visible.
    if (!ready) {
      return true;
    }
  }

  return featureFlagService.getBooleanFlag(MENTORSHIP_ENABLED_FLAG, false)() ? true : router.parseUrl('/');
};
