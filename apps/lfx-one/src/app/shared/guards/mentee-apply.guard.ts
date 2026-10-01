// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MENTORSHIP_MENTEE_PROFILE_CREATED_STATE } from '@lfx-one/shared/constants';
import { mentorshipMenteeApplyQueryParams } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { firstValueFrom, map } from 'rxjs';

/**
 * CanActivate guard on `/mentorship/mentee/apply`.
 *
 * - **SSR** → allow, and let the browser run decide. The server render's profile check goes out
 *   without the session cookie, because `UserService.authenticated` is only set once routing has
 *   begun, so it would always report "no profile" and redirect a registered mentee to register.
 * - **Profile just created** (router state set by a successful registration) → allow.
 *   The profile check may not see the profile that was saved a moment ago, so this one
 *   navigation skips it, or the return trip could bounce straight back to register.
 * - **Has profile** → allow.
 * - **No profile** (or the check failed) → `/mentorship/mentee`, copying `programId` and `programTermId`
 *   onto that URL so a refresh of the register page does not drop them.
 */
export const menteeApplyGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const router = inject(Router);
  const profileJustCreated = router.getCurrentNavigation()?.extras.state?.[MENTORSHIP_MENTEE_PROFILE_CREATED_STATE] === true;
  if (profileJustCreated) {
    return true;
  }

  const menteeService = inject(MentorshipMenteeService);
  const hasProfile = await firstValueFrom(menteeService.hasMenteeProfile().pipe(map((response) => response.hasProfile)));
  if (hasProfile) {
    return true;
  }

  return router.createUrlTree(['/mentorship/mentee'], {
    queryParams: mentorshipMenteeApplyQueryParams(route.queryParamMap),
  });
};
