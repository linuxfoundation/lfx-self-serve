// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AUTH_FRAGMENT_KEYS, INVITE_TOKEN_QUERY_PARAM } from '../constants/auth-fragment.constants';
import { isInviteLandingPath, isMentorshipMentorInvitePath } from './url.utils';

/** Whether a URL fragment carries any key that counts as authentication material. */
export function hasAuthFragment(hash: string): boolean {
  if (!hash) {
    return false;
  }
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
}

/**
 * Returns `url` with an auth-bearing fragment replaced by a marker, or unchanged if it has none.
 *
 * Lives in the shared package rather than beside its caller so it is reachable by the runnable test
 * suite: the Angular provider that uses it sits under `src/app/`, whose specs need `ng test`.
 *
 * @param url Absolute or relative; a relative value is resolved against `base` so a same-origin
 *   referrer cannot slip through unredacted merely because it failed to parse standalone.
 * @param base Origin to resolve a relative `url` against.
 */
export function redactAuthFragment(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    if (!hasAuthFragment(parsed.hash)) {
      return url;
    }
    // A marker rather than an empty hash, so a reader can tell redaction happened.
    parsed.hash = 'redacted';
    return parsed.toString();
  } catch {
    // Never throw: the caller is a Datadog `beforeSend`, where a thrown error loses the event and
    // can take RUM down with it. An unparseable URL cannot be redacted precisely, so drop the
    // fragment wholesale — blunt, but it cannot leak.
    return url.split('#')[0];
  }
}

/**
 * Returns `url` with the invite `token` query param replaced by a marker, or unchanged when the
 * path is not an invite page or the param is absent. The invite pages are the LFID invite landing
 * (`/invite?token=…`) and the mentorship mentor-invite page (`/mentorship/mentor/invites?token=…`).
 *
 * Sibling of {@link redactAuthFragment}: that helper only rewrites the hash, and the invite
 * token lives in the query string. Both are called from Datadog RUM `beforeSend` so neither
 * credential reaches the analytics sink (GH-2290), and the server request log uses this one too.
 * A relative `url` comes back relative.
 */
export function redactInviteToken(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    const isInvitePath = isInviteLandingPath(parsed.pathname) || isMentorshipMentorInvitePath(parsed.pathname);
    if (!isInvitePath || !parsed.searchParams.has(INVITE_TOKEN_QUERY_PARAM)) {
      return url;
    }
    parsed.searchParams.set(INVITE_TOKEN_QUERY_PARAM, 'redacted');
    return url.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    const queryMarker = `?${INVITE_TOKEN_QUERY_PARAM}=`;
    const extraMarker = `&${INVITE_TOKEN_QUERY_PARAM}=`;
    if (!url.includes(queryMarker) && !url.includes(extraMarker)) {
      return url;
    }
    return url.split('?')[0];
  }
}
