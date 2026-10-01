// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Lens, LensOption, NavLens } from '../interfaces';

export const LENS_COOKIE_KEY = 'lfx-active-lens';

/** Last foundation/project lens viewed — persists the merged 'Projects' entry's return target for hybrid personas. */
export const NAV_LENS_COOKIE_KEY = 'lfx-nav-lens';

export const DEFAULT_LENS: Lens = 'me';

export const DEFAULT_NAV_LENS: NavLens = 'project';

export const LENS_DEFAULT_ROUTES: Readonly<Record<Lens, string>> = {
  me: '/',
  foundation: '/foundation/overview',
  project: '/project/overview',
  org: '/org',
} as const;

export const ALL_LENSES: Readonly<Record<Lens, LensOption>> = {
  me: {
    id: 'me',
    label: 'Me',
    shortLabel: 'Me',
    icon: 'fa-light fa-circle-user',
    activeIcon: 'fa-solid fa-circle-user',
    defaultRoute: LENS_DEFAULT_ROUTES.me,
    testId: 'lens-me',
  },
  foundation: {
    id: 'foundation',
    label: 'Foundation',
    shortLabel: 'Foundat.',
    icon: 'fa-light fa-landmark',
    activeIcon: 'fa-solid fa-landmark',
    defaultRoute: LENS_DEFAULT_ROUTES.foundation,
    testId: 'lens-foundation',
  },
  project: {
    id: 'project',
    label: 'Projects',
    shortLabel: 'Projects',
    icon: 'fa-light fa-layer-group',
    activeIcon: 'fa-solid fa-layer-group',
    defaultRoute: LENS_DEFAULT_ROUTES.project,
    testId: 'lens-project',
  },
  org: {
    id: 'org',
    label: 'Organization',
    shortLabel: 'Organiz.',
    icon: 'fa-light fa-building',
    activeIcon: 'fa-solid fa-building',
    defaultRoute: LENS_DEFAULT_ROUTES.org,
    testId: 'lens-org',
  },
} as const;

export const BOARD_SCOPED_LENSES: readonly Lens[] = ['me', 'foundation', 'org'] as const;
export const PROJECT_SCOPED_LENSES: readonly Lens[] = ['me', 'project', 'org'] as const;
export const DUAL_SCOPED_LENSES: readonly Lens[] = ['me', 'foundation', 'project', 'org'] as const;

/** Lenses backed by the nav API (me/org are not). */
export const NAV_LENSES: readonly NavLens[] = ['foundation', 'project'] as const;

export const NAV_SEARCH_DEBOUNCE_MS = 300;

/**
 * Favorite foundations/projects (GH-2995): a single global per-user preference (not scoped per
 * foundation/project like Social Listening's), keyed by `AppName` on the shared v1 user-preference
 * API. A new app name rather than reusing Social Listening's `'PCC'` — this preference has no PCC
 * heritage to stay compatible with.
 */
export const FAVORITE_PROJECTS_PREFERENCE_APP_NAME = 'LFX One';

/** Fixed preference name — there is exactly one favorites list per user, so no per-scope suffix is needed. */
export const FAVORITE_PROJECTS_PREFERENCE_NAME = 'Favorite Projects';

/** Favorited-item cap — bounds the preference doc payload and keeps the "favorites first" sort cheap. */
export const FAVORITE_PROJECTS_MAX_VALUES = 200;

/** Preference value size cap (stringified JSON array of uids). */
export const FAVORITE_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH = 16_000;

/** Fixed `PreferenceContext.projectId` — favorites are one global per-user list, not scoped per foundation/project. */
export const FAVORITE_PROJECTS_PREFERENCE_CONTEXT_ID = 'global';

/**
 * Resource segments the lens-redirect endpoint may forward to. Every entry MUST have both a
 * `/foundation/<x>` and `/project/<x>` route in app.routes.ts and accept a `?project=<slug>`
 * context (projectQueryParamGuard). The endpoint forwards ONLY to segments in this set — the
 * `:resource` param is never echoed raw into the redirect Location, so it cannot become an open
 * redirect. Keep in sync with the lens-prefixed route table; project.controller.spec.ts asserts
 * each entry exists under both lenses.
 */
export const LENS_REDIRECT_RESOURCES = new Set<string>(['votes', 'meetings', 'mailing-lists', 'groups', 'documents', 'surveys', 'newsletters', 'settings']);
