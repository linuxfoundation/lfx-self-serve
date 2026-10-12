// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injector, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateChildFn, Router, UrlTree } from '@angular/router';
import { ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';
import { filter, map, Observable, take } from 'rxjs';

import { AccountContextService } from '../services/account-context.service';
import { OrgClaOnlyAccessService } from '../services/org-cla-only-access.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';

const CLA_PAGE = 'easycla';

/**
 * M3 — on `/org/{segment}/…`, an organization the caller reaches only as its CLA Manager opens the
 * EasyCLA page and nothing else: any other page redirects to `/org/{segment}/easycla`. Runs after
 * `orgPathParamGuard` has adopted the addressed organization. UX only — the BFF refuses the data of
 * every non-CLA page for this caller regardless.
 */
export const orgClaOnlyPageGuard: CanActivateChildFn = (childRoute: ActivatedRouteSnapshot): boolean | UrlTree | Observable<boolean | UrlTree> => {
  // Grants and LaunchDarkly are browser-only, so the browser run decides.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }
  const claOnlyAccess = inject(OrgClaOnlyAccessService);
  if (!claOnlyAccess.enabled()) {
    return true;
  }

  const page = pageRouteOf(childRoute);
  if (!page || page.routeConfig?.path === CLA_PAGE) {
    return true;
  }

  const router = inject(Router);
  const accountContext = inject(AccountContextService);
  const roleGrants = inject(OrgRoleGrantsService);
  const segment = page.parent?.paramMap.get(ORG_SEGMENT_PARAM) ?? null;
  const decide = (): boolean | UrlTree =>
    segment && claOnlyAccess.isClaOnly(accountContext.selectedAccount().uid) ? router.createUrlTree(['/org', segment, CLA_PAGE]) : true;

  if (roleGrants.loaded()) {
    return decide();
  }
  return toObservable(roleGrants.loaded, { injector: inject(Injector) }).pipe(
    filter(Boolean),
    take(1),
    map(() => decide())
  );
};

/** The page route directly under `:orgSegment` that `childRoute` is, or sits beneath. */
function pageRouteOf(childRoute: ActivatedRouteSnapshot): ActivatedRouteSnapshot | null {
  let node: ActivatedRouteSnapshot | null = childRoute;
  while (node?.parent) {
    if (node.parent.routeConfig?.path === `:${ORG_SEGMENT_PARAM}`) return node;
    node = node.parent;
  }
  return null;
}
