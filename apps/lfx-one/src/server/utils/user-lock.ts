// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { ConflictError } from '../errors';
import { logger } from '../services/logger.service';
import { buildUserLockCacheKey, valkeyService } from '../services/valkey.service';

/**
 * Per-replica mutex, held around every call with a resolvable username (see `withUserLock`) so a
 * same-replica race is always caught even if Valkey flips from available to unreachable mid-flight.
 * An empty username skips this entirely (see `withUserLock`) rather than sharing one entry across
 * unrelated callers. When Valkey is enabled and reachable it adds cross-replica coverage on top;
 * when it isn't, this is the only protection in effect, for as long as that lasts.
 */
const inMemoryLocks = new Map<string, symbol>();

/**
 * Serializes `fn` against any other call in flight for the same `username`, cross-replica via
 * Valkey when enabled, falling back to an in-process mutex otherwise (LFXV2 #2241). Throws
 * `ConflictError` (409) immediately on contention rather than waiting/retrying — callers such as
 * `rejectIdentity` and `setMeetingInviteEmail` are user-initiated and safely retryable client-side.
 */
export async function withUserLock<T>(req: Request | undefined, username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!username) {
    // An empty username has no identity to lock, and — unlike a merely unsafe non-empty one —
    // every caller that can't resolve a username would otherwise share this single in-memory
    // entry, letting unrelated users contend with each other. There's nothing to protect here
    // (no other request can key on this same caller's identity either), so skip locking rather
    // than degrade to a shared, cross-user lock.
    logger.warning(req, 'with_user_lock', 'Empty username — skipping the lock entirely (nothing to protect)', {
      operation: 'with_user_lock',
    });
    return fn();
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
  if (key === null) {
    // An unsafe username has no injection surface in the in-memory Map key that already wraps this
    // call, so degrade the same way an unreachable Valkey does rather than failing the whole
    // request — losing only the cross-replica half of the guarantee, not all of it.
    logger.warning(req, 'with_user_lock', 'Username fails the filter-safe check — degrading to a per-replica in-memory lock', {
      operation: 'with_user_lock',
    });
    return fn();
  }

  const result = await valkeyService.acquireLock(key, ttlMs);
  if (result.status === 'contended') {
    throw lockContentionError();
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

/** Shared 409 for both the Valkey-contended and in-memory-contended branches below. */
function lockContentionError(): ConflictError {
  return new ConflictError('This account has a conflicting request in progress. Please try again.', 'LOCK_CONTENTION', {
    operation: 'with_user_lock',
  });
}

async function withInMemoryLock<T>(username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (inMemoryLocks.has(username)) {
    throw lockContentionError();
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
