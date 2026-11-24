// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { ServerRequestContext } from '@lfx-one/shared/interfaces';
import { accountPathForProfileTab, profileTargetForAccountRoute } from '@lfx-one/shared/utils';

import { FeatureFlagService } from '../services/feature-flag.service';
import { mirrorOverridesToCookie, readCookieOverride } from './meeting-page-redesign.guard';

/** The server's answer for this visit, so hydration and every later navigation agree with the page it rendered. */
export const PROFILE_REDESIGN_KEY = makeStateKey<boolean>('profileRedesign');

/**
 * The redesign flag for a guard, read in its injection context. The server decides from the flags it evaluated for the
 * render and hands the answer over in TransferState, so a page never renders one way and swaps after load; the browser
 * asks the flag service only when it has no answer, and keeps the hub when that service never gets ready.
 */
function readProfileRedesignFlag(guard: string): Promise<boolean> {
  const transferState = inject(TransferState);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    const context = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;
    const enabled = readCookieOverride(inject(REQUEST, { optional: true }), PROFILE_REDESIGN_FLAG) ?? context?.flags?.profileRedesign ?? false;
    transferState.set(PROFILE_REDESIGN_KEY, enabled);
    return Promise.resolve(enabled);
  }

  const featureFlagService = inject(FeatureFlagService);
  mirrorOverridesToCookie();
  const override = featureFlagService.getFlagOverride(PROFILE_REDESIGN_FLAG);
  if (override !== undefined) return Promise.resolve(override);
  const decided = transferState.get(PROFILE_REDESIGN_KEY, null);
  if (decided !== null) return Promise.resolve(decided);
  return readFromFlagService(featureFlagService, guard);
}

async function readFromFlagService(featureFlagService: FeatureFlagService, guard: string): Promise<boolean> {
  if (!featureFlagService.providerReady() && !(await featureFlagService.waitForReady({ guard, flag: PROFILE_REDESIGN_FLAG }))) return false;
  return featureFlagService.getBooleanFlag(PROFILE_REDESIGN_FLAG, false)();
}

/**
 * Gates `/account` behind the redesign flag (#6067). With it off, the page falls back to the matching Profile & Account
 * hub tab.
 */
export const profileRedesignEnabledGuard: CanMatchFn = async (_route, segments) => {
  const router = inject(Router);
  if (await readProfileRedesignFlag('profileRedesignEnabledGuard')) return true;

  // Segments start at `account`, so the page is the one after it.
  const target = profileTargetForAccountRoute(segments[1]?.path);
  return router.createUrlTree([target.path], { queryParams: router.getCurrentNavigation()?.extractedUrl.queryParams, fragment: target.fragment });
};

/**
 * With the redesign flag on, sends an old Profile & Account tab to its Account & Settings page, keeping the query (an
 * email-verification return carries its outcome there). A tab that stays on the hub, or a flag that is off, lets the
 * tab load.
 */
export const profileRedesignRedirectGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const accountPath = accountPathForProfileTab(route.routeConfig?.path ?? '', route.fragment);
  if (!accountPath) return true;
  if (!(await readProfileRedesignFlag('profileRedesignRedirectGuard'))) return true;
  return router.createUrlTree([accountPath], { queryParams: route.queryParams });
};
