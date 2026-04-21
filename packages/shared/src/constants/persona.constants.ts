// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOARD_SCOPED_PERSONAS, DevPersonaPreset, PersonaOption, PersonaType } from '../interfaces';

export const PERSONA_COOKIE_KEY = 'lfx-active-persona-preset';

export const DETECTION_SOURCE_MAP: Readonly<Partial<Record<string, PersonaType>>> = {
  board_member: 'board-member',
  executive_director: 'executive-director',
} as const;

/** Sort order, highest first. */
export const PERSONA_PRIORITY: readonly PersonaType[] = ['executive-director', 'board-member', 'maintainer', 'contributor'] as const;

/** Board-scoped personas in priority order. Used to pick a default foundation on lens entry. */
export const BOARD_SCOPED_PERSONA_PRIORITY: readonly PersonaType[] = PERSONA_PRIORITY.filter((p) => BOARD_SCOPED_PERSONAS.has(p));

/** Role label priority for dashboard sorting, highest first. */
export const ROLE_PRIORITY: readonly string[] = [
  'Executive Director',
  'Chair',
  'Vice Chair',
  'Treasurer',
  'Secretary',
  'Counsel',
  'Director',
  'Lead',
  'TAC/TOC Representative',
  'LF Staff',
  'Developer Seat',
  'Maintainer',
  'Contributor',
  'Group Member',
  'None',
] as const;

/** Voting status priority for dashboard sorting, highest first. */
export const VOTING_STATUS_PRIORITY: readonly string[] = ['Voting Rep', 'Alternate Voting Rep', 'Observer', 'Emeritus', 'None'] as const;

export const AFFILIATED_PROJECT_UIDS_CACHE_TTL_MS = 15_000;
export const PERSONAS_CACHE_TTL_MS = 15_000;

export const ROOT_PROJECT_SLUG = 'ROOT';
export const ROOT_PROJECT_UID_CACHE_TTL_MS = 60 * 60 * 1000;

export const PERSONA_OPTIONS: PersonaOption[] = [
  // {
  //   value: 'contributor',
  //   label: 'Contributor',
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

export const DEV_PERSONA_PRESETS: DevPersonaPreset[] = [
  { label: 'Contributor', value: 'contributor', personas: ['contributor'], primary: 'contributor' },
  {
    label: 'Contributor + Maint (multi proj)',
    value: 'contributor-maintainer-multi',
    personas: ['contributor', 'maintainer'],
    primary: 'maintainer',
  },
  { label: 'Maint (1 proj)', value: 'maintainer-single', personas: ['maintainer'], primary: 'maintainer' },
  { label: 'Maint (multi proj)', value: 'maintainer-multi', personas: ['maintainer'], primary: 'maintainer' },
  { label: 'Board (1 fdn)', value: 'board-single', personas: ['board-member'], primary: 'board-member' },
  { label: 'Board (multi fdn)', value: 'board-multi', personas: ['board-member'], primary: 'board-member' },
  { label: 'ED (1 fdn)', value: 'ed-single', personas: ['executive-director'], primary: 'executive-director' },
  { label: 'ED (multi fdn)', value: 'ed-multi', personas: ['executive-director'], primary: 'executive-director' },

  { label: 'Maint(1) + Board(1)', value: 'maint1-board1', personas: ['maintainer', 'board-member'], primary: 'board-member' },
  { label: 'Maint(1) + Board(multi)', value: 'maint1-board-multi', personas: ['maintainer', 'board-member'], primary: 'board-member' },
  { label: 'Maint(multi) + Board(1)', value: 'maint-multi-board1', personas: ['maintainer', 'board-member'], primary: 'board-member' },
  {
    label: 'Maint(multi) + Board(multi)',
    value: 'maint-multi-board-multi',
    personas: ['maintainer', 'board-member'],
    primary: 'board-member',
  },

  { label: 'Maint(1) + ED(1)', value: 'maint1-ed1', personas: ['maintainer', 'executive-director'], primary: 'executive-director' },
  {
    label: 'Maint(multi) + ED(multi)',
    value: 'maint-multi-ed-multi',
    personas: ['maintainer', 'executive-director'],
    primary: 'executive-director',
  },
];
