// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac, hkdfSync } from 'node:crypto';

import {
  type CoreLogger,
  type GwSession,
  type HostSessionConfig,
  type KeyValue,
  deriveKeys,
  errorMessage,
  getUser,
  IdTokenGrantRefusedError,
  isAdminCheckPending,
  logout,
  RedisKeyValue,
  retryAfterSeconds,
  SessionEndedError,
  SessionStore,
  SessionUnavailableError,
  signInWithIdToken,
} from '@gatewaze/host-session';
import {
  GW_HOST_SESSION_HKDF_INFO,
  GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS,
  GW_HOST_SESSION_SID_HKDF_INFO,
  GW_HOST_SESSION_SID_LABEL,
  GW_HOST_SESSION_STORE_LOG_FIELDS,
  GW_HOST_SESSION_TTL_SECONDS,
  GW_HOST_SESSION_VALKEY_COMMAND_TIMEOUT_MS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import {
  GatewazeHostSessionSettings,
  GatewazeMeResult,
  GatewazeRealtimeSession,
  GatewazeSessionEndOptions,
  GatewazeSessionEndResult,
  GatewazeSessionFailure,
  GatewazeSessionResult,
  SessionStorePayload,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import Redis from 'ioredis';

import { readAppSessionId } from '../helpers/app-session-cookie.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { isPublishableSupabaseKey } from '../helpers/supabase-key.helper';
import { hasActiveImpersonation } from '../utils/auth-helper';
import { exchangeRefreshTokenForIdToken } from '../utils/refresh-token-exchange.util';
import { addShutdownHook } from '../utils/shutdown';
import { logger } from './logger.service';
import { sessionStoreService } from './session-store.service';
import { buildGatewazeHostSessionKeyPrefix } from './valkey.service';

/**
 * Derives the host-session master key from `PCC_AUTH0_SECRET` with HKDF-SHA256 (decision D3: no new
 * secret to provision). The store's encryption subkey is derived from it by the package's
 * `deriveKeys`. Rotating `PCC_AUTH0_SECRET` invalidates every stored Gatewaze record, and each one
 * is re-minted on its next use. It does not end LFX sessions, which live in the session store.
 */
export function deriveGatewazeMasterKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), GW_HOST_SESSION_HKDF_INFO, 32));
}

/** Derives the Gatewaze session id's HMAC key from `PCC_AUTH0_SECRET` with its own HKDF info, separate from the store's keys. */
export function deriveGatewazeSidKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), GW_HOST_SESSION_SID_HKDF_INFO, 32));
}

/**
 * The Gatewaze session id for an LFX session id: `base64url(HMAC-SHA256(sidKey, 'sid:' + lfxSid))`.
 *
 * This meets `@gatewaze/host-session`'s session id rules. `lfxSid` is the `appSession` cookie under
 * the session store, which is 32 random bytes from `genid`, created at each IdP sign-in (the library
 * regenerates the session id on every login callback) and destroyed at sign-out. So the derived id
 * is an HMAC of a per-login random value, is never derived from user data, and changes at every
 * sign-in. Deriving it rather than storing it means nothing is written to `appSession`, which
 * express-openid-connect blind-overwrites on every response, and the Realtime upgrade path and
 * `/logout` can derive the same id from the cookie alone.
 */
export function deriveGatewazeSid(sidKey: Buffer, lfxSid: string): string {
  return createHmac('sha256', sidKey)
    .update(GW_HOST_SESSION_SID_LABEL + lfxSid)
    .digest('base64url');
}

let flagMismatchWarned = false;

/**
 * Logs once per process that only one of the embed's two server flags is on. The embed needs both,
 * so this is the likeliest reason for its not-configured panel. Once, because this check runs on
 * every page render and every `/api/gatewaze` request.
 */
