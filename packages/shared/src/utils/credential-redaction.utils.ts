// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CREDENTIAL_REDACTION_MARKER, INVITE_TOKEN_QUERY_PARAM, MEETING_PASSWORD_QUERY_PARAMS } from '../constants/credential-redaction.constants';
import { GW_HOST_SESSION_PROXY_API_MOUNT, GW_HOST_SESSION_PROXY_CREDENTIAL_QUERY_PARAMS } from '../constants/gw-host-session-proxy.constants';
import { isInviteLandingPath, isMentorshipMentorInvitePath } from './url.utils';

const RETURN_TO_QUERY_PARAM = 'returnTo';

/**
 * Returns `url` with the invite `token` query param replaced by a marker, or unchanged when the
 * path is not an invite page or the param is absent. The invite pages are the LFID invite landing
 * (`/invite?token=…`) and the mentorship mentor-invite page (`/mentorship/mentor/invites?token=…`).
 *
 * Called from Datadog RUM `beforeSend` so the credential never reaches the analytics sink
 * (GH-2290), and from the server request log.
 * A relative `url` comes back relative. A `returnTo` param holding an invite URL (the login and
 * auth-error redirects carry one) is redacted the same way.
 */
export function redactInviteToken(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    let redacted = false;
    const isInvitePath = isInviteLandingPath(parsed.pathname) || isMentorshipMentorInvitePath(parsed.pathname);
    if (isInvitePath && parsed.searchParams.has(INVITE_TOKEN_QUERY_PARAM)) {
      parsed.searchParams.set(INVITE_TOKEN_QUERY_PARAM, CREDENTIAL_REDACTION_MARKER);
      redacted = true;
    }
    const returnTo = parsed.searchParams.get(RETURN_TO_QUERY_PARAM);
    if (returnTo) {
      const redactedReturnTo = redactInviteToken(returnTo, parsed.origin);
      if (redactedReturnTo !== returnTo) {
        parsed.searchParams.set(RETURN_TO_QUERY_PARAM, redactedReturnTo);
        redacted = true;
      }
    }
    if (!redacted) {
      return url;
    }
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

const MEETING_PASSWORD_PARAM_PATTERN = new RegExp(`[?&](${MEETING_PASSWORD_QUERY_PARAMS.join('|')})=`, 'i');

function isMeetingPasswordParam(key: string): boolean {
  return (MEETING_PASSWORD_QUERY_PARAMS as readonly string[]).includes(key.toLowerCase());
}

// A `?`/`&` and `=` may each be percent-encoded, once per level of nesting (`%3F`, `%253F`, …), when
// the URL quoted is itself the value of another URL's param. The value ends at the next delimiter,
// encoded or not, at a closing parenthesis, or before a stack frame's trailing `:line:column`.
// Repetition is bounded so a crafted run of `%2525…` cannot make matching quadratic.
const ENCODED_PREFIX = '%(?:25){0,3}';
const MEETING_PASSWORD_IN_TEXT_PATTERN = new RegExp(
  `((?:[?&]|${ENCODED_PREFIX}(?:3F|26))(?:${MEETING_PASSWORD_QUERY_PARAMS.join('|')})(?:=|${ENCODED_PREFIX}3D))` +
    `(?:(?!${ENCODED_PREFIX}(?:26|23)|:\\d+:\\d+(?![^\\s"'<>()]))[^&#\\s"'<>()])*`,
  'gi'
);

/** Runs of text between whitespace, quotes, angle brackets and parentheses: a stack frame's URL is parenthesised. */
const TEXT_TOKEN_PATTERN = /[^\s"'<>()]+/g;

/** The `:line:column` a stack frame appends to its script URL, which is not part of the URL. */
const STACK_FRAME_POSITION_PATTERN = /(?::\d+){2}$/;

/** Resolves a quoted relative path for parsing only; {@link redactMeetingPassword} returns it relative. */
const TEXT_URL_BASE = 'https://redaction.invalid';

/**
 * Replaces the value of any meeting passcode query param appearing anywhere in free text (an error
 * message or stack that quotes a request URL) with a marker. Text outside such a URL is left as is,
 * stack frame coordinates included, and so is a URL that carries no passcode. A URL that does carry
 * one comes back re-serialized by {@link redactMeetingPassword}, so its other params may be
 * re-encoded, and punctuation run directly onto the passcode (a trailing `.` or `,`) is redacted with
 * it. Each URL in the text goes through {@link redactMeetingPassword}, so a percent-encoded param
 * name and a passcode nested in a `returnTo` at any depth are caught; a pattern match then covers
 * anything that did not parse as a URL. For a field that holds a single URL, call
 * {@link redactMeetingPassword} directly.
 */
export function redactMeetingPasswordInText(text: string): string {
  const withUrlsRedacted = text.replace(TEXT_TOKEN_PATTERN, (token) => {
    const queryIndex = token.indexOf('?');
    if (queryIndex < 0) {
      return token;
    }
    const urlStart = token.search(/https?:\/\/|\//i);
    if (urlStart < 0 || urlStart > queryIndex) {
      return token;
    }
    const url = token.slice(urlStart);
    const position = STACK_FRAME_POSITION_PATTERN.exec(url)?.[0] ?? '';
    return token.slice(0, urlStart) + redactMeetingPassword(url.slice(0, url.length - position.length), TEXT_URL_BASE) + position;
  });
  return withUrlsRedacted.replace(MEETING_PASSWORD_IN_TEXT_PATTERN, `$1${CREDENTIAL_REDACTION_MARKER}`);
}

/** A param value worth recursing into: a path or http(s) URL that has a query string of its own. */
function isNestedUrlWithQuery(value: string): boolean {
  return (value.startsWith('/') || /^https?:\/\//i.test(value)) && value.includes('?');
}

/**
 * Returns `url` with every meeting passcode query param (`password`, `passcode`) replaced by a
 * marker, on any path, or unchanged when none is present. A param value that is itself a URL
 * (`returnTo` on the login redirect, for one — including one nested again inside the auth-error
 * redirect's `returnTo`) is redacted the same way, at any depth.
 *
 * Sibling of {@link redactInviteToken}, called from Datadog RUM `beforeSend` so the passcode for a
 * private/restricted meeting never reaches the analytics sink through `view.url`, `view.referrer`
 * or a resource URL. A relative `url` comes back relative.
 */
export function redactMeetingPassword(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    const updates: [string, string][] = [];
    for (const [key, value] of parsed.searchParams) {
      if (isMeetingPasswordParam(key)) {
        updates.push([key, CREDENTIAL_REDACTION_MARKER]);
      } else if (isNestedUrlWithQuery(value)) {
        // Recurse on every nested URL, not only one whose decoded value already shows `?password=`:
        // a doubly nested passcode is still percent-encoded at this level.
        const redactedValue = redactMeetingPassword(value, parsed.origin);
        if (redactedValue !== value) {
          updates.push([key, redactedValue]);
        }
      }
    }
    if (updates.length === 0) {
      return url;
    }
    for (const [key, value] of updates) {
      parsed.searchParams.set(key, value);
    }
    return url.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    // Never throw from `beforeSend`; an unparseable URL that still looks like it carries a
    // passcode loses its whole query string.
    return MEETING_PASSWORD_PARAM_PATTERN.test(url) ? url.split('?')[0] : url;
  }
}

/**
 * Returns `url` with the credential query params of the Gatewaze host-session proxies (a Storage
 * signed-URL `token`, an `access_token`) replaced by a marker, or unchanged when it carries none.
 * They are redacted only on a path under `/api/gatewaze` (matched case-insensitively, like the
 * mount). A param value that is itself a URL (`returnTo`, for one) is redacted the same way, at any
 * depth. A relative `url` comes back relative.
 */
export function redactGatewazeProxyCredentials(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    const path = parsed.pathname.toLowerCase();
    const isProxyPath = path === GW_HOST_SESSION_PROXY_API_MOUNT || path.startsWith(`${GW_HOST_SESSION_PROXY_API_MOUNT}/`);
    const updates: [string, string][] = [];
    for (const [key, value] of parsed.searchParams) {
      if (isProxyPath && (GW_HOST_SESSION_PROXY_CREDENTIAL_QUERY_PARAMS as readonly string[]).includes(key)) {
        updates.push([key, CREDENTIAL_REDACTION_MARKER]);
      } else if (isNestedUrlWithQuery(value)) {
        const redactedValue = redactGatewazeProxyCredentials(value, parsed.origin);
        if (redactedValue !== value) {
          updates.push([key, redactedValue]);
        }
      }
    }
    if (updates.length === 0) {
      return url;
    }
    for (const [key, value] of updates) {
      parsed.searchParams.set(key, value);
    }
    return url.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    // Never throw from a log serializer or `beforeSend`; an unparseable proxy URL loses its query.
    return url.toLowerCase().includes(GW_HOST_SESSION_PROXY_API_MOUNT) ? url.split('?')[0] : url;
  }
}

/**
 * Returns a request URL fit for a server log: the invite `token`, any meeting passcode and the
 * Gatewaze proxies' credential params replaced by a marker. Meeting join links (and the legacy `?password=` API calls) carry the passcode in the
 * query string, so every logged `url` / `originalUrl` goes through this rather than
 * {@link redactInviteToken} alone.
 */
export function redactLoggedUrl(url: string, base: string): string {
  return redactGatewazeProxyCredentials(redactMeetingPassword(redactInviteToken(url, base), base), base);
}
