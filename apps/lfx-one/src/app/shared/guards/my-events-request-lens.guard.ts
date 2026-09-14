// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { MY_EVENTS_REQUEST_TAB_IDS } from '@lfx-one/shared/constants';
import { EventTabId } from '@lfx-one/shared/interfaces';

import { LensService } from '../services/lens.service';

/**
 * Forces the `me` lens for a deep-linked visa-letter/travel-funding request
 * (`/events?tab=visa-letters&event=<id>`) before `lensRedirectGuard` runs.
 *
 * `MyEventsDashboardComponent` — and the deep-link auto-open it hosts — only ever mounts under
 * the `me`/`project` lens (`EventsDashboardComponent` swaps to the org/foundation dashboards
 * otherwise), so a link opened while the persisted lens is `org` or `foundation` would silently
 * never auto-open the dialog. `setLens('me')` applies and persists the switch without navigating
 * (unlike `switchLens`), so the deep link's own URL still resolves the route on this pass.
 *
 * Calls `setLens('me')` unconditionally (no `activeLens() !== 'me'` guard) — `activeLens()` is a
 * read-time clamp over the persisted `selectedLens`, and can already read `'me'` transiently
 * (writer grants load post-hydration, see `getAllowedLensIds()`) while `selectedLens` itself is
 * still `'foundation'`/`'project'`. Gating on `activeLens()` would then skip the very correction
 * this guard exists to make. `setLens` is safe to call redundantly (`applyLensSelection` no-ops
 * when unchanged) and `'me'` is always in the allowed set, so calling it unconditionally can't regress.
 */
export const myEventsRequestLensGuard: CanActivateFn = (route) => {
  const lensService = inject(LensService);

  const tab = route.queryParams['tab'] as EventTabId | undefined;
  const eventId = route.queryParams['event'];
  if (tab && MY_EVENTS_REQUEST_TAB_IDS.has(tab) && eventId) {
    lensService.setLens('me');
  }

  return true;
};