function warnFlagMismatchOnce(hostSessionOn: boolean): void {
  if (flagMismatchWarned) {
    return;
  }
  flagMismatchWarned = true;
  const [on, off] = hostSessionOn
    ? [ServerFeatureFlag.GatewazeHostSession, ServerFeatureFlag.GatewazeEmbedEnabled]
    : [ServerFeatureFlag.GatewazeEmbedEnabled, ServerFeatureFlag.GatewazeHostSession];
  logger.warning(undefined, 'resolve_gatewaze_host_session_config', `${on} is on but ${off} is off; the Gatewaze embed needs both and stays off`, {
    flag_on: on,
    flag_off: off,
  });
}

/**
 * Host-session configuration, or null when host-session mode is off or cannot run. Every condition
 * is checked together so the `/api/gatewaze` routes and the embed outlet (through
 * `RuntimeConfig.gwHostSession`) cannot disagree about it.
 * Environment is read per call, as `isServerFeatureEnabled` does.
 */
export function resolveGatewazeHostSessionConfig(): GatewazeHostSessionSettings | null {
  const hostSessionOn = isServerFeatureEnabled(ServerFeatureFlag.GatewazeHostSession);
  const embedOn = isServerFeatureEnabled(ServerFeatureFlag.GatewazeEmbedEnabled);
  if (!hostSessionOn || !embedOn) {
    if (hostSessionOn !== embedOn) {
      warnFlagMismatchOnce(hostSessionOn);
    }
    return null;
  }
  // Without the session store, `appSession` is an encrypted cookie with no stable id to key on.
  const valkeyUrl = process.env['VALKEY_URL'];
  if (process.env['SESSION_STORE_ENABLED'] !== 'true' || !valkeyUrl) {
    return null;
  }
  const supabaseUrl = (process.env['GW_SUPABASE_URL'] || '').trim().replace(/\/+$/, '');
  const anonKey = (process.env['GW_SUPABASE_ANON_KEY'] || '').trim();
  const authSecret = process.env['PCC_AUTH0_SECRET'] || '';
  // The anon key is also sent upstream as `apikey`; a service-role key here would bypass RLS.
  if (!supabaseUrl || !isPublishableSupabaseKey(anonKey) || !authSecret) {
    return null;
  }
  // The proxy will send the user's GoTrue tokens to this origin, so production requires TLS.
  if (process.env['NODE_ENV'] === 'production' && !supabaseUrl.startsWith('https://')) {
    return null;
  }
  return { supabaseUrl, anonKey, valkeyUrl, authSecret };
}

/**
 * Keeps only the store's diagnostic fields from its warn metadata. The package also logs the GoTrue
 * `user_id`, a linked pseudonym for the user, which must not reach LFX logs. An allowlist, so a
 * field a later package version adds stays out until it is reviewed.
 */
function storeLogMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const field of GW_HOST_SESSION_STORE_LOG_FIELDS) {
    if (meta[field] !== undefined) kept[field] = meta[field];
  }
  return kept;
}

/**
 * A `CoreLogger` for `@gatewaze/host-session` that logs under `operation` at WARN, under `req` when
 * given, with its metadata filtered to `GW_HOST_SESSION_STORE_LOG_FIELDS`. Every use of the package
 * logs through this, so its `user_id` never reaches LFX logs.
 */
export function hostSessionCoreLogger(operation: string, req?: Request): CoreLogger {
  return { warn: (meta, message) => logger.warning(req, operation, message, storeLogMeta(meta)) };
}

/**
 * True while the LFX session behind `lfxSid` is still live and not impersonating. A Realtime socket
 * outlives the request that opened it, so the bridge checks this before each token refresh. A
 * Valkey fault reads as a missing session (`SessionStoreService` is fail-soft), which ends the
 * socket; realtime-js then reconnects through the full upgrade checks.
 */
async function isLfxSessionLive(lfxSid: string): Promise<boolean> {
  const payload = await (sessionStoreService.get(lfxSid) as Promise<SessionStorePayload | null>);
  if (!payload || payload.header.exp * 1000 <= Date.now()) {
    return false;
  }
  return !hasActiveImpersonation(payload.data);
}

function toHostConfig(config: GatewazeHostSessionSettings): HostSessionConfig {
  return { supabaseUrl: config.supabaseUrl, anonKey: config.anonKey };
}

