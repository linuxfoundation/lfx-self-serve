// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import, not the `@lfx-one/shared/utils` barrel — the barrel re-exports meeting.utils.ts,
// which imports `@angular/common` and breaks server-side JIT compilation outside Angular's AOT context.
import { isFilterSafeUsername } from '@lfx-one/shared/utils/org-selector.utils';

import { ConflictError } from '../errors';
import { buildUserLockCacheKey, valkeyService } from '../services/valkey.service';
import { logger } from '../services/logger.service';

/**
 * Per-process fallback mutex. Used whenever a cross-replica lock isn't available: Valkey is
 * disabled (`VALKEY_URL` unset), or Valkey is enabled but temporarily unreachable. In the latter
 * case this only serializes calls on the current replica, not the whole deployment, for as long
 * as the outage lasts — cross-replica protection resumes once Valkey recovers.
 */
const inMemoryLocks = new Map<string, symbol>();

/**
 * Serializes `fn` against any other call in flight for the same `username`, cross-replica via
 * Valkey when enabled, falling back to an in-process mutex otherwise (LFXV2 #2241). Throws
 * `ConflictError` (409) immediately on contention rather than waiting/retrying — callers such as
 * `rejectIdentity` and `setMeetingInviteEmail` are user-initiated and safely retryable client-side.
 */
export async function withUserLock<T>(username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  // Fail closed on an unsafe username before choosing a backend, so both paths reject it
  // identically rather than the in-memory fallback silently accepting what Valkey would refuse.
  if (!isFilterSafeUsername(username)) {
    throw new ConflictError('Unable to acquire a lock for this account', 'LOCK_UNAVAILABLE', { operation: 'with_user_lock' });
  }

  if (valkeyService.isEnabled()) {
    const key = buildUserLockCacheKey(username);
    /* c8 ignore next 3 -- isFilterSafeUsername already passed above, so this key is never null in practice */
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
    // `unavailable` — Valkey is enabled but unreachable right now. Degrade to the per-replica
    // in-memory mutex below rather than either blocking the request or running it unguarded.
    logger.warning(undefined, 'with_user_lock', 'Valkey lock unavailable — degrading to a per-replica in-memory lock', {
      operation: 'with_user_lock',
    });
  }

  return withInMemoryLock(username, ttlMs, fn);
}

async function withInMemoryLock<T>(username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (inMemoryLocks.has(username)) {
    throw new ConflictError('This account has a conflicting request in progress. Please try again.', 'LOCK_CONTENTION', {
      operation: 'with_user_lock',
    });
  }

  // Token-gated, mirroring ValkeyService's compare-and-delete release: if fn() outlives ttlMs, the
  // safety net below clears this entry and a second caller may acquire it before the first fn()
  // settles. Without the token check, this call's `finally` would then delete the *second*
  // caller's lock, letting a third caller run concurrently with it.
  const token = Symbol('user-lock');
  inMemoryLocks.set(username, token);
  const safetyNet = setTimeout(() => {
    if (inMemoryLocks.get(username) === token) inMemoryLocks.delete(username);
  }, ttlMs);
  try {
    return await fn();
  } finally {
    clearTimeout(safetyNet);
    if (inMemoryLocks.get(username) === token) inMemoryLocks.delete(username);
  }
}
