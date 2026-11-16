// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { ServerRequestFlags, User } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { LaunchDarklyServerService } from '../services/launchdarkly-server.service';

/** The one context every signed-out visitor is evaluated as: they all get the flag's fallthrough, or none of them do. */
const ANONYMOUS_FLAG_CONTEXT = { key: 'anonymous-meeting-visitor', anonymous: true };

/**
 * Evaluates the flags an SSR render needs before Angular picks a route.
 * @description Only `/meetings/:id` (and `/meetings/not-found`) asks LaunchDarkly; every other render gets none. A signed-out
 * visitor is evaluated as an anonymous context. `user` must already carry the impersonation override, so the context
 * matches the one `FeatureFlagService` builds in the browser from the same user.
 */
export async function resolveSsrFlags(req: Request, user: User | null): Promise<ServerRequestFlags> {
  // The SSR handler is mounted at `/**`, which leaves `req.path` as `/`; the original URL keeps the route.
  const segments = new URL(req.originalUrl, 'http://ssr').pathname.split('/').filter(Boolean);
  const meetingPage = segments.length === 2 && segments[0] === 'meetings' && segments[1] !== 'create';
  if (!meetingPage) {
    return {};
  }
  if (!user) {
    return { meetingsRedesign: await LaunchDarklyServerService.getInstance().isFlagEnabled(req, MEETINGS_REDESIGN_FLAG, false, ANONYMOUS_FLAG_CONTEXT) };
  }

  const key = user.preferred_username || user.username || user['https://sso.linuxfoundation.org/claims/username'];
  if (!key) {
    return { meetingsRedesign: false };
  }

  const meetingsRedesign = await LaunchDarklyServerService.getInstance().isFlagEnabled(req, MEETINGS_REDESIGN_FLAG, false, {
    key,
    name: user.name || '',
    email: user.email || '',
  });
  return { meetingsRedesign };
}
