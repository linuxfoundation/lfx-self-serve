// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { COMMITTEE_LABEL } from './committees.constants';
import type { Lens, LensOption, NavbarGhostItem, NavbarRoleStyle, OrgRolePersona, PersonaType } from '../interfaces';

/**
 * Navbar-only label/icon overrides for the lens tabs. The navbar presents the Me lens as "Home"
 * (house icon); every other lens keeps its `ALL_LENSES` label and icons.
 */
export const NAVBAR_LENS_OVERRIDES: Readonly<Partial<Record<Lens, Pick<LensOption, 'label' | 'icon' | 'activeIcon'>>>> = {
  me: { label: 'Home', icon: 'fa-light fa-house', activeIcon: 'fa-solid fa-house' },
};

/** Role glyph and ink on the navbar's dark surface, per persona. */
export const NAVBAR_ROLE_STYLES: Readonly<Record<PersonaType, NavbarRoleStyle>> = {
  'executive-director': { icon: 'fa-solid fa-star', ink: lfxColors.amber[300] },
  'board-member': { icon: 'fa-solid fa-chair-office', ink: lfxColors.violet[300] },
  maintainer: { icon: 'fa-solid fa-shield-halved', ink: lfxColors.blue[400] },
  contributor: { icon: 'fa-solid fa-code', ink: lfxColors.gray[200] },
};

/** How each role reads in front of its project list in the role tooltip ("Maintainer of", "Contributor to"). */
export const NAVBAR_ROLE_PREPOSITIONS: Readonly<Record<PersonaType, string>> = {
  'executive-director': 'of',
  'board-member': 'of',
  maintainer: 'of',
  contributor: 'to',
};

/** Ink for a context role pill when the user holds no detected role on the selected project. */
export const NAVBAR_DEFAULT_ROLE_STYLE: NavbarRoleStyle = { icon: 'fa-solid fa-user', ink: lfxColors.gray[200] };

/** Public site listed under the LFX apps in the navbar brand menu. */
export const NAVBAR_BRAND_SITE = { domain: 'linuxfoundation.org', url: 'https://www.linuxfoundation.org/' } as const;

/** Hover delay before a navbar tooltip appears, in ms (keyboard focus shows it immediately). */
export const NAV_TOOLTIP_SHOW_DELAY_MS = 80;

/** Gap between a navbar tooltip and its trigger, in px. */
export const NAV_TOOLTIP_OFFSET_PX = 8;

/** Grace period before an interactive navbar tooltip hides, so the pointer can cross the gap into it (ms). */
export const NAV_TOOLTIP_HIDE_DELAY_MS = 150;

/**
 * What each organization role lets the user do, shown in the org context card's role tooltip.
 * `{source}` is the organization an inherited role comes from (see NAVBAR_ORG_ROLE_UNKNOWN_SOURCE).
 */
export const NAVBAR_ORG_ROLE_TOOLTIPS: Readonly<Record<OrgRolePersona, string>> = {
  'direct-writer': "You can view and edit this organization's profile, members and settings.",
  'direct-auditor': "You can view this organization's details, but not edit them.",
  'inherited-writer': 'You can view and edit this organization through your admin access to {source}.',
  'inherited-auditor': 'You can view this organization through your access to {source}.',
};

/** Stands in for `{source}` when the organization an inherited role comes from is unknown. */
export const NAVBAR_ORG_ROLE_UNKNOWN_SOURCE = 'a related organization';

/** Appended to a direct role on an organization that is part of a hierarchy (the "(Original)" label). */
export const NAVBAR_ORG_ROLE_DIRECT_SUFFIX = 'Granted directly on this organization.';

/** Decorative, disabled menu rows shown faded beneath the navbar's no-access message. */
export const NAVBAR_NO_ACCESS_GHOST_ITEMS: readonly NavbarGhostItem[] = [
  { label: 'Dashboard', icon: 'fa-light fa-grid-2' },
  { label: 'Meetings', icon: 'fa-light fa-calendar' },
  { label: COMMITTEE_LABEL.plural, icon: 'fa-light fa-users-between-lines' },
  { label: 'Mailing Lists', icon: 'fa-light fa-envelope' },
  { label: 'Documents', icon: 'fa-light fa-folder-open' },
  { label: 'Votes', icon: 'fa-light fa-check-to-slot' },
  { label: 'Surveys', icon: 'fa-light fa-clipboard-list' },
];
