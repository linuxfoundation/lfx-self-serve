// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_HOST_SESSION_PROXY_SUPABASE_MOUNT } from './gw-host-session-proxy.constants';

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

/**
 * Fields of `@gatewaze/host-session`'s warn metadata that may be logged. Everything else, notably the
 * GoTrue `user_id`, is dropped. `path` is the upstream path of a redirect the proxy dropped.
 */
export const GW_HOST_SESSION_STORE_LOG_FIELDS = ['err', 'status', 'path'] as const;

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

/**
 * Bound on each step of ending a Gatewaze session (connect, refresh, revoke, delete), so a hung
 * Valkey or GoTrue cannot stall the rest of the steps.
 */
export const GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS = 2_000;

/**
 * The longest LFX's own `/logout` waits for the Gatewaze session to end before it carries on with
 * the LFX logout. The steps keep running after that, each under its own bound.
 */
export const GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS = 3_000;

/** Path of the Realtime WebSocket that `supabase-js` opens under `supabase.url`. Every other upgrade path is refused. */
export const GW_REALTIME_PATH = `${GW_HOST_SESSION_PROXY_SUPABASE_MOUNT}/realtime/v1/websocket`;

/**
 * How long an upgrade may take, through the Express gates and the Gatewaze session load, before it
 * is refused with 503 and its socket slots freed.
 */
export const GW_REALTIME_UPGRADE_TIMEOUT_MS = 45_000;

/**
 * How long a Realtime socket stays open before LFX One closes it with 1001 so realtime-js reconnects
 * through every upgrade check again. This bounds how long a socket outlives a revoked LFX writer
 * grant, which the token refresh does not re-check.
 */
export const GW_REALTIME_MAX_SOCKET_AGE_MS = 15 * 60 * 1000;

/** Response headers copied from an Express answer onto a refused Realtime handshake. */
export const GW_REALTIME_FORWARDED_REJECT_HEADERS = ['retry-after', 'x-gw-session'] as const;

/** Realtime sockets one LFX user may hold open on one pod, the admin BFF's per-session cap. realtime-js opens one per client. */
export const GW_REALTIME_MAX_SOCKETS_PER_USER = 20;

/** Realtime sockets, open or still being authenticated, that one pod accepts across all users. */
export const GW_REALTIME_MAX_SOCKETS_TOTAL = 1_000;

/** Largest message a browser may send on a Realtime socket, as in the admin BFF. `ws` defaults to 100 MiB. */
export const GW_REALTIME_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/** WebSocket close code for a server going away. realtime-js reconnects, and the load balancer sends it to another pod. */
export const GW_REALTIME_CLOSE_GOING_AWAY = 1001;
