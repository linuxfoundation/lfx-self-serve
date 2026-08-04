// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getEffectiveUsernameMock, withUserCacheMock, cacheStore, fetcherCalls, execute, getMyCommitteeUids, resolveCommitteeV2UidsToV1Ids } = vi.hoisted(() => {
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
    // Identity mapping by default (v2 uid -> itself) so the bulk of existing tests — written
    // before the v1/v2 translation existed — don't need every COMMITTEE_ID updated; tests
    // specifically covering the translation override this with a distinct mapping.
    resolveCommitteeV2UidsToV1Ids: vi.fn(async (_req: unknown, _nats: unknown, uids: string[]) => new Map(uids.map((uid) => [uid, uid]))),
  };
});

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('../helpers/committee-v1-mapping.helper', () => ({ resolveCommitteeV2UidsToV1Ids }));
vi.mock('./nats.service', () => ({ NatsService: class {} }));
vi.mock('./valkey.service', () => ({ withUserCache: withUserCacheMock }));
// Source the real VALKEY_CACHE/concurrency values by importing the underlying files directly (not
// the `@lfx-one/shared/constants` barrel, which transitively pulls in Angular — see the
// import-rationale comment in date-time.utils.ts) so a namespace/TTL/concurrency-cap rename can't
// silently desync this mock from the value the tests assert against below.
// DEFAULT_LFX_ONE_PLATINUM_SCHEMA is included too since `committeeEngagementTable()` (real,
// unmocked helper) resolves against it.
vi.mock('@lfx-one/shared/constants', async () => {
  const { VALKEY_CACHE } = await import('../../../../../packages/shared/src/constants/valkey-cache.constants');
  const { GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY } = await import('../../../../../packages/shared/src/constants/org-selector.constants');
  return { VALKEY_CACHE, GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY, DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE' };
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

// MEMBER_USER_ID and COMMITTEE_ID have no defaults — every call site must specify them, so a test
// that means to represent multiple distinct members/committees can't accidentally collide under the
// Set-based dedup/coverage checks by omission, and a test that means to represent the same member
// across committees does so explicitly. INVITED_COUNT_30D defaults high enough to never clamp
// ATTENDED_COUNT_30D in tests that aren't specifically exercising the clamp.
function activeMemberRow(overrides: {
  COMMITTEE_ID: string;
  MEMBER_USER_ID: string;
  MEMBER_JOINED_AT?: string | null;
  MEMBER_VOTING_STATUS?: string;
  INVITED_COUNT_30D?: number;
  ATTENDED_COUNT_30D?: number;
}) {
  return {
    MEMBER_JOINED_AT: '2020-01-01T00:00:00.000Z',
    MEMBER_VOTING_STATUS: 'Voting Rep',
    INVITED_COUNT_30D: 999,
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
    resolveCommitteeV2UidsToV1Ids
      .mockReset()
      .mockImplementation(async (_req: unknown, _nats: unknown, uids: string[]) => new Map(uids.map((uid) => [uid, uid])));
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

    it('fabricates full coverage (covered === total, both positive) so the mock path exercises the no-qualifier UI state', async () => {
      const result = await service.getEngagementStats(buildReq());
      expect(result.coverage.covered).toBe(result.coverage.total);
      expect(result.coverage.total).toBeGreaterThan(0);
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

    it('treats a pre-LFXV2-2978 cached entry with no `coverage` field as a miss and recomputes, rather than serving it stale for the TTL', async () => {
      await service.getEngagementStats(buildReq());
      expect(fetcherCalls.count).toBe(1);

      // Otherwise-valid shape from before `coverage` was added — simulates a cache entry written by
      // a pre-upgrade instance still sharing the same key immediately after deploy.
      cacheStore.set(`${VALKEY_CACHE.GROUPS_ENGAGEMENT_NAMESPACE}:alice`, {
        active_members: 5,
        meetings_this_month: 2,
        computed_at: new Date().toISOString(),
        source: 'mock',
      });

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
      expect(result.coverage).toEqual({ covered: 0, total: 0 });
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

    it('resolves visible v2 committee uids to their v1 ids and binds THOSE, not the raw v2 uids', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      resolveCommitteeV2UidsToV1Ids.mockResolvedValueOnce(new Map([['committee-1', 'v1-sfid-1']]));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'v1-sfid-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 1 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(resolveCommitteeV2UidsToV1Ids).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['committee-1']);
      const [, binds] = execute.mock.calls[0] as [string, string[]];
      expect(binds).toEqual(['v1-sfid-1']);
      expect(result.active_members).toBe(1);
    });

    it('returns null without querying Snowflake when no visible committee uid resolves to a v1 id', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      resolveCommitteeV2UidsToV1Ids.mockResolvedValueOnce(new Map());

      const result = await service.getEngagementStats(buildReq());

      expect(execute).not.toHaveBeenCalled();
      expect(result.active_members).toBeNull();
      expect(result.coverage).toEqual({ covered: 0, total: 2 });
    });

    it('no longer short-circuits on an unresolved committee uid — counts over the resolved/covered subset instead (LFXV2-2978)', async () => {
      // committee-1 resolves and is covered by a model row; committee-2 never resolves to a v1 id at
      // all. Under the old all-or-nothing rule this returned null without ever querying Snowflake.
      // Under partial coverage, the covered subset (committee-1) is still queried and counted, and
      // the unresolved committee-2 is reported as uncovered via `coverage`, not swallowed into null.
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      resolveCommitteeV2UidsToV1Ids.mockResolvedValueOnce(new Map([['committee-1', 'v1-sfid-1']]));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'v1-sfid-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 1 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(execute).toHaveBeenCalledTimes(1);
      const [, binds] = execute.mock.calls[0] as [string, string[]];
      expect(binds).toEqual(['v1-sfid-1']);
      expect(result.active_members).toBe(1);
      expect(result.coverage).toEqual({ covered: 1, total: 2 });
    });

    it('handles two visible v2 committees resolving to the SAME v1 id without under-counting coverage (duplicate-safe, not an inverted-map lookup)', async () => {
      // Regression test: an earlier implementation inverted v2ToV1Map into a v1->v2 map to check
      // coverage, which is lossy if two v2 uids ever map to the same v1 id (the second entry
      // silently overwrites the first). Coverage must be checked forward (per v2 uid via
      // v2ToV1Map.get), which stays correct regardless of whether the mapping is 1:1.
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      resolveCommitteeV2UidsToV1Ids.mockResolvedValueOnce(
        new Map([
          ['committee-1', 'shared-v1-sfid'],
          ['committee-2', 'shared-v1-sfid'],
        ])
      );
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'shared-v1-sfid', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 1 })] });

      const result = await service.getEngagementStats(buildReq());

      // Only one distinct v1 id is ever bound (deduped), but both v2 committees resolve to a
      // covered row, so this must NOT degrade to null.
      const [, binds] = execute.mock.calls[0] as [string, string[]];
      expect(binds).toEqual(['shared-v1-sfid']);
      expect(result.active_members).toBe(1);
    });

    it('counts a member with real attendance as active', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 3 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(1);
    });

    it('counts a zero-attendance member who joined within the trailing 30 days as active (tenure grace)', async () => {
      const recentJoin = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({
        rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 0, MEMBER_JOINED_AT: recentJoin })],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(1);
    });

    it('excludes an Emeritus member from active_members regardless of real attendance', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({
        rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 10, MEMBER_VOTING_STATUS: 'Emeritus' })],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it('does not count a veteran member with zero attendance and no tenure grace', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 0 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it('sums active members across multiple rows from multiple visible committees', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      execute.mockResolvedValueOnce({
        rows: [
          activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 1 }), // active
          activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm2', ATTENDED_COUNT_30D: 0 }), // not active
          activeMemberRow({ COMMITTEE_ID: 'committee-2', MEMBER_USER_ID: 'm3', ATTENDED_COUNT_30D: 5 }), // active
        ],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(2);
    });

    it('counts a member active on two visible committees once, not twice (dedupes by MEMBER_USER_ID, not row count)', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      execute.mockResolvedValueOnce({
        rows: [
          activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 4 }),
          activeMemberRow({ COMMITTEE_ID: 'committee-2', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 2 }), // same member, other committee's row
        ],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(1);
    });

    it('clamps attended to invited before classifying (defense-in-depth against a data-quality issue), matching committee-engagement.service.ts', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      // ATTENDED_COUNT_30D > INVITED_COUNT_30D should never happen per the model's own dbt
      // invariant, but if it did, an unclamped value here would still count the member as active —
      // clamping to invited makes attended 0 when invited is genuinely 0.
      execute.mockResolvedValueOnce({
        rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', INVITED_COUNT_30D: 0, ATTENDED_COUNT_30D: 5 })],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it("returns null (not 0) with zero coverage when the caller has visible committees but every chunk returns zero rows — mirrors the sibling endpoint's zero-row semantics", async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2']));
      execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.coverage).toEqual({ covered: 0, total: 2 });
    });

    it('counts over the covered subset when SOME visible committees are covered but at least one is not (partial coverage), rather than degrading to null (LFXV2-2978)', async () => {
      // Regression test for the OLD behavior this replaces: a caller with 3 visible committees where
      // only 2 were synced used to degrade the whole request to null, discarding an otherwise-good
      // count over the 2 covered committees. The product decision is now to count over the covered
      // subset and disclose coverage, not discard it.
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1', 'committee-2', 'committee-3']));
      execute.mockResolvedValueOnce({
        rows: [
          activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 5 }),
          activeMemberRow({ COMMITTEE_ID: 'committee-2', MEMBER_USER_ID: 'm2', ATTENDED_COUNT_30D: 5 }),
          // committee-3 has no rows at all — not yet synced.
        ],
      });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(2);
      expect(result.coverage).toEqual({ covered: 2, total: 3 });
    });

    it('returns a real 0 (not null) when rows are present for every visible committee but nobody in them is active', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'committee-1', MEMBER_USER_ID: 'm1', ATTENDED_COUNT_30D: 0 })] });

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBe(0);
    });

    it('caps chunk concurrency at 3 in-flight queries at a time, rather than firing every chunk at once', async () => {
      // 4 chunks (350 uids / 100) — enough to prove a concurrency cap without the test being about
      // the exact cap value. Each execute call returns a controllable, not-yet-resolved promise so
      // the test can observe how many are in flight before any resolve.
      const committeeUids = Array.from({ length: 350 }, (_, i) => `committee-${i}`);
      getMyCommitteeUids.mockResolvedValue(new Set(committeeUids));

      const deferreds: { resolve: (value: { rows: unknown[] }) => void }[] = [];
      execute.mockImplementation(
        () =>
          new Promise((resolve) => {
            deferreds.push({ resolve });
          })
      );

      const pending = service.getEngagementStats(buildReq());

      // Let the microtask queue drain so every synchronously-kickoffable call has started.
      await Promise.resolve();
      await Promise.resolve();
      expect(execute).toHaveBeenCalledTimes(3); // capped at GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY, not all 4 chunks

      deferreds.forEach((d) => d.resolve({ rows: [] }));
      await Promise.resolve();
      await Promise.resolve();
      expect(execute).toHaveBeenCalledTimes(4); // the 4th chunk starts only after the first batch settles

      deferreds.slice(3).forEach((d) => d.resolve({ rows: [] }));
      await pending;
    });

    it('chunks the committee-uid list at 100 per query and merges active members across chunks', async () => {
      const committeeUids = Array.from({ length: 150 }, (_, i) => `committee-${i}`);
      getMyCommitteeUids.mockResolvedValue(new Set(committeeUids));
      // Full coverage: one row per requested committee_id (so the coverage check passes), with
      // exactly the first committee in each chunk's bind list marked active — one per chunk, 2 total.
      execute.mockImplementation((_sql, binds) =>
        Promise.resolve({
          rows: (binds as string[]).map((id, i) =>
            activeMemberRow({ COMMITTEE_ID: id, MEMBER_USER_ID: `member-of-${id}`, ATTENDED_COUNT_30D: i === 0 ? 1 : 0 })
          ),
        })
      );

      const result = await service.getEngagementStats(buildReq());

      expect(execute).toHaveBeenCalledTimes(2);
      const [, firstBinds] = execute.mock.calls[0] as [string, string[]];
      const [, secondBinds] = execute.mock.calls[1] as [string, string[]];
      expect(firstBinds).toHaveLength(100);
      expect(secondBinds).toHaveLength(50);
      expect(result.active_members).toBe(2);
    });

    it('degrades the whole computation to null when one chunk fails, rather than returning an undercount', async () => {
      const committeeUids = Array.from({ length: 150 }, (_, i) => `committee-${i}`);
      getMyCommitteeUids.mockResolvedValue(new Set(committeeUids));
      execute
        .mockResolvedValueOnce({ rows: [activeMemberRow({ COMMITTEE_ID: 'committee-0', MEMBER_USER_ID: 'chunk1-member', ATTENDED_COUNT_30D: 1 })] })
        .mockRejectedValueOnce(new Error('Snowflake query execution failed: connection reset'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      // total reflects the visible-committee count established before the chunk failure (not 0) —
      // the caller's committee set was known even though the count itself couldn't be trusted.
      expect(result.coverage).toEqual({ covered: 0, total: 150 });
    });

    it('degrades to active_members: null (not 0) when the Snowflake query hits a missing-object error', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: Object does not exist or not authorized.'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(result.source).toBe('live');
      expect(result.coverage).toEqual({ covered: 0, total: 1 });
    });

    it('degrades to active_members: null without throwing when fetching the visible committee set fails', async () => {
      getMyCommitteeUids.mockRejectedValue(new Error('query-service unavailable'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.meetings_this_month).toBeNull();
      expect(execute).not.toHaveBeenCalled();
      // total is 0 here (not just covered) — the failure happened before the visible-committee
      // count was ever established, unlike the chunk-failure case above.
      expect(result.coverage).toEqual({ covered: 0, total: 0 });
    });

    it('rethrows via degrade (not a thrown error) on an unexpected non-missing-object Snowflake error', async () => {
      getMyCommitteeUids.mockResolvedValue(new Set(['committee-1']));
      execute.mockRejectedValueOnce(new Error('Snowflake query execution failed: connection reset'));

      const result = await service.getEngagementStats(buildReq());

      expect(result.active_members).toBeNull();
      expect(result.coverage).toEqual({ covered: 0, total: 1 });
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
