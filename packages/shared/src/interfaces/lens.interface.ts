// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LensItem } from './navigation.interface';

/**
 * Navigation lens types
 * Each lens represents a top-level navigation context that determines sidebar content
 */
export type Lens = 'me' | 'foundation' | 'project' | 'org';

/**
 * Inputs to `deriveAllowedLenses` — the persona roles that confer lens access.
 * See that function for the persona-only derivation (LFXV2-2755).
 */
export interface LensGrantInputs {
  /** Persona holds a board-scoped role (ED / Board Member). */
  hasBoardRole: boolean;
  /** Persona holds a project-scoped role (Maintainer / Contributor). */
  hasProjectRole: boolean;
  /** Root writer — bypasses persona filtering entirely. */
  isRootWriter: boolean;
  /** Org lens dark-launch flag. */
  isOrgLensEnabled: boolean;
}

/**
 * Configuration for a lens option displayed in the L1 Rail
 */
export interface LensOption {
  /** Lens identifier */
  id: Lens;
  /** Full display label (e.g., "Foundation") */
  label: string;
  /** Short label for the L1 Rail (e.g., "Fdn") */
  shortLabel: string;
  /** FontAwesome icon class (inactive state) */
  icon: string;
  /** FontAwesome icon class (active state) */
  activeIcon: string;
  /** Default route to navigate to when this lens is activated */
  defaultRoute: string;
  /** Test ID for the lens button */
  testId: string;
}

/**
 * Tab options for the project selector in hybrid persona mode
 */
export type SelectorTab = 'all' | 'foundations' | 'projects';

/**
 * Precomputed per-row state for the project selector dropdown.
 * All fields are derived once in the displayedItems computed so the template binds to plain
 * values — no functions in template bindings (signals-first / zoneless memoization).
 */
export interface DisplayLensItem {
  item: LensItem;
  isNested: boolean;
  isSelected: boolean;
  roleLabel: string;
  roleIcon: string;
}
