// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of } from 'rxjs';
import { firstValueFrom } from 'rxjs';

/**
 * CanActivate guard on the mentee register route (`/mentorship/mentee`).
 *
 * - **Has profile** → redirects to `/mentorship/mentee/overview` (the shell).
 * - **No profile** (404 / error / mock default) → returns `true`, letting the
 *   register page render.
 *
 * The mock BFF always returns `{ hasProfile: false }` today, so the guard always
 * allows the register page. When the real profiles endpoint lands, users with an
 * existing mentee profile will be redirected to the tabbed shell automatically.
 */
export const menteeRegisterGuard: CanActivateFn = async () => {
  const mentorshipService = inject(MentorshipService);
  const router = inject(Router);

  const hasProfile = await firstValueFrom(
    mentorshipService.hasMenteeProfile().pipe(
      map((response) => response.hasProfile),
      catchError(() => of(false))
    )
  );

  if (hasProfile) {
    return router.createUrlTree(['/mentorship/mentee/overview']);
  }

  return true;
};
