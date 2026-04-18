// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Account } from './account.interface';

export type PersonaType = 'contributor' | 'maintainer' | 'board-member' | 'executive-director';

export const VALID_PERSONAS: ReadonlySet<string> = new Set<string>(['contributor', 'maintainer', 'board-member', 'executive-director']);

export const BOARD_SCOPED_PERSONAS: ReadonlySet<PersonaType> = new Set(['board-member', 'executive-director']);

export function isBoardScopedPersona(persona: PersonaType): boolean {
  return BOARD_SCOPED_PERSONAS.has(persona);
}

export const PROJECT_SCOPED_PERSONAS: ReadonlySet<PersonaType> = new Set(['maintainer', 'contributor']);

export function isProjectScopedPersona(persona: PersonaType): boolean {
  return PROJECT_SCOPED_PERSONAS.has(persona);
}

export interface PersistedPersonaState {
  primary: PersonaType;
  all: PersonaType[];
  organizations?: Account[];
}

export interface DevPersonaPreset {
  label: string;
  value: string;
  personas: PersonaType[];
  /** Determines lens behavior. */
  primary: PersonaType;
}

export interface PersonaOption {
  value: PersonaType;
  label: string;
  description?: string;
  icon?: string;
}
