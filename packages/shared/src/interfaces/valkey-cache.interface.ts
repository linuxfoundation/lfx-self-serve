// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Generic versioned envelope stored in the cache (`v` = schema version; `cachedAt` informational). */
export interface CachedEnvelope<T> {
  /** Schema version; a read seeing a mismatched version treats the entry as a miss. */
  v: number;
  /** The cached payload — only data the requesting principal is already authorized to see. */
  data: T;
  /** Epoch ms when written (observability/debug only). */
  cachedAt: number;
}

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

  /** Parsed value on hit; `null` on miss, disabled, timeout, fault, or when `accept` rejects the shape. Never throws. */
  getJson<T>(key: string, accept?: (value: unknown) => boolean): Promise<T | null>;

  /** Best-effort write with a TTL in seconds. Returns whether it persisted. Never throws. */
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;

  /** Read-through helper; `key === null` (or disabled cache) runs `fetcher()` directly (fail-closed); `accept` rejects a malformed cached value as a miss. Cache faults are swallowed, but errors from `fetcher()` propagate to the caller. */
  withCache<T>(key: string | null, ttlSeconds: number, fetcher: () => Promise<T>, accept?: (value: unknown) => boolean): Promise<T>;
}
