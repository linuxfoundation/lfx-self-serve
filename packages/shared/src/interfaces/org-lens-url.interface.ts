// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Who selected the organization an Org Lens address is being re-written for
 * (`OrgLensNavigationService.navigateToSelectedOrg`, spec 050 US2).
 *
 * - `switch`: the viewer picked it. The page follows them anywhere inside Org Lens, pushing history
 *   so Back returns to the pre-switch organization and page. Two addresses are handled specially:
 *   the not-found dead end (or anything beneath it) is left for the organization's overview — the
 *   only page a pick of the *already selected* organization still leaves — and a bare `/org` or
 *   legacy `/org/{page}` has no pre-switch organization to return to, so the insert replaces the
 *   entry instead of pushing.
 * - `default`: the app picked it because nothing was selected (or restored the cookie's). Only an
 *   address that names no organization is filled in (`/org/{page}` → `/org/{segment}/{page}`),
 *   replacing the entry; an addressed page and the not-found dead end are never touched.
 *
 * The push/replace and slug rules are specified once, in
 * docs/architecture/frontend/lens-system.md ("Org Lens addresses").
 */
export type OrgLensAddressIntent = 'switch' | 'default';
