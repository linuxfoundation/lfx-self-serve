// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationItem, FormationUser } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getUserInfoMock, withUserCacheMock, cacheStore, fetcherCalls } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const calls = { count: 0 };
  return {
    getUserInfoMock: vi.fn<(req: unknown, usernameOrEmail: string) => Promise<{ name: string; email: string; username: string }>>(),
    // Simulates the real read-through cache well enough to prove this helper's cache-key plumbing
    // (same username → fetcher runs once) without depending on valkey.service's Redis-backed
    // internals — mirrors groups-engagement-stats.service.spec.ts's withUserCacheMock.
    withUserCacheMock: vi.fn(
      async (namespace: string, username: string, _ttlSeconds: number, fetcher: () => Promise<unknown>, accept?: (value: unknown) => boolean) => {
        const key = `${namespace}:${username}`;
        if (cacheStore.has(key) && (!accept || accept(cacheStore.get(key)))) return cacheStore.get(key);
        fetcherCalls.count += 1;
        const value = await fetcher();
        cacheStore.set(key, value);
        return value;
      }
    ),
    cacheStore: store,
    fetcherCalls: calls,
  };
});

vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getUserInfo = getUserInfoMock;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/valkey.service', () => ({ withUserCache: withUserCacheMock }));
// Source the real VALKEY_CACHE by deep-importing (not the `@lfx-one/shared/constants` barrel, which
// transitively pulls in Angular-dependent modules) so a namespace/TTL rename can't silently desync
// this mock from the value the helper actually uses — mirrors groups-engagement-stats.service.spec.ts.
vi.mock('@lfx-one/shared/constants', async () => {
  const { VALKEY_CACHE } = await import('../../../../../packages/shared/src/constants/valkey-cache.constants');
  return { VALKEY_CACHE };
});
vi.mock('@lfx-one/shared/utils', () => ({ maskIdentifierForLogs: (identifier: string | null | undefined) => `masked:${identifier ?? ''}` }));

import { enrichFormationItemsWithOwnerIdentity } from './formation-owner-identity.helper';

const req = {} as unknown as Request;

function owner(username: string): FormationUser {
  return { username, name: username };
}

function item(overrides: Partial<FormationItem> = {}): Partial<FormationItem> & Pick<FormationItem, 'owner'> {
  return { owner: null, ...overrides };
}

describe('enrichFormationItemsWithOwnerIdentity', () => {
  beforeEach(() => {
    getUserInfoMock.mockReset();
    withUserCacheMock.mockClear();
    cacheStore.clear();
    fetcherCalls.count = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a zero-lookup no-op for items with no owner or an empty owner username', async () => {
    const items = [item({ owner: null }), item({ owner: { username: '', name: '' } })];

    const result = await enrichFormationItemsWithOwnerIdentity(req, items);

    expect(getUserInfoMock).not.toHaveBeenCalled();
    expect(result).toEqual(items);
  });

  it('dedupes items sharing the same owner username into a single getUserInfo call', async () => {
    getUserInfoMock.mockResolvedValue({ name: 'Formation Owner', email: 'formation-owner-test@example.com', username: 'alovelace' });
    const items = [item({ uid: 'item-1', owner: owner('alovelace') }), item({ uid: 'item-2', owner: owner('alovelace') })];

    const result = await enrichFormationItemsWithOwnerIdentity(req, items);

    expect(getUserInfoMock).toHaveBeenCalledTimes(1);
    expect(getUserInfoMock).toHaveBeenCalledWith(req, 'alovelace');
    expect(result[0].owner).toEqual({ username: 'alovelace', name: 'Formation Owner', email: 'formation-owner-test@example.com' });
    expect(result[1].owner).toEqual({ username: 'alovelace', name: 'Formation Owner', email: 'formation-owner-test@example.com' });
  });

  it.each([
    ['ResourceNotFoundError', new Error('User not found')],
    ['ServiceValidationError', new Error('User email could not be resolved from metadata')],
    ['an unexpected throw', 'not even an Error instance'],
  ])('degrades a single owner back to username-only on %s, without throwing', async (_label, rejection) => {
    getUserInfoMock.mockRejectedValue(rejection);
    const items = [item({ uid: 'item-1', owner: owner('ghopper') })];

    const result = await enrichFormationItemsWithOwnerIdentity(req, items);

    expect(result[0].owner).toEqual({ username: 'ghopper', name: 'ghopper' });
  });

  it('resolves one failing and one succeeding owner independently within the same batch', async () => {
    getUserInfoMock.mockImplementation(async (_req, username) => {
      if (username === 'broken-user') throw new Error('directory miss');
      return { name: 'Formation Owner', email: 'formation-owner-test@example.com', username };
    });
    const items = [item({ uid: 'item-1', owner: owner('broken-user') }), item({ uid: 'item-2', owner: owner('working-user') })];

    const result = await enrichFormationItemsWithOwnerIdentity(req, items);

    expect(result[0].owner).toEqual({ username: 'broken-user', name: 'broken-user' });
    expect(result[1].owner).toEqual({ username: 'working-user', name: 'Formation Owner', email: 'formation-owner-test@example.com' });
  });

  it('serves a second lookup for the same username from cache without re-calling getUserInfo', async () => {
    getUserInfoMock.mockResolvedValue({ name: 'Formation Owner', email: 'formation-owner-test@example.com', username: 'alovelace' });

    await enrichFormationItemsWithOwnerIdentity(req, [item({ uid: 'item-1', owner: owner('alovelace') })]);
    await enrichFormationItemsWithOwnerIdentity(req, [item({ uid: 'item-2', owner: owner('alovelace') })]);

    expect(fetcherCalls.count).toBe(1);
    expect(getUserInfoMock).toHaveBeenCalledTimes(1);
  });
});
