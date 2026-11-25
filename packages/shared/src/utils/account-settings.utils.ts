// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCOUNT_BASE_PATH, ACCOUNT_ROUTE_PROFILE_TARGETS, PROFILE_TAB_ACCOUNT_ROUTES } from '../constants/profile.constants';
import { AccountSettingsTarget } from '../interfaces/profile.interface';

/**
 * The Account & Settings page an old Profile & Account tab moves to, e.g. `settings` + `#password` →
 * `/account/password`; `null` for a tab that stays on the hub.
 */
export function accountPathForProfileTab(tab: string, fragment?: string | null): string | null {
  const sectionKey = fragment ? `${tab}#${fragment}` : '';
  const key = sectionKey && Object.hasOwn(PROFILE_TAB_ACCOUNT_ROUTES, sectionKey) ? sectionKey : tab;
  return Object.hasOwn(PROFILE_TAB_ACCOUNT_ROUTES, key) ? `${ACCOUNT_BASE_PATH}/${PROFILE_TAB_ACCOUNT_ROUTES[key]}` : null;
}

/** The Profile & Account hub page an `/account` page falls back to while the redesign flag is off. */
export function profileTargetForAccountRoute(route: string | undefined): AccountSettingsTarget {
  return route && Object.hasOwn(ACCOUNT_ROUTE_PROFILE_TARGETS, route) ? ACCOUNT_ROUTE_PROFILE_TARGETS[route] : { path: '/profile' };
}
