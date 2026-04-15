// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Lens, LensOption } from '../interfaces/lens.interface';

/** Cookie key for persisting the active lens selection */
export const LENS_COOKIE_KEY = 'lfx-active-lens';

/** Default lens when no selection is persisted */
export const DEFAULT_LENS: Lens = 'me';

/** Default route for each lens */
export const LENS_DEFAULT_ROUTES: Readonly<Record<Lens, string>> = {
  me: '/',
  foundation: '/foundation/overview',
  project: '/project/overview',
  org: '/org',
} as const;

/** All lens definitions — visibility is controlled by persona at runtime */
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

/** Lenses visible to board-scoped personas (board-member, executive-director) */
export const BOARD_SCOPED_LENSES: readonly Lens[] = ['me', 'foundation', 'org'] as const;

/** Lenses visible to project-scoped personas (maintainer, contributor) */
export const PROJECT_SCOPED_LENSES: readonly Lens[] = ['me', 'project', 'org'] as const;

/** Lenses visible to dual-role personas (users with both board and project roles) */
export const DUAL_SCOPED_LENSES: readonly Lens[] = ['me', 'foundation', 'project', 'org'] as const;
