// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Who selected the organization an Org Lens address is being re-written for
 * (`OrgLensNavigationService.navigateToSelectedOrg`, spec 050 US2).
 *
 * - `switch`: the viewer picked it. The page follows them anywhere inside Org Lens — including off
 *   the not-found dead end — and history is pushed so Back returns to the pre-switch organization
 *   and page. The one exception is an address that named no organization (bare `/org`, legacy
 *   `/org/{page}`): there is nothing to go back to, so the insert replaces the entry — the same
 *   `replaceUrl` a `default` always uses.
 * - `default`: the app picked it because nothing was selected (or restored the cookie's). Only an
 *   address that names no organization is filled in (`/org/{page}` → `/org/{segment}/{page}`),
 *   replacing the entry; an addressed page and the not-found dead end are never touched.
 */
export type OrgLensAddressIntent = 'switch' | 'default';
