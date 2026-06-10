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

/** Reusable cache port implemented by the shared Valkey client. All methods are fail-soft (never throw). */
export interface CachePort {
  /** True when a cache backend is configured and the client is usable. */
  isEnabled(): boolean;

  /** Parsed value on hit; `null` on miss, disabled, timeout, or any fault. Never throws. */
  getJson<T>(key: string): Promise<T | null>;

  /** Best-effort write with a TTL in seconds. Returns whether it persisted. Never throws. */
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;

  /** Read-through helper; `key === null` (or disabled cache) runs `fetcher()` directly with no read/write (fail-closed). */
  withCache<T>(key: string | null, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T>;
}
