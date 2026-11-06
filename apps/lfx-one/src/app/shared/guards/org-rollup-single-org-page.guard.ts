// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { ORG_EASYCLA_RETURN_ORG_PARAM, ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';

import { AccountContextService } from '../services/account-context.service';

const CLA_PAGE = 'easycla';

/**
 * Keeps a page that is single-organization *by definition* off a family roll-up, sending it to
 * that roll-up's own overview instead (#4125).
 *
 * Three pages qualify. Organization Profile edits one `b2b_org` record, EasyCLA is about a
 * corporate CLA, which belongs to one company, and Crowdfunding Donations reads
 * `/api/crowdfunding/org-donations`, which takes one `orgUid` — none has anything for a combined
 * view to render, and none ever will.
 *
 * Dropping their sidebar items is not enough on its own. `navigateToSelectedOrg` canonicalizes a
 * legacy `/org/profile` by inserting the selected segment, so in roll-up mode the app itself
 * rewrites that address to `/org/family-{id}/profile`, where the page asks for `/api/orgs/uid/family-{id}`, the
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
export const orgRollUpSingleOrgPageGuard: CanActivateFn = (route: ActivatedRouteSnapshot): boolean | UrlTree => {
  const accountContext = inject(AccountContextService);
  if (!accountContext.isRollUp()) {
    return true;
  }
  // One address is let through: a corporate-signing return minted on the leftover
  // `/org/easycla/{group}?org={A}&signed=1` shape, which the BFF still generates while
  // `ORG_EASYCLA_RETURN_IN_PATH` is off. It names its own organization and `OrgClaReturnService`
  // adopts it after an access check — but that has not run when this guard fires, so redirecting
  // on a roll-up cookie would throw away the agreement destination and the signing confirmation
  // for a trip opened in another tab. Adoption re-points the selection off the roll-up anyway, so
  // nothing combined renders. `navigateToSelectedOrg` carves the same return out of its default
  // insert, for the same reason (#4415, Copilot).
  //
  // All three conditions matter. Only the EasyCLA page adopts the parameter, so on Profile it is
  // just an unread query string and `?org=` would have waved `/org/family-{id}/profile` straight through
  // to the error this guard exists to prevent. Only the LEGACY mount can carry such a return — an
  // addressed `/org/{segment}/easycla` already names its organization — so `/org/family-{id}/easycla?org=`
  // is a hand-made address, not a return, and is refused. And an empty value adopts nothing
  // (#4415, Copilot again).
  if (isLegacyEasyclaReturn(route)) {
    return true;
  }
  return inject(Router).createUrlTree(['/org', accountContext.selectedAccount().uid, 'overview']);
};

/**
 * A corporate-signing return on the leftover mount: the EasyCLA page, reached at `/org/easycla/…`
 * with no `:orgSegment` above it, carrying a non-empty organization to adopt.
 */
function isLegacyEasyclaReturn(route: ActivatedRouteSnapshot): boolean {
  if (!route.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM)?.trim()) {
    return false;
  }
  if (!route.pathFromRoot.some((node) => node.routeConfig?.path === CLA_PAGE)) {
    return false;
  }
  return !route.pathFromRoot.some((node) => node.routeConfig?.path === `:${ORG_SEGMENT_PARAM}`);
}
