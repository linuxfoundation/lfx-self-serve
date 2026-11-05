// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { ORG_ROLLUP_SEGMENT } from '@lfx-one/shared/constants';

import { AccountContextService } from '../services/account-context.service';

/**
 * Keeps a page that is single-organization *by definition* off the All Organizations roll-up,
 * sending it to the roll-up's own overview instead (#4125).
 *
 * Two pages qualify. Organization Profile edits one `b2b_org` record, and EasyCLA is about a
 * corporate CLA, which belongs to one company — neither has anything for a combined view to render,
 * and neither ever will.
 *
 * Dropping their sidebar items is not enough on its own. `navigateToSelectedOrg` canonicalizes a
 * legacy `/org/profile` by inserting the selected segment, so in roll-up mode the app itself
 * rewrites that address to `/org/all/profile`, where the page asks for `/api/orgs/uid/all`, the
 * SFID validator refuses the sentinel and the caller lands on an error (#4415, Cursor). A typed or
 * bookmarked address, and a cookie that restores the roll-up under a legacy address, arrive the
 * same way; EasyCLA's own requests need a concrete organization for the same reason.
 *
 * Deliberately NOT a general "this page has no roll-up rendering" gate: the other Org Lens pages
 * are untaught only until #4135–#4137 teach them, and a list of those here would have to be
 * unpicked page by page as they land. This guard is for the permanent exception.
 *
 * Runs on the server too. The selection is restored from the cookie before the first guard, so a
 * roll-up SSR render of `/org/profile` redirects rather than rendering a page it cannot fill.
 */
export const orgRollUpSingleOrgPageGuard: CanActivateFn = (): boolean | UrlTree => {
  if (!inject(AccountContextService).isRollUp()) {
    return true;
  }
  return inject(Router).createUrlTree(['/org', ORG_ROLLUP_SEGMENT, 'overview']);
};
