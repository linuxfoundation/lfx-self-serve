// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Query param on `/invite` that carries the single-factor accept credential.
 * Datadog RUM records `view.url`, so this value must be redacted before send (GH-2290).
 */
export const INVITE_TOKEN_QUERY_PARAM = 'token';

/**
 * Query params that carry a meeting passcode. `?password=` is the shared join-link shape for
 * private/restricted meetings (meeting cards, copied join links, `returnTo`), and the passcode is
 * the server's access gate for them, so Datadog RUM must not record it on any path. Matched
 * case-insensitively.
 */
export const MEETING_PASSWORD_QUERY_PARAMS = ['password', 'passcode'] as const;

/**
 * Value a redacted credential is replaced with, so a reader can tell redaction happened. A
 * credential that already equals it comes back unchanged, so a check that asks "did redaction
 * change anything?" must also look for the marker itself.
 */
export const CREDENTIAL_REDACTION_MARKER = 'redacted';
