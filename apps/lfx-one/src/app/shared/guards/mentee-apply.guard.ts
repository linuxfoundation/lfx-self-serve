// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MENTORSHIP_MENTEE_PROFILE_CREATED_STATE } from '@lfx-one/shared/constants';
import { mentorshipMenteeApplyQueryParams } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { firstValueFrom, map } from 'rxjs';

/**
 * CanActivate guard on `/mentorship/mentee/apply`.
 *
 * - **Profile just created** (router state from a validated registration) → allow.
 *   Registration does not save a profile yet (linuxfoundation/lfx-mentorship#187), so
 *   the profile check still reports none and this one navigation has to skip it or the
 *   return trip would bounce straight back to register.
 * - **Has profile** → allow.
 * - **No profile** (or the check failed) → `/mentorship/mentee`, copying `programId` and `programTermId`
 *   onto that URL so a refresh of the register page does not drop them.
 */
export const menteeApplyGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
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
