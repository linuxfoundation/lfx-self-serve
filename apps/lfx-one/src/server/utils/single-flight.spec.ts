// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/utils` barrel pulls Angular into this node-environment suite (same reason the
// service specs stub it). Only the two filter-safety predicates are needed here, so the mock
// re-exports the REAL module that defines them — the fail-closed rule must be pinned against the
// actual allowlists, not against a restatement of them.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('@lfx-one/shared/utils/org-selector.utils'));

import { coalescePerUserOrgFetch, resetSingleFlightForTests, singleFlight } from './single-flight';

const NAMESPACE = 'org-seats:v2';
const ORG = 'org-1';

/** A promise the test settles by hand, so a second caller can arrive while the first fetch is still pending. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  resetSingleFlightForTests();
});

describe('singleFlight', () => {
  // The reason this exists: on a large org the drain outlives the 30s cache entry it produces, so
  // every concurrent tab would otherwise run the whole thing again.
  it('runs the factory once for every caller that joins while it is in flight', async () => {
    const gate = deferred<string>();
    const factory = vi.fn(() => gate.promise);

    const joined = Promise.all([singleFlight('k', factory), singleFlight('k', factory), singleFlight('k', factory)]);
    gate.resolve('roster');

    expect(await joined).toEqual(['roster', 'roster', 'roster']);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  // It is not a cache: the key is released the moment the fetch settles, so the next caller gets a
  // fresh read rather than a value that has outlived the window its own cache entry was given.
  it('releases the key once the fetch settles', async () => {
    const factory = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect(await singleFlight('k', factory)).toBe('first');
    expect(await singleFlight('k', factory)).toBe('second');
  });

  // A failure must reach everyone who joined, and must not be retained — otherwise one upstream
  // blip would be replayed to callers arriving after it had already cleared.
  it('propagates a rejection to every joined caller, then retries on the next call', async () => {
    const failure = new Error('upstream down');
    const gate = deferred<string>();
    const factory = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce('recovered');

    const joined = Promise.allSettled([singleFlight('k', factory), singleFlight('k', factory)]);
    gate.reject(failure);

    expect(await joined).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(await singleFlight('k', factory)).toBe('recovered');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  // A factory that throws before it returns a promise must reject the registered entry, not escape
  // it — an escaped throw would leave the key pointing at a promise nobody can settle.
  it('does not wedge the key when the factory throws synchronously', async () => {
    const boom = (): Promise<never> => {
      throw new Error('sync boom');
    };

    await expect(singleFlight('k', boom)).rejects.toThrow('sync boom');
    expect(await singleFlight('k', async () => 'ok')).toBe('ok');
  });
});

describe('coalescePerUserOrgFetch', () => {
  // Both callers are the same principal reading the same org, so one permission-filtered fetch
  // serves both.
  it('shares one fetch between concurrent callers with the same principal and org', async () => {
    const factory = vi.fn().mockResolvedValueOnce('alice-roster').mockResolvedValueOnce('second-fetch');

    const results = await Promise.all([coalescePerUserOrgFetch(NAMESPACE, 'alice', ORG, factory), coalescePerUserOrgFetch(NAMESPACE, 'alice', ORG, factory)]);

    expect(results).toEqual(['alice-roster', 'alice-roster']);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  // Each principal sees a differently filtered roster, so these must never share a fetch — both
  // calls are made synchronously, so a shared key would be joined before either could settle.
  it('never coalesces two different usernames', async () => {
    const factory = vi.fn().mockResolvedValueOnce('alice-roster').mockResolvedValueOnce('bob-roster');

    const results = await Promise.all([coalescePerUserOrgFetch(NAMESPACE, 'alice', ORG, factory), coalescePerUserOrgFetch(NAMESPACE, 'bob', ORG, factory)]);

    expect(results).toEqual(['alice-roster', 'bob-roster']);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  // Two callers of the same principal on DIFFERENT orgs hold different rosters too.
  it('never coalesces two different orgs', async () => {
    const factory = vi.fn().mockResolvedValueOnce('org-1-roster').mockResolvedValueOnce('org-2-roster');

    const results = await Promise.all([
      coalescePerUserOrgFetch(NAMESPACE, 'alice', 'org-1', factory),
      coalescePerUserOrgFetch(NAMESPACE, 'alice', 'org-2', factory),
    ]);

    expect(results).toEqual(['org-1-roster', 'org-2-roster']);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  // The fail-closed rule, and the reason this helper exists rather than a bare `singleFlight` call
  // at each site: an identity the cache layer refuses to build a key from is not a bucket either.
  // Coalescing on a blank or unsafe principal would put unrelated callers in one bucket and hand
  // the first one's permission-filtered roster to all of them.
  it.each([
    ['an empty username', '', ORG],
    ['an unsafe username', 'not a safe name', ORG],
    ['an unsafe org uid', 'alice', 'org:1'],
  ])('never coalesces %s', async (_case, username, orgUid) => {
    const factory = vi.fn().mockResolvedValueOnce('first-callers-roster').mockResolvedValueOnce('second-callers-roster');

    const results = await Promise.all([
      coalescePerUserOrgFetch(NAMESPACE, username, orgUid, factory),
      coalescePerUserOrgFetch(NAMESPACE, username, orgUid, factory),
    ]);

    expect(results).toEqual(['first-callers-roster', 'second-callers-roster']);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
