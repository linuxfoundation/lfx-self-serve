// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Fragment keys that carry authentication material and must never reach an analytics sink or a
 * third-party query string.
 *
 * The Gatewaze embed's LFID sign-in returns to `#access_token=…&refresh_token=…`. A refresh token
 * is long-lived, so a leak does not expire on its own.
 *
 * Static lookup data, so it lives here rather than beside the functions that read it — the shared
 * package splits `constants/` (runtime values) from `utils/` (pure functions), and this file's
 * sibling `gw-embed.utils.ts` already imports its constants across that line.
 */
export const AUTH_FRAGMENT_KEYS = ['access_token', 'refresh_token', 'id_token', 'provider_token', 'provider_refresh_token'] as const;

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
