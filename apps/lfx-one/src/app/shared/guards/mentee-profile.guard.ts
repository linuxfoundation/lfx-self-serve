// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { mentorshipMenteeApplyIds } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { map } from 'rxjs';
import { firstValueFrom } from 'rxjs';

/**
 * CanActivate guard on the mentee register route (`/mentorship/mentee`).
 *
 * - **Has profile** and both apply ids → `/mentorship/mentee/apply` with those ids.
 * - **Has profile** otherwise → `/mentorship/mentee/overview` (the shell).
 * - **No profile** (404 / error / mock default) → returns `true`, letting the
 *   register page render. Apply ids on the URL stay there for the return trip.
 *
 * The service's `hasMenteeProfile()` already catches HTTP errors and returns
 * `{ hasProfile: false }`, so no guard-level `catchError` is needed.
 */
export const menteeRegisterGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
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
