// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Navigation lens types
 * Each lens represents a top-level navigation context that determines sidebar content
 */
export type Lens = 'me' | 'foundation' | 'project' | 'org';

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
