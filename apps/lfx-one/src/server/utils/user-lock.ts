// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { buildUserLockCacheKey, valkeyService } from '../services/valkey.service';
import { ConflictError } from '../errors';

/**
 * Per-process fallback mutex, used only when Valkey is disabled (`VALKEY_URL` unset — local/test).
 * Cross-replica callers rely on `valkeyService.acquireLock`/`releaseLock` instead; this Set only
 * protects a single instance, which is all a single-process dev/test run needs.
 */
const inMemoryLocks = new Set<string>();

/**
 * Serializes `fn` against any other call in flight for the same `username`, cross-replica via
 * Valkey when enabled, falling back to an in-process mutex otherwise (LFXV2 #2241). Throws
 * `ConflictError` (409) immediately on contention rather than waiting/retrying — callers such as
 * `rejectIdentity` and `setMeetingInviteEmail` are user-initiated and safely retryable client-side.
 */
export async function withUserLock<T>(username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (valkeyService.isEnabled()) {
    const key = buildUserLockCacheKey(username);
    // A null key (unsafe username) must fail closed, not silently run unguarded.
    if (key === null) {
      throw new ConflictError('Unable to acquire a lock for this account', 'LOCK_UNAVAILABLE', { operation: 'with_user_lock' });
    }

    const result = await valkeyService.acquireLock(key, ttlMs);
    if (result.status === 'contended') {
      throw new ConflictError('This account has a conflicting request in progress. Please try again.', 'LOCK_CONTENTION', {
        operation: 'with_user_lock',
      });
    }
    if (result.status === 'acquired') {
      try {
        return await fn();
      } finally {
        await valkeyService.releaseLock(key, result.token);
      }
    }
    // `unavailable` — Valkey is enabled but unreachable right now. Fall through to the in-memory
    // mutex below rather than either blocking the request or running it unguarded.
  }

  return withInMemoryLock(username, ttlMs, fn);
}

async function withInMemoryLock<T>(username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (inMemoryLocks.has(username)) {
    throw new ConflictError('This account has a conflicting request in progress. Please try again.', 'LOCK_CONTENTION', {
      operation: 'with_user_lock',
    });
  }

  inMemoryLocks.add(username);
  // Safety net matching the Redis TTL — guards against a hung fn() wedging the lock forever.
  const safetyNet = setTimeout(() => inMemoryLocks.delete(username), ttlMs);
  try {
    return await fn();
  } finally {
    clearTimeout(safetyNet);
    inMemoryLocks.delete(username);
  }
}
