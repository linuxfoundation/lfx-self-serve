// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for the Me-lens My Formations page (#2753) behind `formation-enabled`. Same
 * decision order as `mentorshipEnabledGuard`: SSR defers to the browser, a local override decides
 * before the provider is consulted, and an unready provider fails closed. Denies to My Dashboard
 * (`/`) rather than `formationEnabledGuard`'s `/foundation/overview` — that guard fronts the
 * foundation-lens queue, and bouncing a Me-lens visitor into the foundation lens would switch
 * their context as a side effect of a flag being off.
 */
export const formationMeEnabledGuard: CanMatchFn = async () => {
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
  const override = featureFlagService.getFlagOverride(FORMATION_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : router.parseUrl('/');
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'formationMeEnabledGuard', flag: FORMATION_ENABLED_FLAG });
    // Provider never became ready in time (no client id / LD unreachable) → fail CLOSED. This is a
    // dark launch, so failing open would expose the page to every user whenever LaunchDarkly is
    // slow — turning an outage into a release. waitForReady() reports the timeout to RUM.
    if (!ready) {
      return router.parseUrl('/');
    }
  }

  return featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false)() ? true : router.parseUrl('/');
};
