// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { ConflictError } from '../errors';
import { logger } from '../services/logger.service';
import { buildMeetingInviteLockCacheKey, valkeyService } from '../services/valkey.service';

/**
 * Per-replica mutex, held around every call with a resolvable username (see `withMeetingInviteLock`)
 * so a same-replica race is always caught even if Valkey flips from available to unreachable
 * mid-flight. An empty username skips this entirely (see `withMeetingInviteLock`) rather than
 * sharing one entry across unrelated callers. When Valkey is enabled and reachable it adds
 * cross-replica coverage on top; when it isn't, this is the only protection in effect, for as long
 * as that lasts.
 *
 * Scoped to this one lock purpose (meeting-invite-email, LFXV2 #2241) — a different feature
 * needing a per-user lock should add its own namespaced map/key rather than reuse this one, since
 * this map is keyed on the bare username with no namespace segment of its own.
 */
const inMemoryLocks = new Map<string, symbol>();

/**
 * Serializes `fn` against any other meeting-invite-email call in flight for the same `username`,
 * cross-replica via Valkey when enabled, falling back to an in-process mutex otherwise
 * (LFXV2 #2241). Throws `ConflictError` (409) immediately on contention rather than
 * waiting/retrying — callers such as `rejectIdentity` and `setMeetingInviteEmail` are
 * user-initiated and safely retryable client-side.
 */
export async function withMeetingInviteLock<T>(req: Request | undefined, username: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (!username) {
    // An empty username has no identity to lock, and — unlike a merely unsafe non-empty one —
    // every caller that can't resolve a username would otherwise share this single in-memory
    // entry, letting unrelated users contend with each other. There's nothing to protect here
    // (no other request can key on this same caller's identity either), so skip locking rather
    // than degrade to a shared, cross-user lock.
    logger.warning(req, 'with_meeting_invite_lock', 'Empty username — skipping the lock entirely (nothing to protect)', {
      operation: 'with_meeting_invite_lock',
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

  const key = buildMeetingInviteLockCacheKey(username);
  if (key === null) {
    // An unsafe username has no injection surface in the in-memory Map key that already wraps this
    // call, so degrade the same way an unreachable Valkey does rather than failing the whole
    // request — losing only the cross-replica half of the guarantee, not all of it.
    logger.warning(req, 'with_meeting_invite_lock', 'Username fails the filter-safe check — degrading to a per-replica in-memory lock', {
      operation: 'with_meeting_invite_lock',
    });
    return fn();
  }

  const result = await valkeyService.acquireLock(key, ttlMs);
  if (result.status === 'contended') {
    throw lockContentionError();
  }
  if (result.status === 'unavailable') {
    // Valkey is enabled but unreachable right now. The in-memory mutex already wrapping this call
    // covers the current replica; just run fn() rather than blocking.
    logger.warning(req, 'with_meeting_invite_lock', 'Valkey lock unavailable — degrading to a per-replica in-memory lock', {
      operation: 'with_meeting_invite_lock',
    });
  }
  const token = result.token;
  if (!token) {
    return fn();
  }
  // `token` is set here for both `acquired` and an `unavailable` that may have still landed its SET
  // (see `acquireLock`) — in the latter case, its own immediate and delayed release retries already
  // ran; this is one more attempt after fn(), by which point the backend has had the longest
  // possible window to recover, so the key doesn't outlive its TTL unnecessarily and lock out this
  // user's own next request.
  try {
    return await fn();
  } finally {
    await valkeyService.releaseLock(key, token);
  }
}

/** Shared 409 for both the Valkey-contended and in-memory-contended branches below. */
function lockContentionError(): ConflictError {
  return new ConflictError('This account has a conflicting request in progress. Please try again.', 'LOCK_CONTENTION', {
    operation: 'with_meeting_invite_lock',
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
  const token = Symbol('meeting-invite-lock');
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
