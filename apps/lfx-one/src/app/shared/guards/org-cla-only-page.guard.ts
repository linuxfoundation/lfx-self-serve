// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injector, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateChildFn, NavigationStart, Router, UrlTree } from '@angular/router';
import { ORG_CLA_ONLY_GRANTS_WAIT_MS, ORG_LENS_CLA_M3_ENABLED_FLAG, ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';
import { filter, firstValueFrom, of, ReplaySubject, take, takeUntil, timeout } from 'rxjs';

import { AccountContextService } from '../services/account-context.service';
import { FeatureFlagService } from '../services/feature-flag.service';
import { OrgClaOnlyAccessService } from '../services/org-cla-only-access.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';

const CLA_PAGE = 'easycla';

/**
 * M3 — on `/org/{segment}/…`, an organization the caller reaches only as its CLA Manager opens the
 * EasyCLA page and nothing else: any other page redirects to `/org/{segment}/easycla`. Runs after
 * `orgPathParamGuard` has adopted the addressed organization. UX only — the BFF refuses the data of
 * every non-CLA page for this caller regardless.
 */
export const orgClaOnlyPageGuard: CanActivateChildFn = async (childRoute: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
  // Grants and LaunchDarkly are browser-only, so the browser run decides.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const page = pageRouteOf(childRoute);
  if (!page || page.routeConfig?.path === CLA_PAGE) {
    return true;
  }

  // Everything is injected before the first await: the injection context does not survive it.
  const featureFlagService = inject(FeatureFlagService);
  const claOnlyAccess = inject(OrgClaOnlyAccessService);
  const router = inject(Router);
  const accountContext = inject(AccountContextService);
  const roleGrants = inject(OrgRoleGrantsService);
  const injector = inject(Injector);

  // `orgPathParamGuard` has already adopted the addressed organization; pin it so a later switch to
  // another company is never judged by this navigation's answer.
  const uid = accountContext.selectedAccount().uid;
  const segment = page.parent?.paramMap.get(ORG_SEGMENT_PARAM) ?? null;
  const claPage = (): UrlTree | null => (segment && claOnlyAccess.isClaOnly(uid) ? router.createUrlTree(['/org', segment, CLA_PAGE]) : null);

  // Watched from before the first await and replayed, so a navigation that starts during a wait still
  // cancels the late redirect below.
  const superseded = new ReplaySubject<void>(1);
  router.events
    .pipe(
      filter((event) => event instanceof NavigationStart),
      take(1)
    )
    .subscribe(() => superseded.next());

  // A dependency that never answers must not hold the navigation: past its wait the page is admitted,
  // and the redirect still happens if LaunchDarkly and the role grants answer before the next navigation
  // starts. The router URL is not consulted: it may still name the previous page while this navigation
  // is in flight. The page's data is refused server-side either way.
  const admitAndRedirectLate = (): true => {
    toObservable(
      computed(() => featureFlagService.providerReady() && roleGrants.loaded()),
      { injector }
    )
      .pipe(filter(Boolean), take(1), takeUntil(superseded))
      .subscribe(() => {
        const target = claPage();
        if (target) {
          void router.navigateByUrl(target, { replaceUrl: true });
        }
      });
    return true;
  };

  // On a cold deep link the flag still reads its `false` default until LaunchDarkly is ready, which
  // would admit the page. A locally pinned value (non-production only) needs no provider.
  if (featureFlagService.getFlagOverride(ORG_LENS_CLA_M3_ENABLED_FLAG) === undefined && !featureFlagService.providerReady()) {
    const ready = await featureFlagService.waitForReady({ guard: 'orgClaOnlyPageGuard', flag: ORG_LENS_CLA_M3_ENABLED_FLAG });
    if (!ready) {
      return admitAndRedirectLate();
    }
  }
  if (!claOnlyAccess.enabled()) {
    return true;
  }

  if (!roleGrants.loaded()) {
    const loaded = await firstValueFrom(
      toObservable(roleGrants.loaded, { injector }).pipe(filter(Boolean), timeout({ first: ORG_CLA_ONLY_GRANTS_WAIT_MS, with: () => of(false) }))
    );
    // The resolver's recorded CLA-only answer does not need the grants.
    if (!loaded) {
      return claPage() ?? admitAndRedirectLate();
    }
  }

  return claPage() ?? true;
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
