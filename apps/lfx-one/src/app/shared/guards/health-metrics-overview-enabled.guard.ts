// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { HEALTH_METRICS_OVERVIEW_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * CanMatch guard for the LFXV2-3365 replacement `foundation/health-metrics` page.
 *
 * Unlike `orgLensEnabledGuard`, a `false` here doesn't need a redirect: `app.routes.ts`
 * registers this route ahead of the existing (unguarded) `foundation/health-metrics` entry,
 * so a failed match just falls through to the current page. SSR fails closed (no LaunchDarkly
 * client server-side) so the server always renders the existing page; the browser re-evaluates
 * against the real flag once the provider is READY.
 */
export const healthMetricsOverviewEnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return false;
  }

  const featureFlagService = inject(FeatureFlagService);

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'healthMetricsOverviewEnabledGuard', flag: HEALTH_METRICS_OVERVIEW_ENABLED_FLAG });
    if (!ready) {
      return false;
    }
  }

  return featureFlagService.getBooleanFlag(HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, false)();
};
