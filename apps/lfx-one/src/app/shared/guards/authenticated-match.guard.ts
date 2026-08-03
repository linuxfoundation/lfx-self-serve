// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { AuthContext } from '@lfx-one/shared/interfaces';

/**
 * CanMatch guard that returns true only when the user is authenticated.
 *
 * Used on the authenticated `groups` child route so that unauthenticated users
 * skip it during route matching, allowing Angular to fall through to the public
 * group detail route instead of hitting authGuard and redirecting to login.
 *
 * Reads auth state from TransferState (browser) or REQUEST_CONTEXT (SSR) —
 * both are populated before route matching runs, unlike UserService.authenticated
 * which is set in AppComponent's constructor after routing begins.
 */
export const authenticatedMatchGuard: CanMatchFn = () => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthContext } | null;
    return reqContext?.auth?.authenticated ?? false;
  }

  const transferState = inject(TransferState);
  const auth = transferState.get(makeStateKey<AuthContext>('auth'), {
    authenticated: false,
    user: null,
    persona: null,
    organizations: [],
  });
  return auth.authenticated;
};
