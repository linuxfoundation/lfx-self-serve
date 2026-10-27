// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Lens } from './lens.interface';
import type { PersonaType } from './persona.interface';

/** Which trigger a lens context selector renders: the classic sidebar card, or the navbar's dark context card. */
export type ContextSelectorVariant = 'default' | 'navbar';

/** Icon and ink a role carries in the navbar (me-card role circles, project context role pill). */
export interface NavbarRoleStyle {
  /** Font Awesome solid glyph for the role. */
  icon: string;
  /** Foreground/border color of the role mark on the navbar's dark surface. */
  ink: string;
}

/** A project or foundation a role was detected on, listed as a chip in the role mark's tooltip. */
export interface NavbarRoleProject {
  uid: string;
  slug: string;
  name: string;
  isFoundation: boolean;
  /** Lens its overview opens in, or `null` when the viewer can use neither lens for it (its chip is then a plain label). */
  lens: Lens | null;
}

/** A role mark as rendered on the navbar's me card. */
export interface NavbarRoleMark extends NavbarRoleStyle {
  persona: PersonaType;
  label: string;
  /** Tooltip heading: the label, followed by its preposition when projects are listed ("Maintainer of"). */
  title: string;
  /** Projects / foundations the role was detected on. */
  projects: NavbarRoleProject[];
  /** The same projects as tooltip chips, keyed by slug. */
  chips: NavTooltipItem[];
  ariaLabel: string;
}

/** A link in the navbar's brand (LF symbol) menu. */
export interface NavbarBrandApp {
  name: string;
  blurb: string;
  url: string;
  /** Font Awesome icon class. */
  icon: string;
  testId: string;
}

/**
 * A visual block of the navbar menu: an optional section heading over a run of items. Blocks are
 * spaced apart, and a block opened by a `dividerBefore` item draws the dashed rule above itself.
 */
export interface NavbarMenuBlock<T> {
  key: string;
  ruleBefore: boolean;
  section: T | null;
  items: T[];
}

/** Side of the trigger a navbar tooltip opens on. `right` is the collapsed rail's: beside the trigger, vertically centred. */
export type NavTooltipPlacement = 'top' | 'bottom' | 'right';

/**
 * What started a navbar collapse / peek change, which decides focus afterwards: `pointer` drops focus from the navbar,
 * `keyboard` keeps it on a control the new state still shows, `none` leaves it where the change put it.
 */
export type NavbarMorphFocus = 'pointer' | 'keyboard' | 'none';

/** A chip in an interactive navbar tooltip. */
export interface NavTooltipItem {
  /** Stable identity, emitted when the chip is chosen. */
  key: string;
  label: string;
  /** Listed for context only: rendered as a plain label rather than a button, and never emitted. */
  static?: boolean;
}

/** A decorative, non-interactive menu row (the faded preview under the no-access message). */
export interface NavbarGhostItem {
  label: string;
  /** Font Awesome icon class. */
  icon: string;
}

/** Position of the lens tabs' sliding active pill, in px relative to the tab group. */
export interface NavbarTabIndicator {
  left: number;
  width: number;
}
