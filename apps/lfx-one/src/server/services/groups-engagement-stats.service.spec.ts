// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getEffectiveUsernameMock, withUserCacheMock, cacheStore } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    getEffectiveUsernameMock: vi.fn<() => string | null>(),
    // Simulates the real read-through cache well enough to test this service's cache-key plumbing
    // (same key → fetcher runs once) without depending on valkey.service's Redis-backed internals.
    withUserCacheMock: vi.fn(async (namespace: string, username: string, _ttlSeconds: number, fetcher: () => Promise<unknown>) => {
      const key = `${namespace}:${username}`;
      if (store.has(key)) return store.get(key);
      const value = await fetcher();
      store.set(key, value);
      return value;
    }),
    cacheStore: store,
  };
});

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('./valkey.service', () => ({ withUserCache: withUserCacheMock }));
vi.mock('@lfx-one/shared/constants', () => ({
  VALKEY_CACHE: { GROUPS_ENGAGEMENT_NAMESPACE: 'groups-engagement:v1', GROUPS_ENGAGEMENT_TTL_SECONDS: 60 },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { GroupsEngagementStatsService } from './groups-engagement-stats.service';

function buildReq(): Request {
  return {} as Request;
}

describe('GroupsEngagementStatsService', () => {
  let service: GroupsEngagementStatsService;
  const originalBackend = process.env['ENGAGEMENT_BACKEND'];

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    service = new GroupsEngagementStatsService();
    getEffectiveUsernameMock.mockReturnValue('alice');
    delete process.env['ENGAGEMENT_BACKEND'];
  });

  afterEach(() => {
    // Restore the ambient env var so this spec never leaks state to siblings run in the same process.
    if (originalBackend === undefined) {
      delete process.env['ENGAGEMENT_BACKEND'];
    } else {
      process.env['ENGAGEMENT_BACKEND'] = originalBackend;
    }
  });

  describe('mock mode (default)', () => {
    it('returns deterministic values for the same caller across separate calls', async () => {
      const first = await service.getEngagementStats(buildReq());
      cacheStore.clear(); // bypass the cache to prove determinism comes from the fixture, not the cache
      const second = await service.getEngagementStats(buildReq());

      expect(first.active_members).toEqual(second.active_members);
      expect(first.meetings_this_month).toEqual(second.meetings_this_month);
      expect(first.active_members).not.toBeNull();
      expect(first.meetings_this_month).not.toBeNull();
    });

    it('returns different values for different callers', async () => {
      getEffectiveUsernameMock.mockReturnValueOnce('alice');
      const alice = await service.getEngagementStats(buildReq());
      cacheStore.clear();
      getEffectiveUsernameMock.mockReturnValueOnce('bob');
      const bob = await service.getEngagementStats(buildReq());

      expect([alice.active_members, alice.meetings_this_month]).not.toEqual([bob.active_members, bob.meetings_this_month]);
    });

    it('always includes a computed_at timestamp', async () => {
      const result = await service.getEngagementStats(buildReq());
      expect(typeof result.computed_at).toBe('string');
      expect(Number.isNaN(Date.parse(result.computed_at))).toBe(false);
    });
  });

  describe('caching', () => {
    it('does not recompute on a cache hit for the same caller within the TTL', async () => {
      const computeSpy = vi.spyOn(service as unknown as { computeEngagementStats: (...args: unknown[]) => unknown }, 'computeEngagementStats' as never);

      await service.getEngagementStats(buildReq());
      await service.getEngagementStats(buildReq());

      expect(computeSpy).toHaveBeenCalledTimes(1);
    });

    it('recomputes for a different caller (distinct cache key)', async () => {
      const computeSpy = vi.spyOn(service as unknown as { computeEngagementStats: (...args: unknown[]) => unknown }, 'computeEngagementStats' as never);

      getEffectiveUsernameMock.mockReturnValueOnce('alice');
      await service.getEngagementStats(buildReq());
      getEffectiveUsernameMock.mockReturnValueOnce('bob');
      await service.getEngagementStats(buildReq());

      expect(computeSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('live mode', () => {
    it('returns null engagement fields without throwing, plus a computed_at timestamp', async () => {
      process.env['ENGAGEMENT_BACKEND'] = 'live';

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(typeof result.computed_at).toBe('string');
    });
  });
});
