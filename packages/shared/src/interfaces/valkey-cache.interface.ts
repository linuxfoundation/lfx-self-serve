// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Reusable cache port implemented by the shared Valkey client. The cache operations themselves are
 * fail-soft: getJson/setJson — and the cache read/write that withCache performs around the fetcher —
 * never throw (faults, timeouts, or malformed values degrade to a miss / no-op). The one exception is
 * withCache, which intentionally propagates any error thrown or rejected by the caller's fetcher() so
 * that genuine upstream failures surface to the caller rather than being masked as a cache miss.
 */
export interface CachePort {
  /** True when a cache backend is configured and the client is usable. */
  isEnabled(): boolean;

  /** Parsed value on hit; `null` on miss, disabled, timeout, fault, or when `accept` rejects the shape. Never throws. `timeoutMs` overrides the default per-op cap — callers with a fail-closed use (e.g. the session store's authoritative reads) can widen it beyond the cache's fail-soft default. */
  getJson<T>(key: string, accept?: (value: unknown) => boolean, timeoutMs?: number): Promise<T | null>;

  /** Best-effort write with a TTL in seconds. Returns whether it persisted. Never throws. `timeoutMs` overrides the default per-op cap — callers with a fail-closed use (e.g. the session store) can widen it beyond the cache's fail-soft default. */
  setJson(key: string, value: unknown, ttlSeconds: number, timeoutMs?: number): Promise<boolean>;

  /** Best-effort invalidation. A null key (fail-closed) or disabled cache is a no-op; a fault is swallowed and reported via the returned `deleted` boolean rather than a throw. `timeoutMs` overrides the default per-op cap. */
  del(key: string | null, timeoutMs?: number): Promise<boolean>;

  /**
   * Read-through helper; a null key or disabled cache runs `fetcher()` directly. `accept` treats a
   * malformed cached value as a miss; a fresh result is written only when `storable` allows it but is
   * still returned. Cache faults are swallowed; `fetcher()` errors propagate.
   */
  withCache<T>(
    key: string | null,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    accept?: (value: unknown) => boolean,
    storable?: (value: T) => boolean
  ): Promise<T>;
}

/**
 * Outcome of a distributed lock acquire attempt. A discriminated union rather than a bare
 * `string | null` token, because a caller like `withMeetingInviteLock` must react very differently to
 * "someone else holds this lock" (`contended` — fail the request) versus "the lock backend is
 * unusable right now" (`unavailable` — fall back to an in-process lock); collapsing both to a
 * falsy token would make that distinction unrecoverable at the call site. `unavailable` carries an
 * optional `token` when the `SET` may actually have landed (a timeout, not a clean error) so the
 * caller can attempt one more release after its own work finishes, by which point the backend may
 * have recovered — on top of `acquireLock`'s own immediate and delayed best-effort releases.
 */
export type LockAcquireResult = { status: 'acquired'; token: string } | { status: 'contended' } | { status: 'unavailable'; token?: string };
