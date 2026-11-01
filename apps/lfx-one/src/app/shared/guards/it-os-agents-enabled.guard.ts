// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { IT_OS_AGENTS_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';
import { deniedOverview } from './mktg-os-agents-enabled.guard';

/**
 * CanMatch guard for /project/it-os-agents.
 *
 * Dark-launch gate behind `it-os-agents-enabled`. SSR defers to the browser.
 * Browser waits for provider READY and fails closed. A local override (non-production
 * only) decides before READY so a pinned false cannot lose to a timeout.
 */
export const itOsAgentsEnabledGuard: CanMatchFn = async (route) => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  // A locally pinned value decides on its own, before the provider is consulted. Non-production
  // builds only. See `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(IT_OS_AGENTS_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : deniedOverview(router, route);
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'itOsAgentsEnabledGuard', flag: IT_OS_AGENTS_ENABLED_FLAG });
    // Provider never became ready in time → fail CLOSED, so a slow LaunchDarkly never reveals the dark launch.
    if (!ready) {
      return deniedOverview(router, route);
    }
  }

  return featureFlagService.getBooleanFlag(IT_OS_AGENTS_ENABLED_FLAG, false)() ? true : deniedOverview(router, route);
};
