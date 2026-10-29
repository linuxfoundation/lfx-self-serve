// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_LINK_TOKEN_FRAGMENT_PARAM } from '@lfx-one/shared/constants';
import { isInviteLandingPath, isMentorshipMentorInvitePath } from '@lfx-one/shared/utils';

/**
 * True when this browser document is the LFID invite landing or its error page.
 * Always false during SSR (`window` is undefined) — those initializers already no-op on the server.
 *
 * Deliberately DI-free (`typeof window` rather than `isPlatformBrowser`): app initializers
 * and the preloading strategy call this before / without an injection context for `PLATFORM_ID`.
 */
export function isBrowserInviteLandingPath(): boolean {
  return typeof window !== 'undefined' && isInviteLandingPath(window.location.pathname);
}

/**
 * True when this browser document's URL carries a credential in its query string: the LFID invite
 * landing or the mentorship mentor-invite page. URL-capturing integrations (Segment, Plausible,
 * Intercom) stay off there; unlike {@link isBrowserInviteLandingPath}, feature flags and preloading
 * are unaffected.
 */
export function isBrowserCredentialUrlPath(): boolean {
  return (
    typeof window !== 'undefined' &&
    (isInviteLandingPath(window.location.pathname) || isMentorshipMentorInvitePath(window.location.pathname) || isVoteLinkUrl(window.location))
  );
}

/** A login-free vote link (`/votes/:id#vote_token=...`): the credential rides in the fragment, which URL-capturing SDKs would otherwise record. */
function isVoteLinkUrl(location: Pick<Location, 'pathname' | 'hash'>): boolean {
  return /^\/votes\/[^/]+\/?$/.test(location.pathname) && new URLSearchParams(location.hash.replace(/^#/, '')).has(VOTE_LINK_TOKEN_FRAGMENT_PARAM);
}
