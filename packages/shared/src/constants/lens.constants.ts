// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Lens, LensOption, NavLens } from '../interfaces';
import type { PersonaType } from '../interfaces/persona.interface';

export const LENS_COOKIE_KEY = 'lfx-active-lens';

export const DEFAULT_LENS: Lens = 'me';

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
    label: 'Project',
    shortLabel: 'Project',
    icon: 'fa-light fa-laptop-code',
    activeIcon: 'fa-solid fa-laptop-code',
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

export const LENS_PERSONA_MAP: Readonly<Record<NavLens, readonly PersonaType[]>> = {
  foundation: ['board-member', 'executive-director'],
  project: ['contributor', 'maintainer', 'executive-director'],
} as const;

export const NAV_MIN_ITEMS_PER_RESPONSE = 15;
export const NAV_MAX_UPSTREAM_ITERATIONS = 10;
export const NAV_SEARCH_DEBOUNCE_MS = 300;
