// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Available persona types for UI customization
 * @description Defines the different user personas that can be selected
 */
export type PersonaType = 'core-developer' | 'maintainer' | 'projects' | 'board-member' | 'executive-director';

/** Board-scoped personas that see foundation-level dashboards */
export const BOARD_SCOPED_PERSONAS: ReadonlySet<PersonaType> = new Set(['board-member', 'executive-director']);

/** Check if a persona value is board-scoped (sees foundation-level dashboards) */
export function isBoardScopedPersona(persona: PersonaType): boolean {
  return BOARD_SCOPED_PERSONAS.has(persona);
}

/**
 * Persona option configuration
 * @description Structure for persona selection dropdown options
 */
export interface PersonaOption {
  /** Unique identifier for the persona */
  value: PersonaType;
  /** Display label for the persona */
  label: string;
  /** Optional description of the persona */
  description?: string;
  /** Optional icon class for visual representation */
  icon?: string;
}
