// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOARD_SCOPED_PERSONAS, PROJECT_SCOPED_PERSONAS } from '../constants/persona.constants';
import type { PersonaType } from '../interfaces/persona.interface';

export function isBoardScopedPersona(persona: PersonaType): boolean {
  return BOARD_SCOPED_PERSONAS.has(persona);
}

export function isProjectScopedPersona(persona: PersonaType): boolean {
  return PROJECT_SCOPED_PERSONAS.has(persona);
}
