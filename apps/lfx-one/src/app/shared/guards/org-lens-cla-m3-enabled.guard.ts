// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';
import { ORG_LENS_CLA_M3_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from '../services/feature-flag.service';
import { OrgLensNavigationService } from '../services/org-lens-navigation.service';

export const orgLensClaM3EnabledGuard: CanMatchFn = async () => {
  const platformId = inject(PLATFORM_ID);

  // LaunchDarkly is unavailable during SSR, so the browser run of this guard makes the real decision.
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);
  // Injected up front: the fallback also runs after the `await` below, outside the injection context.
  const orgLensNavigation = inject(OrgLensNavigationService);
  // Spec 050 US2: the fallback stays with the selected organization (`/org/{segment}/overview`);
  // the legacy `/org/overview` only while nothing is selected yet. Derived from the *selection*
  // rather than the URL being recognized (as `orgLensRoiEnabledGuard` does with `orgLensPagePath`)
  // because leftover `/org/easycla` names no organization — the twin form does (#2743).
  // Built from commands, not a joined string, so the segment stays one path segment whatever it holds.
  const fallback = (): UrlTree => router.createUrlTree(orgLensNavigation.orgLensLink('overview'));

  // A locally pinned value decides on its own, before the provider is consulted at all — waiting
  // first would let a readiness timeout answer for it, and a pinned `false` must never be
  // overridden. Non-production builds only; see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`.
  const override = featureFlagService.getFlagOverride(ORG_LENS_CLA_M3_ENABLED_FLAG);
  if (override !== undefined) {
    return override ? true : fallback();
  }

  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'orgLensClaM3EnabledGuard', flag: ORG_LENS_CLA_M3_ENABLED_FLAG });
    // Provider never became ready in time (LD slow / unreachable) → fail CLOSED, deliberately
    // unlike `myClasEnabledGuard`, which fails open. That guard's flag is enabled for all
    // production users, so allowing the route grants access they already have; this one is a dark
    // launch, so the same behaviour would show an unfinished page to any Org Lens viewer whenever
    // LaunchDarkly is slow — turning an outage into a release. waitForReady() reports the timeout
    // to RUM.
    if (!ready) {
      return fallback();
    }
  }

  return featureFlagService.getBooleanFlag(ORG_LENS_CLA_M3_ENABLED_FLAG, false)() ? true : fallback();
};
