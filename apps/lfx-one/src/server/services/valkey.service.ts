// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CachePort } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, isFilterSafeUsername } from '@lfx-one/shared/utils';
import Redis from 'ioredis';

import { addShutdownHook } from '../utils/shutdown';
import { logger } from './logger.service';

/** Cross-instance, TTL read-through cache backed by Valkey. Fail-soft, lazy-connect; disabled when VALKEY_URL is unset. */
export class ValkeyService implements CachePort {
  private static instance: ValkeyService | null = null;

  private readonly client: Redis | null = null;
  private shutdownHookRegistered = false;
  private connectingPromise: Promise<void> | null = null;

  private constructor() {
    const url = process.env['VALKEY_URL'];
    if (!url) {
      logger.info(undefined, 'valkey_init', 'VALKEY_URL not set — shared cache disabled (direct-fetch fallback)');
      return;
    }

    // Non-blocking: never delays startup/readiness or stalls a request. A rediss:// URL enables TLS
    // with full certificate verification — the configured host matches the managed cache's certificate.
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: VALKEY_CACHE.CONNECT_TIMEOUT_MS,
    });

    // Connection-level errors must never crash the process; log and continue (cache stays best-effort).
    this.client.on('error', (err: Error) => {
      logger.warning(undefined, 'valkey_client_error', 'Valkey client error — cache operating in degraded (fail-soft) mode', { err });
    });

    this.registerShutdown();
    logger.info(undefined, 'valkey_init', 'Shared Valkey cache enabled');
  }

  /** Singleton accessor — all services share one connection. */
  public static getInstance(): ValkeyService {
    if (!ValkeyService.instance) {
      ValkeyService.instance = new ValkeyService();
    }
    return ValkeyService.instance;
  }

  /** Reset the singleton (primarily for tests). */
  public static resetInstance(): void {
    if (ValkeyService.instance) {
      void ValkeyService.instance.shutdown();
      ValkeyService.instance = null;
    }
  }

  public isEnabled(): boolean {
    return this.client !== null;
  }

  public async getJson<T>(key: string, accept?: (value: unknown) => boolean, timeoutMs: number = VALKEY_CACHE.OP_TIMEOUT_MS): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = (await this.withTimeout(
        this.runWhenConnected(() => this.client!.get(key), timeoutMs),
        timeoutMs
      )) as string | null;
      if (raw == null) return null;
      // setJson caps our own writes, but another client (or a manual write) could store an oversized value.
      // Parsing a very large JSON string blocks the event loop, so reject oversized reads as a miss before parsing.
      if (Buffer.byteLength(raw, 'utf8') > VALKEY_CACHE.MAX_VALUE_BYTES) {
        logger.warning(undefined, 'valkey_get', 'Cached value exceeds max size — treating as miss', { cache_key: ValkeyService.redactKey(key) });
        return null;
      }
      const parsed = JSON.parse(raw);
      // A corrupt/legacy/partial entry must degrade to a miss, never surface as a fault to the caller.
      if (accept && !accept(parsed)) {
        logger.warning(undefined, 'valkey_get', 'Cached value failed shape check — treating as miss', { cache_key: ValkeyService.redactKey(key) });
        return null;
      }
      return parsed as T;
    } catch (err) {
      logger.warning(undefined, 'valkey_get', 'Cache read failed — falling back to source', { err, cache_key: ValkeyService.redactKey(key) });
      return null;
    }
  }

  /**
   * Writes a JSON-serialized value with a TTL. `timeoutMs` (default `VALKEY_CACHE.OP_TIMEOUT_MS`)
   * bounds the whole operation, including establishing the connection on a cold client. Fails soft:
   * a timeout, an oversized value, or any cache fault returns `false` rather than throwing.
   */
  public async setJson(key: string, value: unknown, ttlSeconds: number, timeoutMs: number = VALKEY_CACHE.OP_TIMEOUT_MS): Promise<boolean> {
    if (!this.client) return false;
    try {
      const serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized, 'utf8') > VALKEY_CACHE.MAX_VALUE_BYTES) {
        logger.warning(undefined, 'valkey_set', 'Skipping cache write — value exceeds max size', { cache_key: ValkeyService.redactKey(key) });
        return false;
      }
      await this.withTimeout(
        this.runWhenConnected(() => this.client!.set(key, serialized, 'EX', ttlSeconds), timeoutMs),
        timeoutMs
      );
      return true;
    } catch (err) {
      logger.warning(undefined, 'valkey_set', 'Cache write failed — continuing without caching', { err, cache_key: ValkeyService.redactKey(key) });
      return false;
    }
  }

  /** Best-effort invalidation. A null key (fail-closed) or disabled cache is a no-op; a fault just leaves the entry to age out via TTL and reports back via the `deleted` boolean rather than throwing. */
  public async del(key: string | null, timeoutMs: number = VALKEY_CACHE.OP_TIMEOUT_MS): Promise<boolean> {
    if (key === null || !this.client) return false;
    try {
      await this.withTimeout(
        this.runWhenConnected(() => this.client!.del(key), timeoutMs),
        timeoutMs
      );
      return true;
    } catch (err) {
      logger.warning(undefined, 'valkey_del', 'Cache delete failed — entry will age out via TTL', { err, cache_key: ValkeyService.redactKey(key) });
      return false;
    }
  }

  public async withCache<T>(key: string | null, ttlSeconds: number, fetcher: () => Promise<T>, accept?: (value: unknown) => boolean): Promise<T> {
    // Fail-closed (no principal-bound key) or disabled cache → direct fetch, no read/write.
    if (key === null || !this.client) {
      logger.debug(undefined, 'cache_bypass', 'Cache bypassed (no key or disabled) — fetching directly', {
        cache_key: key ? ValkeyService.redactKey(key) : undefined,
      });
      return fetcher();
    }

    const hit = await this.getJson<T>(key, accept);
    if (hit !== null) {
      logger.debug(undefined, 'cache_hit', 'Cache hit', { cache_key: ValkeyService.redactKey(key) });
      return hit;
    }

    logger.debug(undefined, 'cache_miss', 'Cache miss — fetching from source', { cache_key: ValkeyService.redactKey(key) });
    const result = await fetcher();
    await this.setJson(key, result, ttlSeconds);
    return result;
  }

  /** Closes the connection (best-effort). Registered as a shutdown hook. */
  public async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  /**
   * Redacts the per-user tail of a cache key for logging. Keys are
   * `${APP_PREFIX}[:${KEY_NAMESPACE}]:${domain}:v${N}:${principal}…` — the optional deployment
   * namespace segment may or may not be present, but the domain always ends in a `vN` version
   * segment that immediately precedes the principal. We anchor on that version segment, keeping the
   * full non-user prefix (app prefix, optional deployment namespace, domain, and version) and masking
   * everything from the principal onward, so logs preserve the full namespace/version without leaking
   * usernames regardless of whether the deployment namespace is set.
   *
   * Caveat: the anchor matches the first `vN`-shaped segment, so a deployment namespace that is itself
   * `vN` (e.g. `v5`) anchors early and over-masks the domain. This is harmless — it only reduces log
   * fidelity, never exposing the principal — so it is not worth special-casing.
   */
  private static redactKey(key: string): string {
    const parts = key.split(':');
    const versionIdx = parts.findIndex((p) => /^v\d+$/.test(p));
    if (versionIdx === -1 || versionIdx >= parts.length - 1) return key;
    return `${parts.slice(0, versionIdx + 1).join(':')}:***`;
  }

  /**
   * Awaits a live connection before issuing `command`. Needed because `lazyConnect` + `enableOfflineQueue:
   * false` means ioredis rejects a command synchronously ("Stream isn't writeable...") on any client that
   * isn't already `ready` — whether it's the initial `wait` state (cold pod) or `connecting`/`reconnecting`
   * after a dropped connection (ioredis's own retry timer, not something we trigger) — instead of waiting
   * out the handshake, so the per-op timeout never gets a chance to apply. Awaiting readiness first (deduped
   * via `connectingPromise` so concurrent callers share one in-flight wait) closes that gap for every
   * non-`ready` state.
   *
   * The wait is bounded by this caller's own `timeoutMs` rather than left to race only the outer
   * `withTimeout`: `Promise.race` never cancels the loser, so during a prolonged reconnect every
   * timed-out caller's `command()` would otherwise stay attached to the shared `connectingPromise` and
   * fire — all at once, with a potentially stale payload — the moment `ready` eventually arrives
   * (unbounded memory retention plus a write/delete storm right as Valkey recovers). Racing the wait
   * against this caller's own deadline means a caller that times out never reaches `command()` at all.
   */
  private async runWhenConnected<T>(command: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.client && this.client.status !== 'ready') {
      if (!this.connectingPromise) {
        this.connectingPromise = this.waitUntilReady(this.client).finally(() => {
          this.connectingPromise = null;
        });
      }
      await this.withTimeout(this.connectingPromise, timeoutMs);
    }
    return command();
  }

  /** `wait`/`end` need an explicit `connect()`; any other non-`ready` status (`close`/`connecting`/`reconnecting`)
   * is already being driven by ioredis's own retry timer, so we just await its next `ready`. ioredis's `error`
   * event fires on every failed retry attempt while the client keeps retrying — it is not terminal — so it's
   * not treated as a rejection here; only `end` (ioredis giving up on reconnecting) is. The `client.status ===
   * 'ready'` re-check inside the executor closes the race where `ready` fires between `runWhenConnected`'s
   * status check and this listener being attached. */
  private waitUntilReady(client: Redis): Promise<void> {
    if (client.status === 'wait' || client.status === 'end') {
      return client.connect();
    }
    if (client.status === 'ready') {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      if (client.status === 'ready') {
        resolve();
        return;
      }
      const onReady = (): void => {
        client.off('end', onEnd);
        resolve();
      };
      const onEnd = (): void => {
        client.off('ready', onReady);
        reject(new Error('valkey_connection_ended'));
      };
      client.once('ready', onReady);
      client.once('end', onEnd);
    });
  }

  /** Races a cache op against the per-op cap; a lost race rejects and the caller treats it as a miss. */
  private async withTimeout<T>(op: Promise<T>, timeoutMs: number = VALKEY_CACHE.OP_TIMEOUT_MS): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('valkey_op_timeout')), timeoutMs);
    });
    // If the timeout wins the race, the underlying op is abandoned; swallow its eventual settlement
    // so a late rejection from a slow/faulty backend never surfaces as an unhandled rejection.
    op.catch(() => undefined);
    try {
      return await Promise.race([op, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private registerShutdown(): void {
    if (this.shutdownHookRegistered) return;
    addShutdownHook(() => this.shutdown());
    this.shutdownHookRegistered = true;
  }
}

/**
 * Optional per-deployment cache-key namespace (e.g. a feature-branch id like `ui-pr-42`) inserted
 * after the app prefix so deployments sharing one Valkey instance never read or write each other's
 * keys. Characters outside the safe key-segment set are replaced with `-`; an unset value yields an
 * empty string (no namespace segment).
 */
export function cacheKeyNamespace(): string {
  return (process.env['VALKEY_KEY_NAMESPACE'] ?? '').replace(/[^A-Za-z0-9._-]/g, '-');
}

/** Joins the app prefix with the optional deployment namespace segment, matching the existing adopters. */
function keyPrefix(): string {
  const ns = cacheKeyNamespace();
  return ns ? `${VALKEY_CACHE.APP_PREFIX}:${ns}` : VALKEY_CACHE.APP_PREFIX;
}

/** Session-store cache key for an opaque session id; null (fail-closed) when the id isn't filter-safe, so it can't corrupt the `:`-delimited key. */
export function buildSessionCacheKey(sessionId: string): string | null {
  if (!isFilterSafeIdentifier(sessionId)) return null;
  return `${keyPrefix()}:${VALKEY_CACHE.SESSION_NAMESPACE}:${sessionId}`;
}

/** Per-org Snowflake-namespace cache key (account id + caller-chosen sub-resource); null (fail-closed → direct fetch) when the account id isn't filter-safe, so it can't corrupt the `:`-delimited key. */
export function buildOrgCacheKey(accountId: string, subResource: string): string | null {
  if (!isFilterSafeIdentifier(accountId)) return null;
  return `${keyPrefix()}:${VALKEY_CACHE.ORG_LENS_SNOWFLAKE_NAMESPACE}:${accountId}:${subResource}`;
}

/** Per-user cache key (caller username + org uid under a caller-chosen namespace); null (fail-closed → direct fetch) when the username or org uid isn't filter-safe, keeping cache identity aligned with the authz principal and the `:`-delimited key uncorruptible. */
export function buildPerUserOrgKey(namespace: string, username: string, orgUid: string): string | null {
  if (!isFilterSafeUsername(username) || !isFilterSafeIdentifier(orgUid)) return null;
  return `${keyPrefix()}:${namespace}:${username}:${orgUid}`;
}

/** Read-through helper for the per-org Snowflake-backed namespace; a null key (unsafe account id) fetches directly. */
export function withOrgCache<T>(
  accountId: string,
  subResource: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  accept?: (value: unknown) => boolean
): Promise<T> {
  return valkeyService.withCache(buildOrgCacheKey(accountId, subResource), ttlSeconds, fetcher, accept);
}

/** Best-effort invalidation of a per-user org key (e.g. after a write so the caller's own next read is fresh); an unsafe identity yields a null key → no-op. */
export function invalidatePerUserCache(namespace: string, username: string, orgUid: string): Promise<boolean> {
  return valkeyService.del(buildPerUserOrgKey(namespace, username, orgUid));
}

/** Read-through helper for a per-user org namespace; a null key (unsafe username) fetches directly. */
export function withPerUserCache<T>(
  namespace: string,
  username: string,
  orgUid: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  accept?: (value: unknown) => boolean
): Promise<T> {
  return valkeyService.withCache(buildPerUserOrgKey(namespace, username, orgUid), ttlSeconds, fetcher, accept);
}

/** Shared accessor — forwards to the current singleton so resetInstance() is always honored (no stale binding). */
export const valkeyService: ValkeyService = new Proxy({} as ValkeyService, {
  get: (_target, prop: string | symbol, receiver) => {
    const instance = ValkeyService.getInstance();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
