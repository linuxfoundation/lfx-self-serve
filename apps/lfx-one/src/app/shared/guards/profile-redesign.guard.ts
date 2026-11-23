// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { accountPathForProfileTab, profileTargetForAccountRoute } from '@lfx-one/shared/utils';

import { FeatureFlagService } from '../services/feature-flag.service';

/** The redesign flag for a guard; `false` when the provider never gets ready, so a slow flag service keeps the hub. */
async function readProfileRedesignFlag(featureFlagService: FeatureFlagService, guard: string): Promise<boolean> {
  const override = featureFlagService.getFlagOverride(PROFILE_REDESIGN_FLAG);
  if (override !== undefined) return override;
  if (!featureFlagService.providerReady() && !(await featureFlagService.waitForReady({ guard, flag: PROFILE_REDESIGN_FLAG }))) return false;
  return featureFlagService.getBooleanFlag(PROFILE_REDESIGN_FLAG, false)();
}

/**
 * Gates `/account` behind the redesign flag (#6067). With it off, the page falls back to the matching Profile & Account
 * hub tab. SSR defers to the browser, since the flag service only runs there.
 */
export const profileRedesignEnabledGuard: CanMatchFn = async (_route, segments) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  if (await readProfileRedesignFlag(featureFlagService, 'profileRedesignEnabledGuard')) return true;

  // Segments start at `account`, so the page is the one after it.
  const target = profileTargetForAccountRoute(segments[1]?.path);
  return router.createUrlTree([target.path], { queryParams: router.getCurrentNavigation()?.extractedUrl.queryParams, fragment: target.fragment });
};

/**
 * With the redesign flag on, sends an old Profile & Account tab to its Account & Settings page, keeping the query (an
 * email-verification return carries its outcome there). A tab that stays on the hub, the server render and a flag
 * that is off all let the tab load.
 */
export const profileRedesignRedirectGuard: CanActivateFn = async (route) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  const featureFlagService = inject(FeatureFlagService);
  const router = inject(Router);

  const accountPath = accountPathForProfileTab(route.routeConfig?.path ?? '', route.fragment);
  if (!accountPath || !(await readProfileRedesignFlag(featureFlagService, 'profileRedesignRedirectGuard'))) return true;
  return router.createUrlTree([accountPath], { queryParams: route.queryParams });
};
