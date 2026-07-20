// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { SessionStorePayload } from '@lfx-one/shared/interfaces';

import { AuthenticationError } from '../errors';
import { buildSessionCacheKey, valkeyService } from './valkey.service';
import { logger } from './logger.service';

/**
 * express-openid-connect session store backed by Valkey. Moves the session bundle (Auth0 tokens
 * plus impersonation / API-gateway / crowdfunding / profile tokens written onto `req.appSession`)
 * out of the encrypted `appSession` cookie and into Valkey, keyed by an opaque session id — the
 * cookie then only carries that id. Reads are fail-soft: a Valkey read fault degrades to a miss
 * (treated by express-openid-connect as an expired session, forcing re-auth) rather than a 500,
 * matching ValkeyService's existing fail-soft cache behavior. Writes are always fail-closed: a
 * session that fails to persist is invalidated (so a stale/mutated value never survives at that
 * key) and throws an `AuthenticationError` (401) rather than resolving — express-openid-connect
 * surfaces the throw as a request error, and 401 rather than a bare 500 means a Valkey outage
 * degrades every affected request to "please log in again" instead of a crash, mirroring the
 * fail-soft *experience* of a read fault while never serving stale data. This applies uniformly to
 * every write (new session or rolling refresh) — a refresh write can carry a real mutation (e.g.
 * stop-impersonation clearing `impersonationToken`), and there's no cheap, reliable way to prove
 * the payload is unchanged before deciding it's safe to leave the prior entry in place.
 *
 * Structurally matches express-openid-connect's `session.store` contract (`get`/`set`/`destroy`
 * with a callback) — that type isn't exported from the library, so compatibility is enforced by
 * assignment in `server.ts` rather than an `implements` clause here.
 */
export class SessionStoreService {
  // express-openid-connect's safePromisify probes callback-vs-promise stores two ways: first by
  // checking whether the method's *minified* source still contains the substring "cb"/"callback"
  // (unreliable — production builds minify local parameter names), and if that fails, by invoking
  // the method with no callback arg and checking whether the result is a thenable. Returning the
  // underlying promise whenever `callback` is omitted satisfies that probe under either detection
  // path, instead of invoking `callback` as a function when it's `undefined`.
  public get(sid: string, callback?: (err: unknown, session?: SessionStorePayload | null) => void): void | Promise<SessionStorePayload | null> {
    const promise = this.getAsync(sid);
    if (!callback) {
      return promise;
    }
    void promise.then(
      (session) => callback(null, session),
      (err) => callback(err)
    );
  }

  public set(sid: string, session?: SessionStorePayload, callback?: (err?: unknown) => void): void | Promise<void> {
    // The same detection probe above can invoke `set` with only the `sid` arg to test for a
    // thenable return — guard against treating that as a real write (which would persist
    // `undefined` as the session value) rather than reaching setAsync with a missing payload.
    if (!session) {
      return callback ? callback() : Promise.resolve();
    }
    const promise = this.setAsync(sid, session);
    if (!callback) {
      return promise;
    }
    void promise.then(
      () => callback(),
      (err) => callback(err)
    );
  }

  public destroy(sid: string, callback?: (err?: unknown) => void): void | Promise<void> {
    const promise = this.destroyAsync(sid);
    if (!callback) {
      return promise;
    }
    void promise.then(
      () => callback(),
      (err) => callback(err)
    );
  }

  private async getAsync(sid: string): Promise<SessionStorePayload | null> {
    const key = this.cacheKey(sid);
    if (key === null) {
      return null;
    }
    // Authoritative session read — must use the same widened budget as the write path
    // (VALKEY_CACHE.SESSION_OP_TIMEOUT_MS) rather than the cache's default OP_TIMEOUT_MS (250ms).
    // Otherwise a cold pod's first get() can time out well before the TLS handshake completes,
    // reading back a false "session missing" and forcing re-login even though the same connection
    // would have succeeded within the budget the write path already gets.
    return valkeyService.getJson<SessionStorePayload>(key, SessionStoreService.isSessionPayload, VALKEY_CACHE.SESSION_OP_TIMEOUT_MS);
  }

