// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EventTabId } from '../interfaces';

import { ACCOUNT_SETTINGS_SECTIONS, PROFILE_SETTINGS_PATH } from './profile.constants';

/** Query param added to every openprofile redirect target, so old-path hits are searchable in Datadog RUM. */
export const OPENPROFILE_REDIRECT_MARKER = { key: 'from', value: 'openprofile' } as const;

/**
 * Exact old Individual Dashboard (openprofile.dev) paths and their Self Serve targets. Keys are lowercase
 * with no trailing slash. Parameterised paths (`/myevents/:slug`, `/profile/:username`, ...) are resolved in code.
 */
export const OPENPROFILE_REDIRECTS: Readonly<Record<string, string>> = {
  '/edit': '/profile/attributions',
  '/edit/profile': '/profile/attributions',
  '/edit/visibility': '/profile/attributions',
  '/edit/visbility': '/profile/attributions',
  '/edit/password': `${PROFILE_SETTINGS_PATH}#${ACCOUNT_SETTINGS_SECTIONS.PASSWORD}`,
  '/edit/email-management': `${PROFILE_SETTINGS_PATH}#${ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS}`,
  '/edit/registered-emails': `${PROFILE_SETTINGS_PATH}#${ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS}`,
  '/edit/linux-email': '/profile/identities',
  '/edit/connected-accounts': '/profile/identities',
  '/myevents': '/events',
  '/event': '/events',
  '/myevents/travel-funding': '/events?tab=travel-funding',
  '/travel-fund/application': '/events?tab=travel-funding',
  '/my-meetings': '/meetings',
  '/community-calendar': '/meetings',
  '/my-calendar': '/meetings',
  '/myrewards': '/me/training?tab=rewards',
  '/myrewards/coupons': '/me/training?tab=rewards',
  '/myrewards/transactions': '/profile/transactions',
  '/myenrollments': '/profile/individual-enrollment',
  '/developer-settings': `${PROFILE_SETTINGS_PATH}#${ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS}`,
  '/code': '/profile/attributions',
  '/code/affiliations': '/profile/attributions',
  '/data-visibility': '/profile/attributions',
  '/employer-attribution': '/profile/attributions',
  '/newsletter': '/newsletters/my',
  '/skills': '/',
  '/admin-view': '/',
  '/playground': '/',
  '/user-profile': '/',
};

/** Old `/myevents?applyfor=<value>` deep-link values and the My Events tab each one opens. */
export const OPENPROFILE_APPLYFOR_TABS: Readonly<Record<string, EventTabId>> = {
  'visa-letter': 'visa-letters',
  'travel-funding': 'travel-funding',
};

/**
 * `/profile/<segment>` paths Self Serve routes itself. Any other single segment is an old public-profile
 * username and redirects to `/u/<username>`. `profile.routes.spec.ts` keeps this in step with PROFILE_ROUTES.
 */
export const PROFILE_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  'attributions',
  'identities',
  'individual-enrollment',
  'clas',
  'transactions',
  'settings',
  'linux-email',
  'password',
  'email',
  'emails',
  'attribution',
  'overview',
  'edit',
  'affiliations',
  'work-experience',
  'identity-services',
  'badges',
  'certificates',
  'visibility',
  'manage',
]);
