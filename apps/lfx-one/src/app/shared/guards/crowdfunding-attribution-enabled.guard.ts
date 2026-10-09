// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Route, Router, UrlTree } from '@angular/router';
import { CROWDFUNDING_ATTRIBUTION_STEP_FLAG } from '@lfx-one/shared/constants';
import { orgLensPagePath } from '@lfx-one/shared/utils';

import { FeatureFlagService } from '../services/feature-flag.service';
import { deniedOverview } from './mktg-os-agents-enabled.guard';

/**
 * CanMatch guard gating the Project/Foundation (#347) and Org (#348) lens Initiatives routes behind the
 * `crowdfunding-attribution-step` flag, shared with the Crowdfunding app. SSR defers to the browser,
 * a local override decides before the provider is consulted, and an unready provider fails closed. A denial
 * lands on the lens overview with `?project=` kept, not on `/` (the Me lens); on the Org Lens, on the addressed
 * organization's overview, derived from the URL being recognized as `orgLensRoiEnabledGuard` does.
 */
export const crowdfundingAttributionEnabledGuard: CanMatchFn = async (route) => {
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
    return override ? true : denied(router, route);
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'crowdfundingAttributionEnabledGuard', flag: CROWDFUNDING_ATTRIBUTION_STEP_FLAG });
    // Dark launch: fail CLOSED when LaunchDarkly never becomes ready. waitForReady() reports the timeout to RUM.
    if (!ready) {
      return denied(router, route);
    }
  }

  return featureFlagService.getBooleanFlag(CROWDFUNDING_ATTRIBUTION_STEP_FLAG, false)() ? true : denied(router, route);
};

function denied(router: Router, route: Route): UrlTree {
  if (route.data?.['lens'] !== 'org') return deniedOverview(router, route);
  const segments = router.getCurrentNavigation()?.extractedUrl.root.children['primary']?.segments.map((segment) => segment.path) ?? [];
  return router.parseUrl(orgLensPagePath(segments, 'overview'));
}
