// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { ORG_LENS_ENABLED_FLAG, ORG_NOT_FOUND_PATH } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';

/** CanMatch guard for /org/* gating the dark-launched Org Lens behind the `org-lens-enabled` flag; SSR defers to browser, browser waits for provider READY. Fails closed to the Org Lens not-found page (a sibling route outside this CanMatch, so no loop) rather than home: a shared Org Lens link must not silently land on the dashboard (spec 050 US5, FR-022). See specs/025-org-lens-access-tab. */
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
    const ready = await featureFlagService.waitForReady({ guard: 'orgLensEnabledGuard', flag: ORG_LENS_ENABLED_FLAG });
    // Provider never became ready (no client id / LD unreachable) → fail closed. waitForReady()
    // reports the timeout to RUM.
    if (!ready) {
      return router.parseUrl(ORG_NOT_FOUND_PATH);
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false)() ? true : router.parseUrl(ORG_NOT_FOUND_PATH);
};
