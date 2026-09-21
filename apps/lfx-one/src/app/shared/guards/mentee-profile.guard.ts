// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MentorshipService } from '@services/mentorship.service';
import { map } from 'rxjs';
import { firstValueFrom } from 'rxjs';

/**
 * CanActivate guard on the mentee register route (`/mentorship/mentee`).
 *
 * - **Has profile** → redirects to `/mentorship/mentee/overview` (the shell).
 * - **No profile** (404 / error / mock default) → returns `true`, letting the
 *   register page render.
 *
 * The service's `hasMenteeProfile()` already catches HTTP errors and returns
 * `{ hasProfile: false }`, so no guard-level `catchError` is needed.
 */
export const menteeRegisterGuard: CanActivateFn = async () => {
  const mentorshipService = inject(MentorshipService);
  const router = inject(Router);

  const hasProfile = await firstValueFrom(mentorshipService.hasMenteeProfile().pipe(map((response) => response.hasProfile)));

  if (hasProfile) {
    return router.createUrlTree(['/mentorship/mentee/overview']);
  }

  return true;
};
