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

/** `getGatewazeMe` found an admin session. `user` is GoTrue's `/user` body, sent to the embed as `{ user }`. */
export interface GatewazeMeOk {
  outcome: 'ok';
  user: Record<string, unknown>;
  /**
   * The admin's profile and granted features, which the embed uses instead of reading them itself
   * before its first render. Absent when `getAdminContext` could not produce them; the embed then
   * reads them as before.
   */
  admin?: GatewazeAdminContext;
}

/**
 * The optional `admin` field of a 200 from `/api/gatewaze/session/me` (`@gatewaze/host-session`
 * 1.2.0, `AdminContext`). Mirrored here because this package is also built for the browser.
 */
export interface GatewazeAdminContext {
  profile: GatewazeAdminProfile;
  /** Exactly what `admin_get_features(user.id)` returns. */
  features: string[];
}

/** The active `admin_profiles` row, in exactly the nine fields the embed checks for. */
export interface GatewazeAdminProfile {
  id: string;
  /** Equals the `/me` answer's `user.id`. */
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  avatar_url: string | null;
  is_active: true;
  created_at: string;
  updated_at: string;
}

/** The session is good but the user has no active `admin_profiles` row. 403 `{ error: 'not_admin', email }`. */
export interface GatewazeMeNotAdmin {
  outcome: 'not_admin';
  email?: string;
}

/** The admin check could not be made at sign-in. 503 `{ error: 'admin_check_pending' }` with `Retry-After`. */
export interface GatewazeMeAdminCheckPending {
  outcome: 'admin_check_pending';
  retryAfterSeconds: number;
}

/** Result of `GatewazeSessionService.getGatewazeMe`, one per row of the `/session/me` table. */
export type GatewazeMeResult = GatewazeMeOk | GatewazeMeNotAdmin | GatewazeMeAdminCheckPending | GatewazeSessionFailure;

/** How `endGatewazeSession` removes the record once the session is revoked. */
export interface GatewazeSessionEndOptions {
  /**
   * True for LFX's `/logout`: `store.delete`, which also sets the package's 5 minute sign-out marker so
   * a request already in flight cannot mint a new session on the same id. False for the embed's own
   * sign-out button: `store.discard` with the revoked access token, no marker, so the next
   * `/session/me` mints again from the still-live LFX session.
   */
  blockReMint: boolean;
}

/** What `endGatewazeSession` managed to do. It never throws, so the caller can always answer. */
export interface GatewazeSessionEndResult {
  /** A stored session was found for this LFX session. */
  found: boolean;
  /** GoTrue confirmed it revoked the refresh token. */
  revoked: boolean;
  /** The record was removed and the sign-out published. False when there was nothing to remove, or another request had already replaced it. */
  deleted: boolean;
}

/**
 * A Gatewaze session opened for a Realtime socket, from `GatewazeSessionService.openRealtimeSession`.
 * `TSession` is `@gatewaze/host-session`'s `GwSession`. The callbacks are the ones the package's
 * `bridgeRealtime` takes, bound to this LFX session.
 */
export interface GatewazeRealtimeSession<TSession> {
  /** The session the socket opens with. */
  session: TSession;
  /** The refresh the bridge runs before each token expires. Null ends the socket. */
  fresh: () => Promise<TSession | null>;
  /** Registers a listener for this session's sign-out on any pod; returns its removal. */
  onSignedOut: (listener: () => void) => () => void;
  /** True when a sign-out arrived after the session started loading, before the bridge was listening. */
  signedOut: () => boolean;
  /** Removes the early sign-out listener. Call once the bridge listens for itself, or when the upgrade is refused. */
  release: () => void;
}

/** Per-pod Realtime socket caps for `GatewazeRealtimeService`. */
export interface GatewazeRealtimeLimits {
  /** Sockets one LFX user may hold on one pod. */
  perUser: number;
  /** Sockets, open or still being checked, that one pod accepts across all users. */
  total: number;
}

/**
 * A Realtime upgrade that passed the checks before Express and is now running through the Express
 * app. `TSocket` and `THead` are Node's `Duplex` and `Buffer`, which this package does not depend on.
 */
export interface GatewazeRealtimePendingUpgrade<TSocket, THead> {
  socket: TSocket;
  head: THead;
  /** Set once the Realtime route, the Express answer or the deadline has taken the upgrade from Express. */
  taken: boolean;
  /** Set once the upgrade is refused or handed to the WebSocket server, so it is answered once. */
  settled: boolean;
  /** Frees every slot this upgrade holds. Idempotent. */
  release: () => void;
  /** Adds a release step, run with `release`, or at once when already released. */
  onRelease: (step: () => void) => void;
}
