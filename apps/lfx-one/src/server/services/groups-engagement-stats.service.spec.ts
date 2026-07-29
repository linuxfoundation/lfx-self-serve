// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getEffectiveUsernameMock, withUserCacheMock, cacheStore, fetcherCalls } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const calls = { count: 0 };
  return {
    getEffectiveUsernameMock: vi.fn<() => string | null>(),
    // Simulates the real read-through cache well enough to test this service's cache-key plumbing
    // (same key → fetcher runs once, and a stored value must pass `accept`) without depending on
    // valkey.service's Redis-backed internals. Counts actual fetcher invocations (not just
    // withUserCache calls, which happen on every read) so cache-hit behavior is verified through the
    // public surface instead of spying on a private method.
    withUserCacheMock: vi.fn(
      async (namespace: string, username: string, _ttlSeconds: number, fetcher: () => Promise<unknown>, accept?: (value: unknown) => boolean) => {
        const key = `${namespace}:${username}`;
        if (store.has(key) && (!accept || accept(store.get(key)))) return store.get(key);
        calls.count += 1;
        const value = await fetcher();
        store.set(key, value);
        return value;
      }
    ),
    cacheStore: store,
    fetcherCalls: calls,
  };
});

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('./valkey.service', () => ({ withUserCache: withUserCacheMock }));
// Source the real VALKEY_CACHE values by importing the underlying file directly (not the
// `@lfx-one/shared/constants` barrel, which transitively pulls in Angular — see the import-rationale
// comment in date-time.utils.ts) so a namespace/TTL rename can't silently desync this mock from the
// value the test asserts against below.
vi.mock('@lfx-one/shared/constants', async () => {
  const { VALKEY_CACHE } = await import('../../../../../packages/shared/src/constants/valkey-cache.constants');
  return { VALKEY_CACHE };
});
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

import { VALKEY_CACHE } from '@lfx-one/shared/constants';

import { GroupsEngagementStatsService } from './groups-engagement-stats.service';

function buildReq(): Request {
  return {} as Request;
}

describe('GroupsEngagementStatsService', () => {
  let service: GroupsEngagementStatsService;
  const originalBackend = process.env['ENGAGEMENT_BACKEND'];
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    fetcherCalls.count = 0;
    service = new GroupsEngagementStatsService();
    getEffectiveUsernameMock.mockReturnValue('alice');
    // Fail-safe default: any environment that doesn't explicitly opt in gets 'live' (null fields),
    // never fabricated numbers — so tests must opt into 'mock' explicitly, matching production.
    process.env['ENGAGEMENT_BACKEND'] = 'mock';
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    // Restore the ambient env vars so this spec never leaks state to siblings run in the same process.
    const restore = (key: string, original: string | undefined): void => {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    };
    restore('ENGAGEMENT_BACKEND', originalBackend);
    restore('NODE_ENV', originalNodeEnv);
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

    it('marks the response source as mock', async () => {
      const result = await service.getEngagementStats(buildReq());
      expect(result.source).toBe('mock');
    });
  });

  describe('caching', () => {
    it('does not recompute on a cache hit for the same caller within the TTL', async () => {
      await service.getEngagementStats(buildReq());
      await service.getEngagementStats(buildReq());

      expect(fetcherCalls.count).toBe(1);
    });

    it('recomputes for a different caller (distinct cache key)', async () => {
      getEffectiveUsernameMock.mockReturnValueOnce('alice');
      await service.getEngagementStats(buildReq());
      getEffectiveUsernameMock.mockReturnValueOnce('bob');
      await service.getEngagementStats(buildReq());

      expect(fetcherCalls.count).toBe(2);
    });

    it('treats a malformed cached entry as a miss and recomputes (accept validator)', async () => {
      await service.getEngagementStats(buildReq());
      expect(fetcherCalls.count).toBe(1);

      // Corrupt the stored entry directly, bypassing the service — simulates a stale/incompatible
      // shape left behind by a prior schema version sharing the same cache key. Derives the key from
      // the real VALKEY_CACHE namespace (not a hardcoded duplicate) so a `:v1` → `:v2` bump can't
      // leave this assertion silently checking a key the service no longer writes to.
      cacheStore.set(`${VALKEY_CACHE.GROUPS_ENGAGEMENT_NAMESPACE}:alice`, { active_members: 'not-a-number' });

      await service.getEngagementStats(buildReq());
      expect(fetcherCalls.count).toBe(2);
    });

    it('still produces a valid response when getEffectiveUsername resolves to null', async () => {
      getEffectiveUsernameMock.mockReturnValue(null);

      const result = await service.getEngagementStats(buildReq());

      expect(typeof result.computed_at).toBe('string');
      expect(result.active_members).not.toBeNull();
    });
  });

  describe('live mode', () => {
    it('returns null engagement fields without throwing, plus a computed_at timestamp and source=live', async () => {
      process.env['ENGAGEMENT_BACKEND'] = 'live';

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(typeof result.computed_at).toBe('string');
      expect(result.source).toBe('live');
    });
  });

  describe('production hard-block', () => {
    it('ignores ENGAGEMENT_BACKEND=mock and returns null fields (source=live) when NODE_ENV=production', async () => {
      process.env['ENGAGEMENT_BACKEND'] = 'mock';
      process.env['NODE_ENV'] = 'production';

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(result.source).toBe('live');
    });
  });
});
