// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Host-session configuration read from the environment, present only when host-session mode is on and complete. */
export interface GatewazeHostSessionSettings {
  /** `GW_SUPABASE_URL` without a trailing slash: the GoTrue and PostgREST upstream. */
  supabaseUrl: string;
  /** `GW_SUPABASE_ANON_KEY`, checked to be publishable (never service-role). */
  anonKey: string;
  /** `VALKEY_URL`, for the store's own connection. */
  valkeyUrl: string;
  /** `PCC_AUTH0_SECRET`, the input to the host-session master key. */
  authSecret: string;
}

/** `getGatewazeSession` found or minted a session. `TSession` is `@gatewaze/host-session`'s `GwSession`, which this package does not depend on. */
export interface GatewazeSessionOk<TSession> {
  outcome: 'ok';
  session: TSession;
}

/**
 * Why `getGatewazeSession` has no session. Each outcome maps to one row of the `/session/me` table in
 * `docs/architecture/backend/gw-host-session.md`:
 * - `host_session_unavailable`: host-session mode is off or misconfigured (flag, session store, Supabase config, cookie). Uniform 404.
 * - `ended`: the LFX session is over (Auth0 refused the refresh token) or the Gatewaze session was signed out. 401 with `x-gw-session: expired`.
 * - `refused`: GoTrue refused the ID token (a 4xx). A configuration fault, so 503 with an ERROR log, never 401.
 * - `unavailable`: Valkey, Auth0 or GoTrue could not answer. 503.
 */
export interface GatewazeSessionFailure {
  outcome: 'host_session_unavailable' | 'ended' | 'refused' | 'unavailable';
}

/** Result of `GatewazeSessionService.getGatewazeSession`. */
export type GatewazeSessionResult<TSession> = GatewazeSessionOk<TSession> | GatewazeSessionFailure;
