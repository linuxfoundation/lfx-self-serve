// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { CanMatchFn, UrlSegment } from '@angular/router';
import { AuthContext } from '@lfx-one/shared/interfaces';

/**
 * Server-side only: matches `/votes/:id` for an anonymous visitor so SSR renders the neutral, chrome-less ballot
 * shell instead of the authenticated app shell (#4363). The server can't see the URL fragment, so it can't tell a
 * vote link from a plain permalink; the middleware lets both through as optional-auth, and this keeps the shell's
 * "Express already authenticated this request" assumption true. The browser then decides: a fragment token renders
 * the ballot, anything else falls through to `authGuard`, which sends the visitor to login as before. A signed-in
 * visitor never matches here and gets today's shell.
 */
export const voteAnonymousSsrMatchGuard: CanMatchFn = (_route, segments: UrlSegment[]) => {
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return false;
  }

  const id = segments[1]?.path;
  if (!id || id === 'create') {
    return false;
  }

  const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthContext } | null;
  return reqContext?.auth?.authenticated === false;
};
