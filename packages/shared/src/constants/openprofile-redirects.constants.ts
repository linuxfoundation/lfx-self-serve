// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { EventTabId } from '../interfaces';

import { PROFILE_DEVELOPER_SETTINGS_PATH, PROFILE_EMAIL_PATH, PROFILE_PASSWORD_PATH } from './profile.constants';

/** Query param added to every openprofile redirect target, so old-path hits are searchable in Datadog RUM. */
export const OPENPROFILE_REDIRECT_MARKER = { key: 'from', value: 'openprofile' } as const;

/** No old openprofile path comes close; longer paths skip the lookup entirely. */
export const OPENPROFILE_MAX_PATH_LENGTH = 512;

/** Raw (still percent-encoded) path segment safe to carry over as an event id or username. */
export const OPENPROFILE_SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Parameterised old paths, matched against the slash-trimmed raw path. */
export const OPENPROFILE_TRAVEL_FUNDING_PATH = /^\/myevents\/travel-funding\/([^/]+)$/i;
export const OPENPROFILE_EVENT_SLUG_PATH = /^\/myevents\/[^/]+$/i;
export const OPENPROFILE_NEWSLETTER_PATH = /^\/newsletter\/[^/]+$/i;
export const OPENPROFILE_PROFILE_USERNAME_PATH = /^\/profile\/([^/]+)$/i;

/**
 * Exact old Individual Dashboard (openprofile.dev) paths and their Self Serve targets. Keys are lowercase
 * with no trailing slash. Parameterised paths (`/myevents/:slug`, `/profile/:username`, ...) are resolved in code.
 */
export const OPENPROFILE_REDIRECTS: Readonly<Record<string, string>> = {
  '/edit': '/profile/attributions',
  '/edit/profile': '/profile/attributions',
  '/edit/visibility': '/profile/attributions',
  '/edit/visbility': '/profile/attributions',
  // Settings sections go through path aliases: a #fragment would not survive the server-side login returnTo.
  '/edit/password': PROFILE_PASSWORD_PATH,
  '/edit/email-management': PROFILE_EMAIL_PATH,
  '/edit/registered-emails': PROFILE_EMAIL_PATH,
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
  '/developer-settings': PROFILE_DEVELOPER_SETTINGS_PATH,
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
  'developer-settings',
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
