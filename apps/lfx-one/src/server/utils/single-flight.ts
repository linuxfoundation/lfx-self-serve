// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isFilterSafeIdentifier, isFilterSafeUsername } from '@lfx-one/shared/utils';

/**
 * In-flight fetches by coalescing key. A `Map` rather than a `Record` because the keys are runtime
 * values (principal + org) and entries are inserted and deleted continuously.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Collapses concurrent identical fetches into one (GH-1906).
 *
 * This is NOT a cache. It holds a promise only while that promise is pending: nothing survives the
 * fetch completing, and nothing is shared across pods — each replica coalesces only its own
 * concurrent callers. What it removes is duplicate work that is in flight *right now*, which is
 * exactly the pressure the 30-second per-user Org Lens caches cannot relieve on a large org, where
 * producing the value takes longer than the entry's own lifetime.
 *
 * The entry is dropped when the promise settles either way, so a rejection is never retained and
 * the next caller starts a fresh fetch rather than replaying the failure.
 *
 * Why not `LockManager` (`utils/lock-manager.ts`), which deduplicates concurrent Snowflake queries
 * the same way: it logs its raw key as `query_hash` on every hit and miss, and the keys coalesced
 * here are `{namespace}:{username}:{orgUid}` — reusing it would write usernames to the logs. Its
 * stale-lock sweep is also sized from Snowflake query timeouts rather than these upstreams. The
 * per-principal fail-closed rule lives in {@link coalescePerUserOrgFetch}, not in this primitive.
 *
 * The factory receives `isCurrent`, true while this flight is still the one registered for `key`.
 * {@link evictPerUserOrgFetch} unregisters a flight, so a fill can check `isCurrent` before
 * persisting its result and skip writing a value that was superseded while it ran.
 */
export function singleFlight<T>(key: string, factory: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
  const joined = inFlight.get(key) as Promise<T> | undefined;
  if (joined) {
    return joined;
  }

  // The factory runs inside an async wrapper so a synchronous throw becomes a rejection of the
  // registered promise — otherwise it would escape before `finally` could clear the entry, wedging
  // the key on a promise no caller holds. Identity is compared everywhere rather than the key alone:
  // an evicted flight settling must neither report itself current nor remove its successor's entry.
  // Before the promise is assigned, `inFlight.get(key)` is also undefined, so a synchronous
  // `isCurrent()` inside the factory still answers true.
  const flight: { promise?: Promise<T> } = {};
  const isCurrent = (): boolean => inFlight.get(key) === flight.promise;
  const started = (async () => factory(isCurrent))().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  flight.promise = started;
  inFlight.set(key, started);
  return started;
}

/**
 * Coalesces a per-caller, per-org Org Lens fetch under the SAME effective principal its Valkey
 * cache key is built from, so a joined caller can only ever receive a roster filtered for its own
 * permissions.
 *
 * Fails closed exactly as `buildPerUserOrgKey` does: an empty or non-filter-safe username (or org
 * uid) means the fetch is run directly and NOT coalesced. Coalescing on a blank principal would
 * bucket every such caller onto one key and hand the first caller's permission-filtered result to
 * all of them — a cross-principal leak, and a far worse outcome than doing the work twice. Such a
 * fetch has no cache key either, so its `isCurrent` is always true.
 */
export function coalescePerUserOrgFetch<T>(namespace: string, username: string, orgUid: string, factory: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
  if (!isFilterSafeUsername(username) || !isFilterSafeIdentifier(orgUid)) {
    return factory(() => true);
  }
  return singleFlight(`${namespace}:${username}:${orgUid}`, factory);
}

/**
 * Unregisters the in-process flight for one (namespace, principal, org), after a write that makes
 * its result stale. A later read then starts a fresh fetch instead of joining the old one, and the
 * old flight's `isCurrent` turns false so its fill skips the cache write. Callers already joined to
 * the old flight still receive its result.
 */
export function evictPerUserOrgFetch(namespace: string, username: string, orgUid: string): void {
  inFlight.delete(`${namespace}:${username}:${orgUid}`);
}

/**
 * Drops every registered in-flight entry. Test-only: the map is module state, so without this a
 * suite that leaves a pending promise behind (a deliberately never-resolving factory, used to hold
 * a flight open while a second caller joins it) would leak that key into the next test.
 */
export function resetSingleFlightForTests(): void {
  inFlight.clear();
}
