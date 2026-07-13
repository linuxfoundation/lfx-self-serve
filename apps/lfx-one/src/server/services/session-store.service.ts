// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { SessionStorePayload } from '@lfx-one/shared/interfaces';

import { buildSessionCacheKey, valkeyService } from './valkey.service';
import { logger } from './logger.service';

/**
 * express-openid-connect session store backed by Valkey. Moves the session bundle (Auth0 tokens
 * plus impersonation / API-gateway / crowdfunding / profile tokens written onto `req.appSession`)
 * out of the encrypted `appSession` cookie and into Valkey, keyed by an opaque session id — the
 * cookie then only carries that id. Reads are fail-soft: a Valkey read fault degrades to a miss
 * (treated by express-openid-connect as an expired session, forcing re-auth) rather than a 500,
 * matching ValkeyService's existing fail-soft cache behavior. Writes are fail-closed: a session
 * that fails to persist throws instead of resolving, which express-openid-connect surfaces as a
 * request error rather than silently issuing a cookie for a session that was never saved.
 *
 * Structurally matches express-openid-connect's `session.store` contract (`get`/`set`/`destroy`
 * with a callback) — that type isn't exported from the library, so compatibility is enforced by
 * assignment in `server.ts` rather than an `implements` clause here.
 */
export class SessionStoreService {
  public get(sid: string, callback: (err: unknown, session?: SessionStorePayload | null) => void): void {
    void this.getAsync(sid).then(
      (session) => callback(null, session),
      (err) => callback(err)
    );
  }

  public set(sid: string, session: SessionStorePayload, callback?: (err?: unknown) => void): void {
    void this.setAsync(sid, session).then(
      () => callback?.(),
      (err) => callback?.(err)
    );
  }

  public destroy(sid: string, callback?: (err?: unknown) => void): void {
    void this.destroyAsync(sid).then(
      () => callback?.(),
      (err) => callback?.(err)
    );
  }

  private async getAsync(sid: string): Promise<SessionStorePayload | null> {
    const key = this.cacheKey(sid);
    if (key === null) {
      return null;
    }
    return valkeyService.getJson<SessionStorePayload>(key, SessionStoreService.isSessionPayload);
  }

  private async setAsync(sid: string, session: SessionStorePayload): Promise<void> {
    const startTime = logger.startOperation(undefined, 'session_store_set');
    const key = this.cacheKey(sid);
    if (key === null) {
      return;
    }
    const ttlSeconds = this.ttlSecondsFor(session);
    const persisted = await valkeyService.setJson(key, session, ttlSeconds);
    if (!persisted) {
      // setJson is a `SET key val EX ttl` — a failed write leaves any prior value at this key
      // untouched, so a stale session (e.g. a cleared impersonation token) would otherwise survive
      // and be reloaded on the next request. Fail closed by invalidating the key outright.
      const invalidated = await valkeyService.del(key);
      if (!invalidated) {
        logger.error(undefined, 'session_store_set', startTime, new Error('Valkey write and fallback invalidation both failed'), {
          message: 'Session write failed and the stale entry could not be invalidated — a prior session value may still be served',
        });
      } else {
        logger.warning(
          undefined,
          'session_store_set',
          'Session write failed — invalidated the stale entry, user will be treated as logged out on next request'
        );
      }
      // express-openid-connect awaits store.set() inside its res.end() wrapper and calls next(err)
      // on rejection instead of completing the response — surfacing this now prevents the OIDC login
      // callback from issuing a cookie for a session that was never persisted, which would otherwise
      // loop the user through login indefinitely while Valkey is down.
      throw new Error('Session write failed to persist');
    }
  }

  private async destroyAsync(sid: string): Promise<void> {
    const startTime = logger.startOperation(undefined, 'session_store_destroy');
    const key = this.cacheKey(sid);
    if (key === null) {
      return;
    }
    const deleted = await valkeyService.del(key);
    if (!deleted) {
      logger.error(undefined, 'session_store_destroy', startTime, new Error('Valkey delete failed'), {
        message: 'Session delete failed on logout — session will remain valid in Valkey until it expires via TTL',
      });
    }
  }

  /** Fail-closed on an unsafe/oversized session id — express-openid-connect then treats the session as missing rather than reading/writing a corrupt key. */
  private cacheKey(sid: string): string | null {
    const key = buildSessionCacheKey(sid);
    if (key === null) {
      logger.warning(undefined, 'session_store_key', 'Session id failed the cache-key safety check — treating session as missing');
    }
    return key;
  }

  /** Derives the Valkey TTL from the session's own `cookie.maxAge` (set by express-openid-connect from `session.rollingDuration`/`session.absoluteDuration`) so entries expire alongside the cookie; falls back to the configured default if that shape is ever missing. */
  private ttlSecondsFor(session: SessionStorePayload): number {
    const maxAgeMs = session.cookie?.maxAge;
    if (typeof maxAgeMs === 'number' && maxAgeMs > 0) {
      return Math.ceil(maxAgeMs / 1000);
    }
    return VALKEY_CACHE.SESSION_FALLBACK_TTL_SECONDS;
  }

  /**
   * Guards against a corrupt/legacy cache entry being handed back to express-openid-connect as a
   * valid session — a shallow key-presence check would let e.g. `data: null` through, and
   * express-openid-connect crashes trying to redefine `req.appSession` with a non-object value.
   */
  private static isSessionPayload(value: unknown): value is SessionStorePayload {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const header = (value as { header?: unknown }).header;
    const data = (value as { data?: unknown }).data;
    const cookie = (value as { cookie?: unknown }).cookie;
    if (typeof header !== 'object' || header === null || typeof data !== 'object' || data === null || typeof cookie !== 'object' || cookie === null) {
      return false;
    }
    const { iat, uat, exp } = header as { iat?: unknown; uat?: unknown; exp?: unknown };
    const { expires, maxAge } = cookie as { expires?: unknown; maxAge?: unknown };
    return typeof iat === 'number' && typeof uat === 'number' && typeof exp === 'number' && typeof expires === 'number' && typeof maxAge === 'number';
  }
}

export const sessionStoreService = new SessionStoreService();
