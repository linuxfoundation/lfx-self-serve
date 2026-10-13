// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac, hkdfSync } from 'node:crypto';

import {
  type GwSession,
  type HostSessionConfig,
  type KeyValue,
  deriveKeys,
  errorMessage,
  IdTokenGrantRefusedError,
  RedisKeyValue,
  SessionEndedError,
  SessionStore,
  SessionUnavailableError,
  signInWithIdToken,
} from '@gatewaze/host-session';
import {
  GW_HOST_SESSION_HKDF_INFO,
  GW_HOST_SESSION_SID_HKDF_INFO,
  GW_HOST_SESSION_SID_LABEL,
  GW_HOST_SESSION_STORE_LOG_FIELDS,
  GW_HOST_SESSION_TTL_SECONDS,
  GW_HOST_SESSION_VALKEY_COMMAND_TIMEOUT_MS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import { GatewazeHostSessionSettings, GatewazeSessionResult } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import Redis from 'ioredis';

import { readAppSessionId } from '../helpers/app-session-cookie.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { isPublishableSupabaseKey } from '../helpers/supabase-key.helper';
import { exchangeRefreshTokenForIdToken } from '../utils/refresh-token-exchange.util';
import { addShutdownHook } from '../utils/shutdown';
import { logger } from './logger.service';
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

/**
 * Host-session configuration, or null when host-session mode is off or cannot run. Every condition
 * is checked together so the routes (next PR) and the embed outlet cannot disagree about it.
 * Environment is read per call, as `isServerFeatureEnabled` does.
 */
export function resolveGatewazeHostSessionConfig(): GatewazeHostSessionSettings | null {
  if (!isServerFeatureEnabled(ServerFeatureFlag.GatewazeHostSession) || !isServerFeatureEnabled(ServerFeatureFlag.GatewazeEmbedEnabled)) {
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

function toHostConfig(config: GatewazeHostSessionSettings): HostSessionConfig {
  return { supabaseUrl: config.supabaseUrl, anonKey: config.anonKey };
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
 * record managed by `@gatewaze/host-session`'s `SessionStore`. Nothing is mounted on it yet; the
 * `/api/gatewaze` routes come in the next PR. See `docs/architecture/backend/gw-host-session.md`.
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
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      return { outcome: 'host_session_unavailable' };
    }
    const lfxSid = readAppSessionId(req.headers.cookie);
    if (!lfxSid) {
      logger.debug(req, 'get_gatewaze_session', 'No store-backed appSession id on the request');
      return { outcome: 'host_session_unavailable' };
    }
    // The real signed-in user, never an impersonation target: the refresh token minted from is theirs.
    const expectedSub = req.oidc?.user?.['sub'];
    if (typeof expectedSub !== 'string' || !expectedSub) {
      return { outcome: 'ended' };
    }

    const gwSid = deriveGatewazeSid(deriveGatewazeSidKey(config.authSecret), lfxSid);
    try {
      const store = await this.getStore(config, deriveGatewazeMasterKey(config.authSecret));
      // acquire() returns the stored session (refreshed if needed) before it considers minting.
      const session = await store.acquire(gwSid, () => this.mint(req, toHostConfig(config)), { expectedSub });
      return { outcome: 'ok', session };
    } catch (error) {
      return this.toFailure(req, error);
    }
  }

  /** Closes the Valkey connections. Registered as a shutdown hook on first connect. */
  public async close(): Promise<void> {
    const pending = this.storePromise;
    this.storePromise = null;
    if (pending) {
      await pending.then((store) => store.close()).catch(() => undefined);
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

  private toFailure(req: Request, error: unknown): GatewazeSessionResult<GwSession> {
    if (error instanceof IdTokenGrantRefusedError) {
      // A configuration fault (provider audience, issuer) or a banned user, never a dead LFX session.
      logger.warning(req, 'get_gatewaze_session', 'GoTrue refused the ID token grant', { status: error.status });
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
      log: { warn: (meta, message) => logger.warning(undefined, 'gatewaze_session_store', message, storeLogMeta(meta)) },
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
