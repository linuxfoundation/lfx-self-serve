// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { firstValueFrom, map } from 'rxjs';

/**
 * CanActivate guard on the mentor register route (`/mentorship/mentor`).
 *
 * - **SSR** → `true`, and the browser run decides. The server render's profile check goes out
 *   without the session cookie (see `menteeRegisterGuard`), so its answer cannot be trusted.
 * - **Has profile** → `/mentorship/mentor/programs` (My Programs).
 * - **No profile** (or the check failed) → returns `true`, letting the register page render.
 *
 * The service's `hasMentorProfile()` already catches HTTP errors and returns
 * `{ hasProfile: false }`, so no guard-level `catchError` is needed.
 */
export const mentorRegisterGuard: CanActivateFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const mentorService = inject(MentorshipMentorService);
  const router = inject(Router);

  const hasProfile = await firstValueFrom(mentorService.hasMentorProfile().pipe(map((response) => response.hasProfile)));

  return hasProfile ? router.createUrlTree(['/mentorship/mentor/programs']) : true;
};
