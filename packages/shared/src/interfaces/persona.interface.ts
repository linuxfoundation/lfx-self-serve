// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Available persona types for UI customization
 * @description Defines the different user personas that can be selected
 */
export type PersonaType = 'core-developer' | 'maintainer' | 'old-ui';

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
