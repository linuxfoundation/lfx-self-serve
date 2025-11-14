// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PersonaOption } from '../interfaces';

/**
 * Persona options available for user selection
 */
export const PERSONA_OPTIONS: PersonaOption[] = [
  {
    value: 'core-developer',
    label: 'Core Developer',
    description: 'New streamlined developer experience',
  },
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
];