/** Rejects when `promise` has not settled within `ms`. The work itself carries on; only the wait is bounded. */
function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True when host-session mode is on and fully configured. */
export function isGatewazeHostSessionEnabled(): boolean {
  return resolveGatewazeHostSessionConfig() !== null;
}

/** The store's KeyValue over its own ioredis connection; `RedisKeyValue` duplicates it for the sign-out subscription. */
function createValkeyKeyValue(url: string): KeyValue {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: VALKEY_CACHE.CONNECT_TIMEOUT_MS,
    commandTimeout: GW_HOST_SESSION_VALKEY_COMMAND_TIMEOUT_MS,
  });
  const onError = (err: Error) => {
    logger.warning(undefined, 'gatewaze_session_valkey_error', 'Gatewaze session store Valkey error', { err });
  };
  redis.on('error', onError);
  return new RedisKeyValue(redis, onError);
}

/**
 * Holds the Gatewaze (GoTrue) session for each LFX session on the server, in an encrypted Valkey
 * record managed by `@gatewaze/host-session`'s `SessionStore`. The `/api/gatewaze/session` routes and
 * LFX's `/logout` use it. See `docs/architecture/backend/gw-host-session.md`.
 */
export class GatewazeSessionService {
  private storePromise: Promise<SessionStore> | null = null;
  private shutdownHookRegistered = false;

  /** @param createKeyValue - Injected by specs; defaults to a Valkey connection. */
  public constructor(private readonly createKeyValue: (url: string) => KeyValue = createValkeyKeyValue) {}

  /**
   * Returns the caller's Gatewaze session: the stored one, refreshed if needed, or a new one minted
   * from the LFX session (Auth0 refresh grant for an ID token, then GoTrue's `id_token` grant). A
   * stored session for another Auth0 subject, or one GoTrue refused to refresh, is replaced by a new
   * mint. Only one mint runs per session across every pod. Never throws: every failure is an outcome.
   */
  public async getGatewazeSession(req: Request): Promise<GatewazeSessionResult<GwSession>> {
    const startTime = Date.now();
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      return { outcome: 'host_session_unavailable' };
    }
    const gwSid = this.gwSidFor(req, config);
    if (!gwSid) {
      logger.debug(req, 'get_gatewaze_session', 'No store-backed appSession id on the request');
      return { outcome: 'host_session_unavailable' };
    }
    // The real signed-in user, never an impersonation target: the refresh token minted from is theirs.
    const expectedSub = req.oidc?.user?.['sub'];
    if (typeof expectedSub !== 'string' || !expectedSub) {
      return { outcome: 'ended' };
    }

