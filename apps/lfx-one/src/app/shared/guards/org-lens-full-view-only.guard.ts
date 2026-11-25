// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injector, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { ORG_CLA_ONLY_GRANTS_WAIT_MS, ORG_LENS_EMPLOYEE_VIEW_HOME_PAGE } from '@lfx-one/shared/constants';
import { orgLensPagePath } from '@lfx-one/shared/utils';
import { filter, firstValueFrom, of, timeout } from 'rxjs';

import { OrgLensViewModeService } from '../services/org-lens-view-mode.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';

/**
 * Keeps a page the all employee view hides (epic #5845) closed to it: in the employee view the route redirects to the
 * company Overview, in the full view it opens as before.
 *
 * ```ts
 * { path: 'people', canActivate: [orgLensFullViewOnlyGuard()], ... }
 * ```
 *
 * Mirrors `orgLensLfStaffOnlyGuard`'s redirect: the fallback stays in the company the address names, so an absolute
 * `/company/overview` never lands on the cookie company. The view mode is only known once the role grants have
 * loaded, so the guard waits for them (bounded); a lookup that never answers admits the page, which is safe because the
 * server refuses the hidden page's data in the employee view regardless (`blockEmployeeView`). Browser-only for the same
 * reason the grants are.
 *
 * @param page the page to redirect to; defaults to Overview.
 */
export function orgLensFullViewOnlyGuard(page: string = ORG_LENS_EMPLOYEE_VIEW_HOME_PAGE): CanActivateFn {
  return async (_route, state): Promise<boolean | UrlTree> => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) {
      return true;
    }
    // Everything is injected before the first await: the injection context does not survive it.
    const viewMode = inject(OrgLensViewModeService);
    const roleGrants = inject(OrgRoleGrantsService);
    const router = inject(Router);
    const injector = inject(Injector);

    const redirect = (): UrlTree => {
      const segments = router.parseUrl(state.url).root.children['primary']?.segments.map((segment) => segment.path) ?? [];
      return router.parseUrl(orgLensPagePath(segments, page));
    };

    // The mode may already be recorded (the address resolver or a selector row marks it before the grants answer), and a
    // recorded employee view must not wait on, or fail open past, the role-grants wait.
    if (viewMode.isEmployeeView()) {
      return redirect();
    }

    if (!roleGrants.loaded()) {
      const loaded = await firstValueFrom(
        toObservable(roleGrants.loaded, { injector }).pipe(filter(Boolean), timeout({ first: ORG_CLA_ONLY_GRANTS_WAIT_MS, with: () => of(false) }))
      );
      // The wait ran out: admit (the server refuses the page's data), unless the mode was recorded meanwhile.
      if (!loaded) {
        return viewMode.isEmployeeView() ? redirect() : true;
      }
    }
    return viewMode.isEmployeeView() ? redirect() : true;
  };
}
