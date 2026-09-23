// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MENTORSHIP_MENTEE_PROFILE_CREATED_STATE } from '@lfx-one/shared/constants';
import { mentorshipMenteeApplyQueryParams } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { firstValueFrom, map } from 'rxjs';

/**
 * CanActivate guard on `/mentorship/mentee/apply`.
 *
 * - **Profile just created** (router state from a validated registration) → allow.
 *   The profile check is still a mock that returns false, so this one navigation
 *   has to skip it or the return trip would bounce straight back to register.
 * - **Has profile** → allow.
 * - **No profile** → `/mentorship/mentee`, copying `programId` and `programTermId`
 *   onto that URL so a refresh of the register page does not drop them.
 */
export const menteeApplyGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const profileJustCreated = router.getCurrentNavigation()?.extras.state?.[MENTORSHIP_MENTEE_PROFILE_CREATED_STATE] === true;
  if (profileJustCreated) {
    return true;
  }

  const mentorshipService = inject(MentorshipService);
  const hasProfile = await firstValueFrom(mentorshipService.hasMenteeProfile().pipe(map((response) => response.hasProfile)));
  if (hasProfile) {
    return true;
  }

  return router.createUrlTree(['/mentorship/mentee'], {
    queryParams: mentorshipMenteeApplyQueryParams(route.queryParamMap),
  });
};
