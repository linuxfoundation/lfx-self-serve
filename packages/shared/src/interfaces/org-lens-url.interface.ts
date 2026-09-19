// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Who selected the organization an Org Lens address is being re-written for
 * (`OrgLensNavigationService.navigateToSelectedOrg`, spec 050 US2).
 *
 * - `switch`: the viewer picked it. The page follows them anywhere inside Org Lens — including off
 *   the not-found dead end — and history is pushed so Back returns to the pre-switch organization.
 * - `default`: the app picked it because nothing was selected. Only an address that names no
 *   organization is filled in (`/org/{page}` → `/org/{segment}/{page}`), replacing the entry.
 */
export type OrgLensAddressIntent = 'switch' | 'default';
