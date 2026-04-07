// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DevPersonaPreset, PersonaOption } from '../interfaces';

/** Cookie key for persisting the active persona preset */
export const PERSONA_COOKIE_KEY = 'lfx-active-persona-preset';

/**
 * Persona options available for user selection
 */
export const PERSONA_OPTIONS: PersonaOption[] = [
  // {
  //   value: 'core-developer',
  //   label: 'Core Developer',
  //   description: 'New streamlined developer experience',
  // },
  {
    value: 'maintainer',
    label: 'Maintainer',
    description: 'Project maintainer focused experience',
  },
  {
    value: 'board-member',
    label: 'Board Member',
    description: 'Board member focused experience',
  },
  {
    value: 'executive-director',
    label: 'Executive Director',
    description: 'Executive director focused experience',
  },
];

/**
 * Dev toolbar persona presets for testing different role/access scenarios
 */
export const DEV_PERSONA_PRESETS: DevPersonaPreset[] = [
  // Single-role presets
  { label: 'Contributor', value: 'contributor', personas: ['core-developer'], primary: 'core-developer' },
  {
    label: 'Contributor + Maint (multi proj)',
    value: 'contributor-maintainer-multi',
    personas: ['core-developer', 'maintainer'],
    primary: 'maintainer',
    multiProject: true,
  },
  { label: 'Maint (1 proj)', value: 'maintainer-single', personas: ['maintainer'], primary: 'maintainer' },
  { label: 'Maint (multi proj)', value: 'maintainer-multi', personas: ['maintainer'], primary: 'maintainer', multiProject: true },
  { label: 'Board (1 fdn)', value: 'board-single', personas: ['board-member'], primary: 'board-member' },
  { label: 'Board (multi fdn)', value: 'board-multi', personas: ['board-member'], primary: 'board-member', multiFoundation: true },
  { label: 'ED (1 fdn)', value: 'ed-single', personas: ['executive-director'], primary: 'executive-director' },
  { label: 'ED (multi fdn)', value: 'ed-multi', personas: ['executive-director'], primary: 'executive-director', multiFoundation: true },

  // Multi-role: Maintainer + Board
  { label: 'Maint(1) + Board(1)', value: 'maint1-board1', personas: ['maintainer', 'board-member'], primary: 'board-member' },
  { label: 'Maint(1) + Board(multi)', value: 'maint1-board-multi', personas: ['maintainer', 'board-member'], primary: 'board-member', multiFoundation: true },
  { label: 'Maint(multi) + Board(1)', value: 'maint-multi-board1', personas: ['maintainer', 'board-member'], primary: 'board-member', multiProject: true },
  {
    label: 'Maint(multi) + Board(multi)',
    value: 'maint-multi-board-multi',
    personas: ['maintainer', 'board-member'],
    primary: 'board-member',
    multiProject: true,
    multiFoundation: true,
  },

  // Multi-role: Maintainer + ED
  { label: 'Maint(1) + ED(1)', value: 'maint1-ed1', personas: ['maintainer', 'executive-director'], primary: 'executive-director' },
  {
    label: 'Maint(multi) + ED(multi)',
    value: 'maint-multi-ed-multi',
    personas: ['maintainer', 'executive-director'],
    primary: 'executive-director',
    multiProject: true,
    multiFoundation: true,
  },
];
