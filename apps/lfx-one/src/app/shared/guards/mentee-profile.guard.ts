// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { mentorshipMenteeApplyIds } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { map } from 'rxjs';
import { firstValueFrom } from 'rxjs';

/**
 * CanActivate guard on the mentee register route (`/mentorship/mentee`).
 *
 * - **SSR** → `true`, and the browser run decides. The server render's profile check goes out
 *   without the session cookie (see `menteeApplyGuard`), so its answer cannot be trusted.
 * - **Has profile** and both apply ids → `/mentorship/mentee/apply` with those ids.
 * - **Has profile** otherwise → `/mentorship/mentee/overview` (the shell).
 * - **No profile** (or the check failed) → returns `true`, letting the register page
 *   render. Apply ids on the URL stay there for the return trip.
 *
 * The service's `hasMenteeProfile()` already catches HTTP errors and returns
 * `{ hasProfile: false }`, so no guard-level `catchError` is needed.
 */
export const menteeRegisterGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const menteeService = inject(MentorshipMenteeService);
  const router = inject(Router);

  const hasProfile = await firstValueFrom(menteeService.hasMenteeProfile().pipe(map((response) => response.hasProfile)));

  if (hasProfile) {
    const applyIds = mentorshipMenteeApplyIds(route.queryParamMap);
    if (applyIds) {
      return router.createUrlTree(['/mentorship/mentee/apply'], { queryParams: applyIds });
    }
    return router.createUrlTree(['/mentorship/mentee/overview']);
  }

  return true;
};
