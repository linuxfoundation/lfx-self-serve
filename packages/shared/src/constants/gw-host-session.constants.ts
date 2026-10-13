// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Constants for Gatewaze host-session mode, where LFX One holds the Gatewaze (GoTrue) session on the
 * server and the browser holds only its LFX `appSession` cookie. See
 * `docs/architecture/backend/gw-host-session.md`.
 */

/**
 * Scope for the Auth0 refresh grant that yields a fresh ID token for GoTrue's `id_token` grant.
 * OIDC scopes only and no `audience`: an ID token from this grant carries no `nonce`, which is what
 * GoTrue needs when the request sends no raw nonce.
 */
export const GW_HOST_SESSION_ID_TOKEN_SCOPE = 'openid email profile';

/** HKDF-SHA256 `info` that derives the host-session master key (the input to the store's encryption keys) from `PCC_AUTH0_SECRET`. Changing it invalidates every stored record. */
export const GW_HOST_SESSION_HKDF_INFO = 'lfx-one gatewaze host-session v1';

/** HKDF-SHA256 `info` for the Gatewaze session id's HMAC key, so the id and the store's encryption never share a key. Changing it orphans every stored record. */
export const GW_HOST_SESSION_SID_HKDF_INFO = 'lfx-one gatewaze host-session v1 sid';

/** Fields of `@gatewaze/host-session`'s warn metadata that may be logged. Everything else, notably the GoTrue `user_id`, is dropped. */
export const GW_HOST_SESSION_STORE_LOG_FIELDS = ['err', 'status'] as const;

/** Label HMAC'd with the LFX session id to form the Gatewaze session id, domain-separating the input. */
export const GW_HOST_SESSION_SID_LABEL = 'sid:';

/** Sliding lifetime of a stored Gatewaze session, renewed on each refresh. Matches GoTrue's 24 h inactivity window. */
export const GW_HOST_SESSION_TTL_SECONDS = 24 * 60 * 60;

/** Per-command cap on the host-session Valkey connection, so a hung backend answers 503 instead of holding the request. */
export const GW_HOST_SESSION_VALKEY_COMMAND_TIMEOUT_MS = 5_000;

/** Name of express-openid-connect's session cookie (the library default; `server.ts` does not override it). */
export const GW_HOST_SESSION_APP_SESSION_COOKIE = 'appSession';

/** Shape of the LFX session id under the session store: `randomBytes(32).toString('hex')` (`server.ts` `genid`). */
export const GW_HOST_SESSION_APP_SESSION_ID_PATTERN = /^[0-9a-f]{64}$/;
