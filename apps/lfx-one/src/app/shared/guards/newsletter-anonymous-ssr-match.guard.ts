// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { CanMatchFn, UrlSegment } from '@angular/router';
import { AuthContext } from '@lfx-one/shared/interfaces';

import { UserService } from '../services/user.service';

/**
 * Matches the newsletter permalink `/newsletters/:projectSlug/:id` for a signed-out visitor, so the
 * chrome-less share page renders instead of the authenticated app shell:
 * - on the server, link-preview crawlers get its subject-only Open Graph tags (#4940) — the middleware
 *   lets that two-segment path through as optional-auth, and the server-side `authGuard` would
 *   otherwise wave the shell through;
 * - in the browser, a signed-out reader gets the member-benefit email prompt instead of the login
 *   redirect (#5235).
 *
 * A signed-in visitor never matches and gets the reader. `my` is never a project slug.
 */
export const newsletterAnonymousSsrMatchGuard: CanMatchFn = (_route, segments: UrlSegment[]) => {
  if (segments.length !== 3 || segments[1].path === 'my') {
    return false;
  }

  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return !inject(UserService).authenticated();
  }

  const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as { auth?: AuthContext } | null;
  return reqContext?.auth?.authenticated === false;
};
