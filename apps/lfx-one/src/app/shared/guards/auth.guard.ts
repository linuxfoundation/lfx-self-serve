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
 *
 * SSR-compatible: During SSR, authentication is handled by Express middleware
 * which redirects unauthenticated users before Angular processes the route.
 * This guard only handles client-side navigation after initial page load.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const platformId = inject(PLATFORM_ID);

  // On server: Trust that Express middleware already handled authentication
  // If we're rendering on server, user must be authenticated (middleware redirected otherwise)
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  // On client: Check authentication state from UserService
  const userService = inject(UserService);

  if (userService.authenticated()) {
    return true;
  }

  // Client-side: Redirect to login with returnTo parameter
  const returnTo = encodeURIComponent(state.url);
  window.location.href = `/login?returnTo=${returnTo}`;

  return false;
};
