// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { CanMatchFn, Route, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MEETING_PAGE_LEGACY_STATE, MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { MeetingPageRedesignDecision, ServerRequestContext } from '@lfx-one/shared/interfaces';

import { FeatureFlagService } from '../services/feature-flag.service';
import { authenticatedMatchGuard } from './authenticated-match.guard';

/** The page the server rendered for a `/meetings/:id` URL; read once by the browser's first match. */
export const MEETING_PAGE_REDESIGN_KEY = makeStateKey<MeetingPageRedesignDecision>('meetingPageRedesign');

/**
 * CanMatch guard choosing the redesigned `/meetings/:id` page over the legacy one, which follows it unguarded.
 * @description Matches only for a signed-in viewer with `MEETINGS_REDESIGN_FLAG` on and no `?password=` or `?action=`
 * in the URL; the page itself sends anything else it can't serve back here with `MEETING_PAGE_LEGACY_STATE`.
 * The server decides from `ServerRequestContext.flags` and hands the decision over in TransferState, so hydration
 * never swaps pages; later client navigations ask `FeatureFlagService`. A non-production QA override reaches the
 * server through a cookie mirrored from local storage.
 */
export const meetingPageRedesignGuard: CanMatchFn = async (route, segments) => {
  const id = segments[1]?.path ?? '';
  const transferState = inject(TransferState);
  const eligible = isEligible(inject(Router), route, id) && (authenticatedMatchGuard(route, segments) as boolean);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    const context = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;
    const flag = readCookieOverride(inject(REQUEST, { optional: true })) ?? context?.flags?.meetingsRedesign ?? false;
    const enabled = eligible && flag;
    transferState.set(MEETING_PAGE_REDESIGN_KEY, { id, enabled });
    return enabled;
  }

  mirrorOverridesToCookie();
  const decided = transferState.get(MEETING_PAGE_REDESIGN_KEY, null);
  if (decided) {
    transferState.remove(MEETING_PAGE_REDESIGN_KEY);
    if (decided.id === id) {
      return decided.enabled;
    }
  }
  return eligible && (await resolveFlag(inject(FeatureFlagService)));
};

function isEligible(router: Router, route: Route, id: string): boolean {
  const navigation = router.getCurrentNavigation();
  const params = navigation?.extractedUrl.queryParamMap;
  return !navigation?.extras.state?.[MEETING_PAGE_LEGACY_STATE] && !params?.has('password') && !params?.has('action') && !showsLegacyPage(router, route, id);
}

// The legacy page rewrites its own query params; those navigations must keep it rather than remount this route.
function showsLegacyPage(router: Router, route: Route, id: string): boolean {
  let shown = router.routerState.snapshot.root;
  while (shown.firstChild) {
    shown = shown.firstChild;
  }
  return shown.routeConfig?.path === route.path && shown.routeConfig !== route && shown.paramMap.get('id') === id;
}

async function resolveFlag(featureFlagService: FeatureFlagService): Promise<boolean> {
  const override = featureFlagService.getFlagOverride(MEETINGS_REDESIGN_FLAG);
  if (override !== undefined) {
    return override;
  }
  if (!featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'meetingPageRedesignGuard', flag: MEETINGS_REDESIGN_FLAG });
    if (!ready) {
      return false;
    }
  }
  return featureFlagService.getBooleanFlag(MEETINGS_REDESIGN_FLAG, false)();
}

// The server can't read local storage, so the QA override travels as a cookie; ignored in production like the original.
function readCookieOverride(request: Request | null): boolean | undefined {
  if (environment.production || !request) {
    return undefined;
  }
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FEATURE_FLAG_OVERRIDE_STORAGE_KEY}=`));
  if (!raw) {
    return undefined;
  }
  try {
    const value = (JSON.parse(decodeURIComponent(raw.slice(FEATURE_FLAG_OVERRIDE_STORAGE_KEY.length + 1))) as Record<string, unknown>)[MEETINGS_REDESIGN_FLAG];
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

function mirrorOverridesToCookie(): void {
  if (environment.production) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(FEATURE_FLAG_OVERRIDE_STORAGE_KEY);
    document.cookie = raw
      ? `${FEATURE_FLAG_OVERRIDE_STORAGE_KEY}=${encodeURIComponent(raw)}; path=/; SameSite=Lax`
      : `${FEATURE_FLAG_OVERRIDE_STORAGE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Storage can be blocked; the server then keeps LaunchDarkly's answer.
  }
}