    try {
      const store = await this.getStore(config, deriveGatewazeMasterKey(config.authSecret));
      // acquire() returns the stored session (refreshed if needed) before it considers minting.
      const session = await store.acquire(gwSid, () => this.mint(req, toHostConfig(config)), { expectedSub });
      return { outcome: 'ok', session };
    } catch (error) {
      return this.toFailure(req, startTime, error);
    }
  }

  /**
   * The Gatewaze session for a Realtime socket, with the callbacks `bridgeRealtime` needs, bound to
   * this LFX session. Loads the session the way `getGatewazeSession` does (stored, refreshed or newly
   * minted), but first starts listening for a sign-out, so one that lands while the session loads
   * is caught (`signedOut()`). The caller must call `release()` once the bridge listens for itself or
   * the upgrade is refused. `fresh` also ends the socket once the LFX session is gone or starts
   * impersonating. Never throws: every failure is an outcome, as for `getGatewazeSession`.
   */
  public async openRealtimeSession(req: Request): Promise<GatewazeSessionResult<GatewazeRealtimeSession<GwSession>>> {
    const startTime = Date.now();
    const config = resolveGatewazeHostSessionConfig();
    const lfxSid = readAppSessionId(req.headers.cookie);
    if (!config || !lfxSid) {
      return { outcome: 'host_session_unavailable' };
    }
    const gwSid = deriveGatewazeSid(deriveGatewazeSidKey(config.authSecret), lfxSid);
    const expectedSub = req.oidc?.user?.['sub'];
    if (typeof expectedSub !== 'string' || !expectedSub) {
      return { outcome: 'ended' };
    }

    let store: SessionStore;
    try {
      store = await this.getStore(config, deriveGatewazeMasterKey(config.authSecret));
    } catch (error) {
      return this.toFailure(req, startTime, error);
    }
    let signedOut = false;
    const stopListening = store.onDelete(gwSid, () => {
      signedOut = true;
    });
    // Once only: the store's unsubscribe, called again after its listener set emptied, would drop
    // the set a later socket on the same session registered into.
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        stopListening();
      }
    };
    try {
      const session = await store.acquire(gwSid, () => this.mint(req, toHostConfig(config)), { expectedSub });
      if (signedOut) {
        release();
        return { outcome: 'ended' };
      }
      return {
        outcome: 'ok',
        session: {
          session,
          fresh: async () => ((await isLfxSessionLive(lfxSid)) ? store.fresh(gwSid, { expectedSub }) : null),
          onSignedOut: (listener) => store.onDelete(gwSid, listener),
          signedOut: () => signedOut,
          release,
        },
      };
    } catch (error) {
      release();
      return this.toFailure(req, startTime, error);
    }
  }

  /**
   * The answer for `GET /api/gatewaze/session/me`, as the admin BFF's `/bff/me` gives it: a pending
   * admin check first, then GoTrue's `/user`, then the admin flag. When GoTrue refuses the access
   * token on `/user` (user deleted, session revoked at GoTrue), the record is dropped and minted
   * once more from the LFX session. A second refusal is `unavailable`, not `ended`: the LFX session is
   * still live and has just minted, so a 401 would send the embed round a reload that hits the same
   * refusal. That record is dropped too. Never throws.
   */
  public async getGatewazeMe(req: Request): Promise<GatewazeMeResult> {
    const first = await this.getGatewazeSession(req);
    if (first.outcome !== 'ok') {
      return first;
    }
    const answer = await this.describeSession(req, first.session);
    if (answer !== 'user_refused') {
      return answer;
    }
    if (!(await this.dropRefusedSession(req, first.session))) {
      return { outcome: 'unavailable' };
    }
    const second = await this.getGatewazeSession(req);
    if (second.outcome !== 'ok') {
      return second;
    }
    const retried = await this.describeSession(req, second.session);
    if (retried !== 'user_refused') {
      return retried;
    }
    logger.warning(req, 'get_gatewaze_me', 'GoTrue /user refused a session minted moments before; answering unavailable');
    await this.dropRefusedSession(req, second.session);
    return { outcome: 'unavailable' };
  }

  /**
   * Ends the Gatewaze session behind the request's `appSession` cookie: refresh it if needed (GoTrue's
   * logout authenticates with the access token), revoke it at GoTrue, then remove the record, which
   * publishes the sign-out to every pod. `blockReMint` picks how it is removed (see
   * `GatewazeSessionEndOptions`). Uses the cookie alone, so LFX's `/logout`, which runs before
   * `express-openid-connect`, can call it. Each step is bounded. A failed refresh or revoke does not
   * stop the steps after it; a store that cannot be reached, or no stored session, ends it early
   * with nothing removed. A record GoTrue refuses to refresh still gets the marker when `blockReMint`
   * is set. Never throws. The LFX session is not touched.
   */
  public async endGatewazeSession(req: Request, options: GatewazeSessionEndOptions): Promise<GatewazeSessionEndResult> {
    const result: GatewazeSessionEndResult = { found: false, revoked: false, deleted: false };
    const config = resolveGatewazeHostSessionConfig();
    const gwSid = config ? this.gwSidFor(req, config) : null;
    if (!config || !gwSid) {
      return result;
    }
    const step = <T>(promise: Promise<T>, name: string) => withTimeout(promise, GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS, name);
    const warn = (message: string, error: unknown) => logger.warning(req, 'end_gatewaze_session', message, { reason: errorMessage(error) });

    let store: SessionStore;
    try {
      store = await step(this.getStore(config, deriveGatewazeMasterKey(config.authSecret)), 'connect');
    } catch (error) {
      warn('Could not reach the Gatewaze session store; the record ages out on its TTL', error);
      return result;
    }

    // Read first, so a refresh GoTrue refuses outright (fresh() then discards the record and returns
    // null, with no marker) is still told apart from an id that never had a record.
    let session: GwSession | null;
    try {
      session = await step(store.get(gwSid), 'read');
    } catch (error) {
      warn('Could not read the Gatewaze session record; it ages out on its TTL', error);
      return result;
    }
    if (!session) {
      // Nothing to remove. Writing the marker anyway would let an anonymous `/logout` with a made-up
      // cookie make every pod do a Valkey write and a sign-out publish. A mint still running for a
      // real session leaves a record keyed on an LFX id that is now gone, which ages out on its TTL.
      return result;
    }
    result.found = true;
    const stored = session;
    try {
      session = await step(store.fresh(gwSid), 'refresh');
    } catch (error) {
      warn('Refresh before revoke failed; revoking with the stored token', error);
      session = stored;
    }
    // A null session here means GoTrue refused the refresh, so the refresh token is already dead
    // there and there is nothing to revoke.
    if (session) {
      // logout() resolves false rather than throwing when GoTrue refuses or cannot be reached.
      result.revoked = await step(logout(toHostConfig(config), session), 'revoke').catch(() => false);
      if (!result.revoked) {
        logger.warning(req, 'end_gatewaze_session', 'GoTrue did not confirm the revoke; the refresh token stays valid until GoTrue expires it');
      }
    }

    try {
      if (options.blockReMint) {
        // Also after a refused refresh, which removed the record without the marker: the marker is
        // what stops a mint still in flight from storing a new record after the logout.
        await step(store.delete(gwSid), 'delete');
        result.deleted = true;
      } else if (session) {
        // Only while the record still holds the token just revoked, so a session another tab has
        // minted since is left alone.
        result.deleted = await step(store.discard(gwSid, { onlyIfAccessToken: session.access_token }), 'discard');
      }
    } catch (error) {
      warn('Could not delete the Gatewaze session record; it ages out on its TTL', error);
    }
    return result;
  }

  /** Closes the Valkey connections. Registered as a shutdown hook on first connect. */
  public async close(): Promise<void> {
    const pending = this.storePromise;
    this.storePromise = null;
    if (pending) {
      await pending.then((store) => store.close()).catch(() => undefined);
    }
  }

  /** The Gatewaze session id for the request's `appSession` cookie, or null when it has no store-backed id. */
  private gwSidFor(req: Request, config: GatewazeHostSessionSettings): string | null {
    const lfxSid = readAppSessionId(req.headers.cookie);
    return lfxSid ? deriveGatewazeSid(deriveGatewazeSidKey(config.authSecret), lfxSid) : null;
  }

  /** One pass of the `/me` answer for a session in hand. `user_refused` means GoTrue's `/user` no longer accepts its token. */
  private async describeSession(req: Request, session: GwSession): Promise<GatewazeMeResult | 'user_refused'> {
    if (isAdminCheckPending(session)) {
      return { outcome: 'admin_check_pending', retryAfterSeconds: retryAfterSeconds(session) };
    }
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      return { outcome: 'host_session_unavailable' };
    }
    let user: Record<string, unknown>;
    try {
      user = await getUser(toHostConfig(config), session.access_token);
    } catch (error) {
      if (error instanceof SessionEndedError) {
        logger.debug(req, 'get_gatewaze_me', 'GoTrue /user refused the session token', { reason: error.message });
        return 'user_refused';
      }
      logger.warning(req, 'get_gatewaze_me', 'GoTrue /user unavailable', { reason: errorMessage(error) });
      return { outcome: 'unavailable' };
    }
    if (!session.is_admin) {
      return { outcome: 'not_admin', email: typeof user['email'] === 'string' ? user['email'] : undefined };
    }
    return { outcome: 'ok', user };
  }

  /**
   * After GoTrue's `/user` refused `refused`'s token: revoke it, then remove the record without the
   * sign-out marker (`store.delete` would block the re-mint for 5 minutes), and only while the record
   * still holds that token, so a session another tab has minted since is kept. Either way the next
   * `acquire` finds a usable record or mints one. False only when the store failed.
   */
  private async dropRefusedSession(req: Request, refused: GwSession): Promise<boolean> {
    const config = resolveGatewazeHostSessionConfig();
    const gwSid = config ? this.gwSidFor(req, config) : null;
    if (!config || !gwSid) {
      return false;
    }
    // GoTrue most likely refuses this too, as it already refused the token; logout() never throws.
    await withTimeout(logout(toHostConfig(config), refused), GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS, 'revoke').catch(() => false);
    try {
      const store = await this.getStore(config, deriveGatewazeMasterKey(config.authSecret));
      const removed = await store.discard(gwSid, { onlyIfAccessToken: refused.access_token });
      if (!removed) {
        logger.debug(req, 'get_gatewaze_me', 'The refused Gatewaze session was already replaced');
      }
      return true;
    } catch (error) {
      logger.warning(req, 'get_gatewaze_me', 'Could not drop the refused Gatewaze session', { reason: errorMessage(error) });
      return false;
    }
  }

  private async mint(req: Request, hostConfig: HostSessionConfig): Promise<GwSession> {
    const result = await exchangeRefreshTokenForIdToken(req);
    if (result.outcome !== 'ok') {
      throw result.outcome === 'ended'
        ? new SessionEndedError('the IdP refused the LFX refresh token')
        : new SessionUnavailableError('could not get an ID token from the IdP');
    }
    return signInWithIdToken(hostConfig, result.idToken);
  }

  private toFailure(req: Request, startTime: number, error: unknown): GatewazeSessionFailure {
    if (error instanceof IdTokenGrantRefusedError) {
      // A configuration fault (provider audience, issuer) or a banned user, never a dead LFX session.
      // ERROR, not WARN: every user hits the same fault until the provider config is fixed.
      logger.error(req, 'get_gatewaze_session', startTime, error, { status: error.status });
      return { outcome: 'refused' };
    }
    if (error instanceof SessionEndedError) {
      logger.debug(req, 'get_gatewaze_session', 'Gatewaze session ended', { reason: error.message });
      return { outcome: 'ended' };
    }
    // SessionUnavailableError, or a Valkey failure from the store: both answer 503, never a sign-out.
    logger.warning(req, 'get_gatewaze_session', 'Gatewaze session unavailable', {
      reason: errorMessage(error),
      transient: error instanceof SessionUnavailableError,
    });
    return { outcome: 'unavailable' };
  }

  private getStore(config: GatewazeHostSessionSettings, masterKey: Buffer): Promise<SessionStore> {
    if (!this.storePromise) {
      const pending = this.connect(config, masterKey);
      this.storePromise = pending;
      // A failed connect is not cached, so the next request tries again.
      pending.catch(() => {
        if (this.storePromise === pending) {
          this.storePromise = null;
        }
      });
    }
    return this.storePromise;
  }

  private async connect(config: GatewazeHostSessionSettings, masterKey: Buffer): Promise<SessionStore> {
    const store = new SessionStore(toHostConfig(config), this.createKeyValue(config.valkeyUrl), {
      keys: deriveKeys([masterKey], 'store'),
      keyPrefix: buildGatewazeHostSessionKeyPrefix(),
      ttlSeconds: GW_HOST_SESSION_TTL_SECONDS,
      // The package's messages never carry tokens.
      log: hostSessionCoreLogger('gatewaze_session_store'),
    });
    try {
      await store.start();
    } catch (error) {
      await store.close().catch(() => undefined);
      throw error;
    }
    if (!this.shutdownHookRegistered) {
      addShutdownHook(() => this.close());
      this.shutdownHookRegistered = true;
    }
    return store;
  }
}

let instance: GatewazeSessionService | null = null;

/** Lazy singleton: nothing connects to Valkey until the first `getGatewazeSession` with host-session mode on. */
export function getGatewazeSessionService(): GatewazeSessionService {
  instance ??= new GatewazeSessionService();
  return instance;
}
