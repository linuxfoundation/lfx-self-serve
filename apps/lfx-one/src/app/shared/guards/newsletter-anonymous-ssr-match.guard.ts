// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { CanMatchFn, UrlSegment } from '@angular/router';
import { AuthContext } from '@lfx-one/shared/interfaces';

/**
 * Server-side only: matches the newsletter permalink `/newsletters/:projectSlug/:id` for an anonymous
 * request, so SSR renders the chrome-less share preview (subject-only Open Graph tags, #4940) for
 * link-preview crawlers instead of the authenticated app shell, which the server-side `authGuard` would
 * otherwise wave through. The middleware lets that two-segment path through as optional-auth. In the
 * browser this never matches, so a signed-out visitor falls through to the shell's `authGuard` and is
 * sent to login as before; a signed-in visitor never matches and gets the reader.
 */
export const newsletterAnonymousSsrMatchGuard: CanMatchFn = (_route, segments: UrlSegment[]) => {
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return false;
  }

  if (segments.length !== 3 || segments[1].path === 'my') {
    return false;
  }

  const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthContext } | null;
  return reqContext?.auth?.authenticated === false;
};
