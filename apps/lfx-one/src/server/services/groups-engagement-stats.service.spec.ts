// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getEffectiveUsernameMock, withUserCacheMock, cacheStore, fetcherCalls, execute, getMyCommitteeUids } = vi.hoisted(() => {
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
    execute: vi.fn(),
    getMyCommitteeUids: vi.fn(),
  };
});

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('./valkey.service', () => ({ withUserCache: withUserCacheMock }));
// Source the real VALKEY_CACHE values by importing the underlying file directly (not the
// `@lfx-one/shared/constants` barrel, which transitively pulls in Angular — see the import-rationale
// comment in date-time.utils.ts) so a namespace/TTL rename can't silently desync this mock from the
// value the test asserts against below. DEFAULT_LFX_ONE_PLATINUM_SCHEMA is included too since
// `committeeEngagementTable()` (real, unmocked helper) resolves against it.
vi.mock('@lfx-one/shared/constants', async () => {
  const { VALKEY_CACHE } = await import('../../../../../packages/shared/src/constants/valkey-cache.constants');
  return { VALKEY_CACHE, DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE' };
});
// The classifier functions are deep-imported from their real implementation (not hand-copied) so a
// decision-table change there fails this suite too — same rationale as
// committee-engagement.service.spec.ts, which exhaustively covers their boundary behavior.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/committee-engagement-classifier.utils')>(
    '../../../../../packages/shared/src/utils/committee-engagement-classifier.utils'
  );
  return {
    isCommitteeMemberActive: actual.isCommitteeMemberActive,
    isJoinedWithinWindow: actual.isJoinedWithinWindow,
  };
});
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getMyCommitteeUids = getMyCommitteeUids;
  },
}));
vi.mock('./snowflake.service', async () => {
  const { isMissingObjectError } = await vi.importActual<typeof import('../helpers/snowflake-error.helper')>('../helpers/snowflake-error.helper');
  return {
    SnowflakeService: {
      getInstance: () => ({ execute }),
      isMissingObjectError,
    },
  };
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

function activeMemberRow(overrides: { MEMBER_JOINED_AT?: string | null; MEMBER_VOTING_STATUS?: string; ATTENDED_COUNT_30D?: number } = {}) {
  return {
    MEMBER_JOINED_AT: '2020-01-01T00:00:00.000Z',
    MEMBER_VOTING_STATUS: 'Voting Rep',
    ATTENDED_COUNT_30D: 0,
    ...overrides,
  };
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
    getMyCommitteeUids.mockReset().mockResolvedValue(new Set());
    execute.mockReset();
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

    it('never touches Snowflake or the committee-uid lookup', async () => {
      await service.getEngagementStats(buildReq());
      expect(execute).not.toHaveBeenCalled();
      expect(getMyCommitteeUids).not.toHaveBeenCalled();
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

    it('does not serve a stale mock-sourced entry once the backend switches to live (production hard-block cannot be bypassed by a cache hit)', async () => {
      const mockResult = await service.getEngagementStats(buildReq());
      expect(mockResult.source).toBe('mock');
      expect(fetcherCalls.count).toBe(1);

      // Simulate the config correction the reviewer's scenario describes: ENGAGEMENT_BACKEND
      // stays 'mock' (or gets unset — either way), but NODE_ENV flips to production. Without the
      // backend-aware accept validator, this would return the still-cached `source: 'mock'` entry.
      process.env['NODE_ENV'] = 'production';
      getMyCommitteeUids.mockResolvedValue(new Set());

      const liveResult = await service.getEngagementStats(buildReq());

      expect(liveResult.source).toBe('live');
      expect(liveResult.active_members).toBe(0);
      expect(liveResult.meetings_this_month).toBeNull();
      expect(fetcherCalls.count).toBe(2);
    });
  });

  describe('live mode — active_members', () => {
    beforeEach(() => {
      process.env['ENGAGEMENT_BACKEND'] = 'live';
    });

    it('returns active_members: 0 (not null) and skips the Snowflake query when the caller has no visible committees', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set());

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
      expect(execute).not.toHaveBeenCalled();
    });

    it('meetings_this_month always stays null in live mode — no calendar-month data source exists yet', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.meetings_this_month).toBeNull();
      expect(typeof result.computed_at).toBe('string');
      expect(result.source).toBe('live');
    });

    it('queries with an IN-clause placeholder per visible committee, binds in the same order', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2', 'committee-3']));
      execute.mockResolvedValueOnce({ rows: [] });

      await service.getEngagementStats(buildReq());

      const [sql, binds, options] = execute.mock.calls[0] as [string, string[], unknown];
      expect((sql.match(/\?/g) ?? []).length).toBe(3);
      expect(binds).toEqual(['committee-1', 'committee-2', 'committee-3']);
      expect(options).toEqual({ expectMissingObject: true });
      expect(sql).toContain('ANALYTICS.PLATINUM_LFX_ONE.COMMITTEE_MEETING_ATTENDANCE');
    });

    it('counts a member with real attendance as active', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ ATTENDED_COUNT_30D: 3 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(1);
    });

    it('counts a zero-attendance member who joined within the trailing 30 days as active (tenure grace)', async () => {
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ ATTENDED_COUNT_30D: 0, MEMBER_JOINED_AT: recentJoin })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(1);
    });

    it('excludes an Emeritus member from active_members regardless of real attendance', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ ATTENDED_COUNT_30D: 10, MEMBER_VOTING_STATUS: 'Emeritus' })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it('does not count a veteran member with zero attendance and no tenure grace', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ ATTENDED_COUNT_30D: 0 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it('sums active members across multiple rows from multiple visible committees', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      execute.mockResolvedValueOnce({
        rows: [
          activeMemberRow({ ATTENDED_COUNT_30D: 1 }), // active
          activeMemberRow({ ATTENDED_COUNT_30D: 0 }), // not active
          activeMemberRow({ ATTENDED_COUNT_30D: 5 }), // active
        ],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(2);
    });

    it('degrades to active_members: null (not 0) when the Snowflake query hits a missing-object error', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(result.source).toBe('live');
    });

    it('degrades to active_members: null without throwing when fetching the visible committee set fails', async () => {
      getMyCommitteeUids.mockRejectedValue(new Error('query-service unavailable'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    });

    it('rethrows via degrade (not a thrown error) on an unexpected non-missing-object Snowflake error', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: connection reset'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
    });
  });

  describe('production hard-block', () => {
    it('ignores ENGAGEMENT_BACKEND=mock and computes live active_members (source=live) when NODE_ENV=production', async () => {
      process.env['ENGAGEMENT_BACKEND'] = 'mock';
      process.env['NODE_ENV'] = 'production';
      getMyCommitteeUids.mockResolvedValue(new Set());

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
      expect(result.meetings_this_month).toBeNull();
      expect(result.source).toBe('live');
    });
  });
});
