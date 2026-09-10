// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import, not the `@lfx-one/shared/utils` barrel: user-lock.spec.ts (unlike valkey.service.spec.ts)
// doesn't mock the barrel, and it re-exports meeting.utils.ts, whose `@angular/common` import fails
// to load under vitest's Node environment (no AOT/JIT compiler available there).
import { isFilterSafeUsername } from '@lfx-one/shared/utils/org-selector.utils';
import { Request } from 'express';

import { ConflictError } from '../errors';
import { buildUserLockCacheKey, valkeyService } from '../services/valkey.service';
import { logger } from '../services/logger.service';

/**
 * Per-replica mutex, held unconditionally around every call (see `withUserLock`) so a same-replica
 * race is always caught even if Valkey flips from available to unreachable mid-flight. When Valkey
 * is enabled and reachable it adds cross-replica coverage on top; when it isn't, this is the only
 * protection in effect, for as long as that lasts.
 */
const inMemoryLocks = new Map<string, symbol>();

/**
 * Serializes `fn` against any other call in flight for the same `username`, cross-replica via
 * Valkey when enabled, falling back to an in-process mutex otherwise (LFXV2 #2241). Throws
 * `ConflictError` (409) immediately on contention rather than waiting/retrying — callers such as
 * `rejectIdentity` and `setMeetingInviteEmail` are user-initiated and safely retryable client-side.
 */
export async function withUserLock<T>(req: Request | undefined, username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  // Fail closed on an unsafe username before choosing a backend, so both paths reject it
  // identically rather than the in-memory fallback silently accepting what Valkey would refuse.
  // Unlike a cache key (buildUserCacheKey et al. return null → skip cache, still serve the
  // request), skipping the lock here would reopen the exact race this module exists to close —
  // matching `ValkeyService`'s existing fail-closed-adjacent posture for locks/sessions, not caches.
  // A username failing this check is a permanent condition, not contention — log it (never the raw
  // username) so it's diagnosable, even though `FILTER_SAFE_USERNAME` is broad enough to make this rare.
  if (!isFilterSafeUsername(username)) {
    logger.warning(req, 'with_user_lock', 'Refusing to lock: username fails the filter-safe check', { operation: 'with_user_lock' });
    throw new ConflictError('Unable to acquire a lock for this account', 'LOCK_UNAVAILABLE', { operation: 'with_user_lock' });
  }

  // Always take the in-memory mutex first, even on the Valkey-backed path: if Valkey flips from
  // available to unreachable mid-flight (a request already holds the Valkey lock when an outage
  // starts), a second same-replica request must still contend on *something* rather than finding
  // both the Valkey key acquirable-by-proxy-of-"unavailable" and an empty in-memory map. Valkey
  // then adds cross-replica coverage on top; it never replaces this per-replica guarantee.
  return withInMemoryLock(username, ttlMs, () => runWithValkeyLock(req, username, ttlMs, fn));
}

async function runWithValkeyLock<T>(req: Request | undefined, username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!valkeyService.isEnabled()) {
    return fn();
  }

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
  // `unavailable` — Valkey is enabled but unreachable right now. The in-memory mutex already
  // wrapping this call covers the current replica; just run fn() rather than blocking.
  logger.warning(req, 'with_user_lock', 'Valkey lock unavailable — degrading to a per-replica in-memory lock', {
    operation: 'with_user_lock',
  });
  return fn();
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
  }, ttlMs).unref();
  try {
    return await fn();
  } finally {
    clearTimeout(safetyNet);
    if (inMemoryLocks.get(username) === token) inMemoryLocks.delete(username);
  }
}