  private async setAsync(sid: string, session: SessionStorePayload): Promise<void> {
    const startTime = logger.startOperation(undefined, 'session_store_set');
    const key = this.cacheKey(sid);
    if (key === null) {
      // Nothing was persisted, so letting this resolve normally would hand back a cookie whose id
      // never resolves in Valkey — the same unrecoverable-login-loop failure mode a Valkey write
      // failure below fails closed on. Fail closed here too instead of silently no-op'ing.
      throw new AuthenticationError('Your session could not be saved — please sign in again.', {
        operation: 'session_store_set',
        clearSession: true,
      });
    }
    const ttlSeconds = this.ttlSecondsFor(session);
    // One shared deadline for the whole fail-closed sequence (the SET plus its fallback DEL
    // retries below) — rather than handing each call its own fresh SESSION_OP_TIMEOUT_MS budget,
    // which could chain into ~3x the intended latency (a hard outage timing out all three) before
    // the request is failed. The retries still get a chance to run against a since-recovered
    // connection, just within what's left of the one budget instead of a brand new one each time.
    const deadline = Date.now() + VALKEY_CACHE.SESSION_OP_TIMEOUT_MS;
    const persisted = await valkeyService.setJson(key, session, ttlSeconds, VALKEY_CACHE.SESSION_OP_TIMEOUT_MS);
    if (!persisted) {
      // setJson is a `SET key val EX ttl` — a failed write leaves any prior value at this key
      // untouched, so a stale session (e.g. a cleared impersonation token) would otherwise survive
      // and be reloaded on the next request. Always invalidate on a failed write — whether this was
      // a brand-new session or a rolling refresh — since a refresh write can carry a real mutation
      // and there's no cheap, reliable way to prove the payload is unchanged before leaving the
      // prior entry in place.
      // `set` and `del` are independent Redis commands — a transient blip can fail both back-to-back
      // while a later `get` succeeds against a since-recovered connection, resurrecting the stale
      // entry. One immediate retry closes most of that window, within the remaining budget.
      let invalidated = await valkeyService.del(key, this.remainingMs(deadline));
      if (!invalidated) {
        invalidated = await valkeyService.del(key, this.remainingMs(deadline));
      }
      if (!invalidated) {
        logger.error(undefined, 'session_store_set', startTime, new Error('Valkey write and fallback invalidation both failed'), {
          message: 'Session write failed and the stale entry could not be invalidated — a prior session value may still be served',
        });
      } else {
        logger.warning(
          undefined,
          'session_store_set',
          'Session write failed — invalidated the stale entry; apiErrorHandler clears the cookie and the current request gets a 401, forcing an immediate re-login'
        );
      }
      // express-openid-connect awaits store.set() inside its res.end() wrapper and calls next(err)
      // on rejection instead of completing the response. Throwing AuthenticationError (401) rather
      // than a bare Error means apiErrorHandler returns a structured "please re-authenticate"
      // response and logs at warn (not error) — so a Valkey outage degrades every affected request
      // to a forced re-login instead of a raw 500, without ever serving the invalidated stale entry.
      // Also tell apiErrorHandler to clear req.appSession: express-openid-connect's cookie-write hook
      // fires regardless of this throw, and would otherwise reissue a cookie pointing at a stale (or
      // un-invalidated) Valkey entry.
      throw new AuthenticationError('Your session could not be saved — please sign in again.', { operation: 'session_store_set', clearSession: true });
    }
  }

  private async destroyAsync(sid: string): Promise<void> {
    const startTime = logger.startOperation(undefined, 'session_store_destroy');
    const key = this.cacheKey(sid);
    if (key === null) {
      return;
    }
    const deleted = await valkeyService.del(key, VALKEY_CACHE.SESSION_OP_TIMEOUT_MS);
    if (!deleted) {
      logger.error(undefined, 'session_store_destroy', startTime, new Error('Valkey delete failed'), {
        message: 'Session delete failed on logout — session will remain valid in Valkey until it expires via TTL',
      });
    }
  }

  /** Time left until `deadline`, floored at 0 — never hands a downstream timeout a negative budget. */
  private remainingMs(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  }

  /** Fail-closed on an unsafe/oversized session id — express-openid-connect then treats the session as missing rather than reading/writing a corrupt key. */
  private cacheKey(sid: string): string | null {
    const key = buildSessionCacheKey(sid);
    if (key === null) {
      // The sid comes straight from an unsigned cookie an anonymous client controls, so a malformed
      // value is expected untrusted input rather than a system fault — debug, not warn, avoids a
      // log flood from probing/malformed cookies ahead of route-level rate limiting.
      logger.debug(undefined, 'session_store_key', 'Session id failed the cache-key safety check — treating session as missing');
    }
    return key;
  }

  /** Derives the Valkey TTL from the session's own `cookie.maxAge` (set by express-openid-connect from `session.rollingDuration`/`session.absoluteDuration`) so entries expire alongside the cookie; falls back to the configured default if that shape is ever missing. */
  private ttlSecondsFor(session: SessionStorePayload): number {
    const maxAgeMs = session.cookie?.maxAge;
    if (typeof maxAgeMs === 'number') {
      // A present-but-non-positive maxAge means the cookie has already reached its absolute expiry —
      // the multi-day fallback below is reserved for missing/invalid metadata, not an expired session.
      return maxAgeMs > 0 ? Math.ceil(maxAgeMs / 1000) : VALKEY_CACHE.SESSION_EXPIRED_TTL_SECONDS;
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
