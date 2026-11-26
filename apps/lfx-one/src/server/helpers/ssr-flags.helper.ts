// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETINGS_REDESIGN_FLAG, PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { ServerRequestFlags, User } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { LaunchDarklyServerService } from '../services/launchdarkly-server.service';

/** The one context every signed-out visitor is evaluated as: they all get the flag's fallthrough, or none of them do. */
const ANONYMOUS_FLAG_CONTEXT = { key: 'anonymous-meeting-visitor', anonymous: true };

/**
 * Evaluates the flags an SSR render needs before Angular picks a route.
 * @description `/meetings/:id` (and `/meetings/not-found`), the `/project/meetings` and `/foundation/meetings` lists and the
 * public `/projects/:slug/calendar` ask for the meetings redesign; `/profile`, `/account` and public `/u/:username` pages ask for the profile redesign (#6067), for
 * signed-in viewers only, since the flag needs a session. Every other render gets none. A signed-out meetings visitor is evaluated as an
 * anonymous context. `user` must already carry the impersonation override, so the context matches the one
 * `FeatureFlagService` builds in the browser from the same user.
 */
export async function resolveSsrFlags(req: Request, user: User | null): Promise<ServerRequestFlags> {
  // The SSR handler is mounted at `/**`, which leaves `req.path` as `/`; the original URL keeps the route.
  const segments = new URL(req.originalUrl, 'http://ssr').pathname.split('/').filter(Boolean);
  const meetingPage = segments.length === 2 && segments[0] === 'meetings' && segments[1] !== 'create';
  const lensMeetingsList = segments.length === 2 && (segments[0] === 'project' || segments[0] === 'foundation') && segments[1] === 'meetings';
  const publicCalendar = segments.length === 3 && segments[0] === 'projects' && segments[2] === 'calendar';
  // The public profile (`/u/:username`) takes the redesign only for a signed-in viewer the flag is on for (#6088).
  if (segments[0] === 'profile' || segments[0] === 'account' || (segments[0] === 'u' && segments.length === 2)) {
    return { profileRedesign: user ? await evaluateForUser(req, user, PROFILE_REDESIGN_FLAG) : false };
  }
  if (!meetingPage && !lensMeetingsList && !publicCalendar) {
    return {};
  }
  if (!user) {
    return { meetingsRedesign: await LaunchDarklyServerService.getInstance().isFlagEnabled(req, MEETINGS_REDESIGN_FLAG, false, ANONYMOUS_FLAG_CONTEXT) };
  }
  return { meetingsRedesign: await evaluateForUser(req, user, MEETINGS_REDESIGN_FLAG) };
}

/** A flag for a signed-in viewer, keyed as the browser keys them; `false` when the user has no username. */
async function evaluateForUser(req: Request, user: User, flag: string): Promise<boolean> {
  const key = user.preferred_username || user.username || user['https://sso.linuxfoundation.org/claims/username'];
  if (!key) {
    return false;
  }
  return LaunchDarklyServerService.getInstance().isFlagEnabled(req, flag, false, { key, name: user.name || '', email: user.email || '' });
}
