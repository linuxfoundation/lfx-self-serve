// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { UserService } from '../services/user.service';

/**
 * Authentication guard that protects routes requiring user authentication.
 *
 * Redirects unauthenticated users to the login page with a returnTo parameter
 * containing the originally requested URL.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const userService = inject(UserService);
  const platformId = inject(PLATFORM_ID);

  // Check if user is authenticated using the signal
  if (userService.authenticated()) {
    return true;
  }

  // Redirect to login with returnTo parameter using Router for SSR compatibility
  const returnTo = encodeURIComponent(state.url);
  if (isPlatformBrowser(platformId)) {
    window.location.href = `/login?returnTo=${returnTo}`;
  }

  return false;
};
