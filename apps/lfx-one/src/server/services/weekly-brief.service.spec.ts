// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts / committee.controller.spec.ts: the `@lfx-one/shared/*`
// alias isn't wired into this app's vitest config, so runtime collaborators need mocking —
// including `constants`, since this service spreads WEEKLY_BRIEF_DEFAULT_THROTTLE at runtime
// (not just a type import). MOCK_THROTTLE is shared between the mock factory and the test
// assertions below so the two can't drift from each other. (Deliberately not cross-checked
// against the real constants module here — `vi.importActual` on a real, unmocked
// `@lfx-one/shared/*` import re-triggers the Angular JIT-compilation failure this file's
// mocks exist to avoid, and it contaminates other spec files sharing the test worker.)
// A real Map-backed fake (not just call-arg assertions) so the rating tests below prove actual
// upsert/clear round-trip behavior through the public API, not just "was called with X". Shared
// by the action-items tests too — `weekly-brief.service.ts`'s rating and action-items code paths
// both call the same `valkeyService` singleton import, so both must observe the same mock object.
const {
  proxyRequest,
  proxyRequestWithResponse,
  MOCK_THROTTLE,
  valkeyStore,
  valkeyServiceMock,
  buildWeeklyBriefRatingCacheKeyMock,
  extractBriefActionItems,
  buildCacheKey,
} = vi.hoisted(() => {
  const valkeyStore = new Map<string, unknown>();
  const valkeyServiceMock = {
    isEnabled: vi.fn(() => true),
    // Honors the `accept` shape guard like the real ValkeyService.getJson does — a stored value
    // that fails the guard degrades to a miss (null), not a pass-through. Without this, a corrupt/
    // legacy rating entry would surface verbatim instead of exercising the "degrade to a miss"
    // path `isStoredRating` exists for.
    getJson: vi.fn(async (key: string, accept?: (value: unknown) => boolean) => {
      if (!valkeyStore.has(key)) return null;
      const value = valkeyStore.get(key);
      return accept && !accept(value) ? null : value;
    }),
    setJson: vi.fn(async (key: string, value: unknown) => {
      valkeyStore.set(key, value);
      return true;
    }),
    // Matches the real ValkeyService.del contract (valkey.service.ts): returns `true` for any
    // non-throwing delete, regardless of whether the key existed — a DEL of an already-expired/
    // absent key is still a success, not a fault. `mockResolvedValueOnce(false)` is how tests
    // inject a genuine fault.
    del: vi.fn(async (key: string) => {
      valkeyStore.delete(key);
      return true;
    }),
  };
  return {
    proxyRequest: vi.fn(),
    proxyRequestWithResponse: vi.fn(),
    MOCK_THROTTLE: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3 },
    valkeyStore,
    valkeyServiceMock,
    // 'unsafe' is a sentinel this spec uses to exercise the fail-closed null-key branch —
    // mirrors session-store.service.spec.ts's 'unsafe' → null convention.
    buildWeeklyBriefRatingCacheKeyMock: vi.fn((committeeUid: string, briefUid: string, revision: number, username: string) =>
      username === 'unsafe' ? null : `${committeeUid}:${briefUid}:${revision}:${username}`
    ),
    extractBriefActionItems: vi.fn(),
    buildCacheKey: vi.fn(
      (committeeId: string, briefUid: string, revision: number): string | null => `weekly-brief-action-items:${committeeId}:${briefUid}:${revision}`
    ),
  };
});

vi.mock('@lfx-one/shared/constants', () => ({
  WEEKLY_BRIEF_DEFAULT_THROTTLE: MOCK_THROTTLE,
  WEEKLY_BRIEF_SHAREABLE_STATES: ['generated', 'edited', 'approved'],
  WEEKLY_BRIEF_ERROR_REASON: { NO_SOURCES: 'no_sources' },
  WEEKLY_BRIEF_ACTION_ITEMS_MAX: 5,
  NEWSLETTER_SUBJECT_MAX_LENGTH: 200,
  NEWSLETTER_BODY_MAX_LENGTH: 100_000,
  AI_MODEL: 'mock-ai-model',
  VALKEY_CACHE: { WEEKLY_BRIEF_RATING_TTL_SECONDS: 7_776_000, WEEKLY_BRIEF_ACTION_ITEMS_TTL_SECONDS: 604800 },
}));
// '../constants' (this app's server-only constants, not the `@lfx-one/shared` package) is
// plain string/number literals with no transitive Angular imports — safe to leave unmocked,
// unlike the shared-package mocks above.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// `formatUtcDateRangeLabel` lives in the same `@lfx-one/shared/utils` barrel as
// form.utils.ts, which imports `@angular/forms` — an unmocked import here would pull
// in the real barrel and hit the same JIT-compilation failure the mocks above avoid.
vi.mock('@lfx-one/shared/utils', () => ({ formatUtcDateRangeLabel: vi.fn(() => 'Jan 1 – Jan 7, 2026') }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));
// shareBrief's collaborators — not exercised by this spec (no shareBrief tests here),
// but WeeklyBriefService's constructor instantiates all three, so they must at least
// be constructible without pulling in their own real import chains.
vi.mock('./committee.service', () => ({ CommitteeService: class {} }));
vi.mock('./newsletter.service', () => ({ NewsletterService: class {} }));
vi.mock('./access-check.service', () => ({ AccessCheckService: class {} }));
// getActionItems' (LFXV2-3043) collaborator — controlled per-test below.
vi.mock('./ai.service', () => ({
  AiService: class {
    public extractBriefActionItems = extractBriefActionItems;
  },
}));
// Single mock for both weekly-brief.service.ts collaborators that live in valkey.service —
// rating (LFXV2-3042) and action-items (LFXV2-3043) both call the same `valkeyService`
// singleton import, so they must share one mock object rather than each getting its own.
vi.mock('./valkey.service', () => ({
  buildWeeklyBriefRatingCacheKey: buildWeeklyBriefRatingCacheKeyMock,
  buildWeeklyBriefActionItemsCacheKey: buildCacheKey,
  valkeyService: valkeyServiceMock,
}));

import type { Request } from 'express';

import { WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID } from '../constants';
import { MicroserviceError } from '../errors';

import { logger } from './logger.service';
import { __resetMockBriefStateForTesting, briefWindow, WeeklyBriefService } from './weekly-brief.service';

const req = {} as unknown as Request;
const userReq = { oidc: { user: { nickname: 'alice', sub: 'auth0|alice-sub' } } } as unknown as Request;

describe('briefWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects the previous, completed week on a weekday (Wednesday)', () => {
    // 2026-01-14 is a Wednesday (UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'));

    const { window_start, window_end } = briefWindow();

    expect(window_start).toBe('2026-01-04T00:00:00.000Z'); // previous Sunday
    expect(window_end).toBe('2026-01-10T23:59:59.999Z'); // previous Saturday
  });

  it('selects the current (not-yet-completed) week on a Saturday', () => {
    // 2026-01-17 is a Saturday (UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-17T12:00:00.000Z'));

    const { window_start, window_end } = briefWindow();

    expect(window_start).toBe('2026-01-11T00:00:00.000Z'); // this week's Sunday
    expect(window_end).toBe('2026-01-17T23:59:59.999Z'); // today
  });
});

describe('WeeklyBriefService', () => {
  let service: WeeklyBriefService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Resets call history, drains any leftover `mockResolvedValueOnce` queue, and restores every
    // vi.fn() in the file to its originally-given implementation (including the `logger` spies,
    // `valkeyServiceMock`, `buildCacheKey`, and `isEnabled`'s default `true`) — without this, a
    // `logger.warning`/`.info` assertion in a later test can pass vacuously against a call an
    // *earlier* test already recorded, or inherit a leftover one-time override a prior test
    // queued but never consumed. `vi.clearAllMocks()` alone resets call history but leaves both
    // of those hazards open — verified empirically against this repo's Vitest version.
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    service = new WeeklyBriefService();
    __resetMockBriefStateForTesting();
    valkeyStore.clear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('mock mode (WEEKLY_BRIEF_BACKEND unset)', () => {
    beforeEach(() => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      delete process.env['NODE_ENV'];
    });

    it('getCurrentBrief returns a canned brief without calling upstream', async () => {
      const result = await service.getCurrentBrief(req, 'committee-1');
      expect(result.brief).not.toBeNull();
      expect(result.brief?.committee_uid).toBe('committee-1');
      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('generateBrief (fresh, no force) returns 202/generating and does not claim the quota is exhausted', async () => {
      const { status, data } = await service.generateBrief(req, 'committee-1', {});
      expect(status).toBe(202);
      expect(data.brief?.state).toBe('generating');
      expect(data.brief?.regeneration_count).toBe(0);
      expect(data.throttle?.generates_used).toBe(1);
      expect(data.throttle?.regenerations_used).toBe(0);
      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('generateBrief (force: true) reports a regeneration, not a second fresh generate', async () => {
      const { data } = await service.generateBrief(req, 'committee-1', { force: true });
      expect(data.brief?.regeneration_count).toBe(1);
      expect(data.throttle?.generates_used).toBe(1);
      expect(data.throttle?.regenerations_used).toBe(1);
    });

    it('generateBrief (force: true) bumps the revision, and a subsequent getCurrentBrief reflects it (Cursor Bugbot: mock regenerate poll never completed)', async () => {
      const before = await service.getCurrentBrief(req, 'committee-1');
      const { data } = await service.generateBrief(req, 'committee-1', { force: true });
      const after = await service.getCurrentBrief(req, 'committee-1');

      expect(data.brief?.revision).toBe((before.brief?.revision ?? 1) + 1);
      // The poll's isNewTerminal guard needs this GET's revision to differ from the
      // pre-regenerate read's — without the fix, this would still equal `before`'s revision.
      expect(after.brief?.revision).not.toBe(before.brief?.revision);
      expect(after.brief?.revision).toBe(data.brief?.revision);
    });

    it('a second regenerate bumps the revision again rather than resetting to a fixed value', async () => {
      await service.generateBrief(req, 'committee-1', { force: true });
      const firstRevision = (await service.getCurrentBrief(req, 'committee-1')).brief?.revision;

      await service.generateBrief(req, 'committee-1', { force: true });
      const secondRevision = (await service.getCurrentBrief(req, 'committee-1')).brief?.revision;

      expect(secondRevision).toBe((firstRevision ?? 0) + 1);
    });

    it('generateBrief (fresh, no force) does not bump the revision', async () => {
      const before = await service.getCurrentBrief(req, 'committee-1');
      await service.generateBrief(req, 'committee-1', {});
      const after = await service.getCurrentBrief(req, 'committee-1');

      expect(after.brief?.revision).toBe(before.brief?.revision);
    });

    it('saveBrief bumps the revision and marks the brief edited', async () => {
      const result = await service.saveBrief(req, 'committee-1', { brief_text: 'updated text', revision: 1 });
      expect(result.state).toBe('edited');
      expect(result.brief_text).toBe('updated text');
      expect(result.revision).toBe(2);
    });

    it('saveBrief keeps a subsequent getCurrentBrief in sync with the saved revision', async () => {
      await service.saveBrief(req, 'committee-1', { brief_text: 'updated text', revision: 1 });
      const after = await service.getCurrentBrief(req, 'committee-1');

      expect(after.brief?.revision).toBe(2);
    });

    it('saveBrief persists the saved brief_text — a subsequent getCurrentBrief does not revert to the canned default (Copilot review)', async () => {
      await service.saveBrief(req, 'committee-1', { brief_text: 'my custom edited text', revision: 1 });
      const after = await service.getCurrentBrief(req, 'committee-1');

      expect(after.brief?.brief_text).toBe('my custom edited text');
      expect(after.brief?.state).toBe('edited');
    });

    it('saveBrief rejects a stale revision with a 409 instead of silently accepting it (CodeRabbit review)', async () => {
      // Advance the tracked revision to 2 via a regenerate, then attempt a save still holding
      // the pre-regenerate revision (1).
      await service.generateBrief(req, 'committee-1', { force: true });

      try {
        await service.saveBrief(req, 'committee-1', { brief_text: 'stale write', revision: 1 });
        expect.fail('expected saveBrief to throw on a stale revision');
      } catch (error) {
        expect(error).toBeInstanceOf(MicroserviceError);
        const wrapped = error as MicroserviceError;
        expect(wrapped.statusCode).toBe(409);
        expect(wrapped.code).toBe('REVISION_CONFLICT');
      }

      // The rejected save must not have mutated the tracked state.
      const after = await service.getCurrentBrief(req, 'committee-1');
      expect(after.brief?.brief_text).not.toBe('stale write');
    });

    it('generateBrief (force: true) persists regeneration_count — a subsequent getCurrentBrief does not reset it to 0 (Copilot review)', async () => {
      await service.generateBrief(req, 'committee-1', { force: true });
      const after = await service.getCurrentBrief(req, 'committee-1');

      expect(after.brief?.regeneration_count).toBe(1);
      expect(after.throttle?.regenerations_used).toBe(1);
    });

    it('getCurrentBrief returns a deterministic quiet-week (no_sources) error brief for the designated sentinel committee uid (LFXV2-3000)', async () => {
      const result = await service.getCurrentBrief(req, WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID);
      expect(result.brief?.state).toBe('error');
      expect(result.brief?.error_reason).toBe('no_sources');
    });

    it('refuses to serve mock data when NODE_ENV=production (LFXV2-2175 review: no auth in mock mode)', async () => {
      process.env['NODE_ENV'] = 'production';
      await expect(service.getCurrentBrief(req, 'committee-1')).rejects.toThrow(/temporarily unavailable/);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('does not leak the WEEKLY_BRIEF_BACKEND env var name into the client-facing error message', async () => {
      process.env['NODE_ENV'] = 'production';
      try {
        await service.getCurrentBrief(req, 'committee-1');
        expect.fail('expected getCurrentBrief to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(MicroserviceError);
        expect((error as MicroserviceError).message).not.toMatch(/WEEKLY_BRIEF_BACKEND/);
      }
    });
  });

  describe('getActionItems (LFXV2-3043)', () => {
    beforeEach(() => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      delete process.env['NODE_ENV'];
    });

    it('caches extraction per revision — a second call for the same revision does not re-invoke AiService (cache hit)', async () => {
      extractBriefActionItems.mockResolvedValue({ items: [{ text: 'Onboard the new member' }] });

      const first = await service.getActionItems(req, 'committee-1');
      expect(extractBriefActionItems).toHaveBeenCalledTimes(1);
      expect(first.items).toHaveLength(1);

      // Simulate the cache now holding what setJson was just called with.
      const [, cachedValue] = valkeyServiceMock.setJson.mock.calls[0];
      valkeyServiceMock.getJson.mockResolvedValueOnce(cachedValue);

      const second = await service.getActionItems(req, 'committee-1');
      expect(extractBriefActionItems).toHaveBeenCalledTimes(1); // still 1 — no re-extraction
      expect(second.items).toEqual(first.items);
    });

    it('a new revision (regeneration) re-invokes AiService and returns new items', async () => {
      extractBriefActionItems.mockResolvedValueOnce({ items: [{ text: 'Revision 1 item' }] });
      const before = await service.getActionItems(req, 'committee-1');
      expect(before.items[0].text).toBe('Revision 1 item');

      await service.saveBrief(req, 'committee-1', { brief_text: 'edited text', revision: 1 }); // bumps revision 1 -> 2

      extractBriefActionItems.mockResolvedValueOnce({ items: [{ text: 'Revision 2 item' }] });
      const after = await service.getActionItems(req, 'committee-1');

      expect(extractBriefActionItems).toHaveBeenCalledTimes(2);
      expect(after.items[0].text).toBe('Revision 2 item');
    });

    it('an empty extraction is cached and returned as {items: []} — not an error', async () => {
      extractBriefActionItems.mockResolvedValue({ items: [] });

      const result = await service.getActionItems(req, 'committee-1');

      expect(result).toEqual({ items: [] });
      expect(valkeyServiceMock.setJson).toHaveBeenCalledWith(expect.any(String), [], 604800);
    });

    it('degrades to {items: []} when AiService throws, logging via warning (with err), not error — and does NOT cache the failure', async () => {
      extractBriefActionItems.mockRejectedValue(new Error('AI service not configured'));

      const result = await service.getActionItems(req, 'committee-1');

      expect(result).toEqual({ items: [] });
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'get_weekly_brief_action_items',
        expect.any(String),
        expect.objectContaining({ err: expect.any(Error) })
      );
      expect(logger.error).not.toHaveBeenCalled();
      // A transient failure must not be cached as if it were a legitimate empty extraction —
      // that would pin this brief revision to zero items for the full TTL.
      expect(valkeyServiceMock.setJson).not.toHaveBeenCalled();
    });

    it('returns {items: []} without calling AiService when the brief is not in a shareable (terminal readable) state', async () => {
      const result = await service.getActionItems(req, WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID);

      expect(result).toEqual({ items: [] });
      expect(extractBriefActionItems).not.toHaveBeenCalled();
      expect(buildCacheKey).not.toHaveBeenCalled();
    });

    it('skips extraction and returns {items: []} when the cache key is null (fail-closed on an unsafe brief uid), logging a warning', async () => {
      buildCacheKey.mockReturnValueOnce(null);

      const result = await service.getActionItems(req, 'committee-1');

      expect(result).toEqual({ items: [] });
      expect(valkeyServiceMock.getJson).not.toHaveBeenCalled();
      expect(extractBriefActionItems).not.toHaveBeenCalled();
      expect(valkeyServiceMock.setJson).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'get_weekly_brief_action_items',
        expect.any(String),
        expect.objectContaining({ committee_id: 'committee-1' })
      );
    });

    it('truncates an extraction with more than WEEKLY_BRIEF_ACTION_ITEMS_MAX items to the cap', async () => {
      extractBriefActionItems.mockResolvedValue({ items: Array.from({ length: 8 }, (_, i) => ({ text: `Item ${i}` })) });

      const result = await service.getActionItems(req, 'committee-1');

      expect(result.items).toHaveLength(5);
    });

    it('skips extraction and returns {items: []} when Valkey is disabled, without ever building a cache key', async () => {
      valkeyServiceMock.isEnabled.mockReturnValue(false);

      const result = await service.getActionItems(req, 'committee-1');

      expect(result).toEqual({ items: [] });
      expect(buildCacheKey).not.toHaveBeenCalled();
      expect(valkeyServiceMock.getJson).not.toHaveBeenCalled();
      expect(extractBriefActionItems).not.toHaveBeenCalled();
      // DEBUG, not WARN — an unconfigured cache is a steady-state condition in some
      // environments, not a per-request anomaly worth alerting on every page view.
      expect(logger.debug).toHaveBeenCalledWith(
        req,
        'get_weekly_brief_action_items',
        expect.any(String),
        expect.objectContaining({ committee_id: 'committee-1' })
      );
    });

    it('returns {items: []} without calling AiService when brief_text is empty/whitespace-only', async () => {
      await service.saveBrief(req, 'committee-1', { brief_text: 'x', revision: 1 }); // establish a tracked brief first
      // Directly exercise the guard via a second save with whitespace-only text — mock-mode saveBrief
      // doesn't itself validate brief_text (that's the controller's job), so this reaches the service.
      await service.saveBrief(req, 'committee-1', { brief_text: '   ', revision: 2 });

      const result = await service.getActionItems(req, 'committee-1');

      expect(result).toEqual({ items: [] });
      expect(extractBriefActionItems).not.toHaveBeenCalled();
    });

    it('scopes the cache key to the committee, not just the brief uid and revision (mock brief fixture reuses the same uid across committees)', async () => {
      extractBriefActionItems.mockResolvedValue({ items: [{ text: 'Item' }] });

      await service.getActionItems(req, 'committee-1');

      expect(buildCacheKey).toHaveBeenCalledWith('committee-1', expect.any(String), expect.any(Number));
    });

    it('scopes each item uid to the committee too, not just the cache key (PR #1362 review — Copilot: the mock fixture shares one brief uid across committees, so an unscoped item uid would collide the dismiss-cookie identity across committees)', async () => {
      extractBriefActionItems.mockResolvedValue({ items: [{ text: 'Item' }] });

      const result = await service.getActionItems(req, 'committee-1');

      expect(result.items[0].uid.startsWith('committee-1-')).toBe(true);
    });

    it('warns (but still returns the freshly-extracted items) when the cache write fails — isEnabled() only reflects configuration, not reachability', async () => {
      extractBriefActionItems.mockResolvedValue({ items: [{ text: 'Item' }] });
      valkeyServiceMock.setJson.mockResolvedValue(false); // e.g. Valkey configured but currently unreachable

      const result = await service.getActionItems(req, 'committee-1');

      expect(result.items).toHaveLength(1);
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'get_weekly_brief_action_items',
        expect.stringContaining('could not be cached'),
        expect.objectContaining({ committee_id: 'committee-1' })
      );
    });
  });

  describe('live mode (WEEKLY_BRIEF_BACKEND=live)', () => {
    beforeEach(() => {
      process.env['WEEKLY_BRIEF_BACKEND'] = 'live';
    });

    it('getCurrentBrief proxies straight through and does not swallow a 404', async () => {
      const upstreamResult = {
        brief: null,
        throttle: null,
      };
      proxyRequest.mockResolvedValueOnce(upstreamResult);

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result).toBe(upstreamResult);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/current', 'GET');
    });

    it('getCurrentBrief forwards a real upstream error_reason to the client unchanged (LFXV2-3000)', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'error', error_reason: 'no_sources' }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBe('no_sources');
    });

    it('getCurrentBrief propagates a 404 as a real error instead of normalizing it to an empty brief', async () => {
      const notFound = Object.assign(new Error('not found'), { statusCode: 404 });
      proxyRequest.mockRejectedValueOnce(notFound);

      await expect(service.getCurrentBrief(req, 'committee-1')).rejects.toBe(notFound);
    });

    it('generateBrief forwards the real upstream status code (202 accepted)', async () => {
      const data = { brief: { uid: 'b1', state: 'generating' }, throttle: {} };
      proxyRequestWithResponse.mockResolvedValueOnce({ status: 202, data, statusText: 'Accepted', headers: {} });

      const result = await service.generateBrief(req, 'committee-1', { force: true });

      expect(result.status).toBe(202);
      expect(result.data).toBe(data);
      expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/generate', 'POST', undefined, {
        force: true,
      });
    });

    it('generateBrief forwards the upstream 429 throttle body instead of dropping it', async () => {
      const upstreamBody = {
        code: 'throttle_exceeded',
        generates_used: 2,
        generates_limit: 2,
        regenerations_used: 3,
        regenerations_limit: 3,
        window_resets_at: '2026-01-04T00:00:00Z',
      };
      const upstreamError = new MicroserviceError('Too Many Requests', 429, 'THROTTLE_EXCEEDED', { errorBody: upstreamBody });
      proxyRequestWithResponse.mockRejectedValueOnce(upstreamError);

      try {
        await service.generateBrief(req, 'committee-1', {});
        expect.fail('expected generateBrief to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(MicroserviceError);
        const wrapped = error as MicroserviceError;
        expect(wrapped.statusCode).toBe(429);
        expect(wrapped.errorBody.details).toEqual(upstreamBody);
      }
    });

    it('generateBrief forwards the upstream 409 conflict body (revision) instead of dropping it', async () => {
      const upstreamBody = { code: 'edited_brief_exists', revision: 4 };
      const upstreamError = new MicroserviceError('Conflict', 409, 'EDITED_BRIEF_EXISTS', { errorBody: upstreamBody });
      proxyRequestWithResponse.mockRejectedValueOnce(upstreamError);

      try {
        await service.generateBrief(req, 'committee-1', {});
        expect.fail('expected generateBrief to throw');
      } catch (error) {
        expect((error as MicroserviceError).errorBody.details).toEqual(upstreamBody);
      }
    });

    it('saveBrief proxies straight through with the real revision round-tripped', async () => {
      const upstreamResult = { uid: 'b1', revision: 2, state: 'edited', brief_text: 'updated' };
      proxyRequest.mockResolvedValueOnce(upstreamResult);

      const result = await service.saveBrief(req, 'committee-1', { brief_text: 'updated', revision: 1 });

      expect(result).toBe(upstreamResult);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/current', 'PUT', undefined, {
        brief_text: 'updated',
        revision: 1,
      });
    });

    it('saveBrief forwards the upstream 409 conflict body instead of dropping it', async () => {
      const upstreamBody = { code: 'revision_conflict', revision: 5 };
      const upstreamError = new MicroserviceError('Conflict', 409, 'REVISION_CONFLICT', { errorBody: upstreamBody });
      proxyRequest.mockRejectedValueOnce(upstreamError);

      try {
        await service.saveBrief(req, 'committee-1', { brief_text: 'x', revision: 1 });
        expect.fail('expected saveBrief to throw');
      } catch (error) {
        expect((error as MicroserviceError).errorBody.details).toEqual(upstreamBody);
      }
    });

    it('URL-encodes the committeeId path segment', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: null, throttle: null });
      await service.getCurrentBrief(req, 'a/b c');
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/a%2Fb%20c/weekly-briefs/current', 'GET');
    });
  });

  describe('weekly-brief rating (LFXV2-3042)', () => {
    beforeEach(() => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      delete process.env['NODE_ENV'];
    });

    it('rate → re-rate (switch) → clear round-trips through getCurrentBrief().caller_rating', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const briefUid = initial.brief!.uid;

      await service.rateBrief(userReq, 'committee-1', briefUid, 'up', 1);
      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBe('up');

      await service.rateBrief(userReq, 'committee-1', briefUid, 'down', 1);
      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBe('down');

      await service.clearBriefRating(userReq, 'committee-1', briefUid, 1);
      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBeNull();
    });

    it('two different committees never collide on the same cache key, even when mock mode gives them the same brief uid and starting revision (PR #1361 review)', async () => {
      // buildMockBrief hard-codes the same uid ('wb_mock_...') and starts every committee at
      // revision 1 — without committee_uid in the cache key, rating committee-a would pre-light
      // committee-b's identical thumbs.
      const briefA = (await service.getCurrentBrief(userReq, 'committee-a')).brief!;
      const briefB = (await service.getCurrentBrief(userReq, 'committee-b')).brief!;
      expect(briefA.uid).toBe(briefB.uid);
      expect(briefA.revision).toBe(briefB.revision);

      await service.rateBrief(userReq, 'committee-a', briefA.uid, 'up', briefA.revision);

      expect((await service.getCurrentBrief(userReq, 'committee-a')).caller_rating).toBe('up');
      expect((await service.getCurrentBrief(userReq, 'committee-b')).caller_rating).toBeNull();
    });

    it('a new revision (regenerate) starts unrated — the prior rating is never carried forward', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const briefUid = initial.brief!.uid;
      await service.rateBrief(userReq, 'committee-1', briefUid, 'up', 1);
      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBe('up');

      await service.generateBrief(userReq, 'committee-1', { force: true });

      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBeNull();
    });

    it('rateBrief logs a rating_recorded event carrying username/prompt_version/model/revision attribution and no prior rating on a first-time rate', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;

      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      expect(logger.info).toHaveBeenCalledWith(
        userReq,
        'rating_recorded',
        expect.any(String),
        expect.objectContaining({
          committee_id: 'committee-1',
          brief_uid: brief.uid,
          revision: brief.revision,
          prompt_version: brief.prompt_version,
          model: brief.model,
          user_id: 'auth0|alice-sub',
          previous_rating: null,
          rating_cache_enabled: true,
          rating: 'up',
        })
      );
      // The opaque sub is logged, never the human-readable LFID username (PR #1361 review —
      // security/pii-in-logs-and-identifiers).
      expect(logger.info).not.toHaveBeenCalledWith(userReq, 'rating_recorded', expect.any(String), expect.objectContaining({ username: expect.anything() }));
    });

    it('logs rating_cache_enabled: false when the cache is disabled — the one case previous_rating: null can be confidently read as "unknowable", not "genuinely unrated"', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      valkeyServiceMock.isEnabled.mockReturnValue(false);

      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      expect(logger.info).toHaveBeenCalledWith(
        userReq,
        'rating_recorded',
        expect.any(String),
        expect.objectContaining({ previous_rating: null, rating_cache_enabled: false })
      );
    });

    it('rateBrief rejects (409) a stale revision instead of misattributing the vote to content the rater never saw (e.g. a co-chair edited between page load and tap)', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      const staleClientRevision = brief.revision; // what the rater's page still shows...
      await service.saveBrief(userReq, 'committee-1', { brief_text: 'edited by a co-chair', revision: brief.revision }); // ...but the brief has since moved on

      await expect(service.rateBrief(userReq, 'committee-1', brief.uid, 'up', staleClientRevision)).rejects.toMatchObject({
        statusCode: 409,
        code: 'REVISION_MISMATCH',
      });

      // The rejected rate must not have written anything — the brief is still unrated at its
      // real current revision.
      expect((await service.getCurrentBrief(userReq, 'committee-1')).caller_rating).toBeNull();
      expect(logger.info).not.toHaveBeenCalledWith(userReq, 'rating_recorded', expect.any(String), expect.anything());
    });

    it('clearBriefRating rejects (409) a stale revision instead of deleting whatever revision happens to be current', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', brief.revision);
      const staleClientRevision = brief.revision;
      await service.saveBrief(userReq, 'committee-1', { brief_text: 'edited by a co-chair', revision: brief.revision });

      await expect(service.clearBriefRating(userReq, 'committee-1', brief.uid, staleClientRevision)).rejects.toMatchObject({
        statusCode: 409,
        code: 'REVISION_MISMATCH',
      });
    });

    it('rateBrief logs the prior value as previous_rating when switching (so offline analysis can net re-rates instead of over-counting)', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      await service.rateBrief(userReq, 'committee-1', brief.uid, 'down', 1);

      expect(logger.info).toHaveBeenCalledWith(
        userReq,
        'rating_recorded',
        expect.any(String),
        expect.objectContaining({ user_id: 'auth0|alice-sub', previous_rating: 'up', rating: 'down' })
      );
    });

    it('clearBriefRating logs a rating_cleared event carrying the opaque user_id and the previous rating', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      await service.clearBriefRating(userReq, 'committee-1', brief.uid, brief.revision);

      expect(logger.info).toHaveBeenCalledWith(
        userReq,
        'rating_cleared',
        expect.any(String),
        expect.objectContaining({
          committee_id: 'committee-1',
          brief_uid: brief.uid,
          revision: brief.revision,
          user_id: 'auth0|alice-sub',
          previous_rating: 'up',
        })
      );
    });

    it('logs a rating_persist_failed warning (but still succeeds) when an enabled Valkey write faults', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      valkeyServiceMock.setJson.mockResolvedValueOnce(false);

      const result = await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      expect(result).toEqual({ rating: 'up' });
      expect(logger.warning).toHaveBeenCalledWith(
        userReq,
        'rating_persist_failed',
        expect.any(String),
        expect.objectContaining({ committee_id: 'committee-1', brief_uid: brief.uid })
      );
    });

    it('logs a rating_persist_failed warning when an enabled Valkey clear faults', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);
      valkeyServiceMock.del.mockResolvedValueOnce(false);

      await service.clearBriefRating(userReq, 'committee-1', brief.uid, brief.revision);

      expect(logger.warning).toHaveBeenCalledWith(
        userReq,
        'rating_persist_failed',
        expect.any(String),
        expect.objectContaining({ committee_id: 'committee-1', brief_uid: brief.uid })
      );
    });

    it('does not log rating_persist_failed on rate when the cache is simply disabled (VALKEY_URL unset) rather than genuinely faulting — avoids alert fatigue on a documented supported mode', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      valkeyServiceMock.isEnabled.mockReturnValue(false);
      valkeyServiceMock.setJson.mockResolvedValueOnce(false);

      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);

      expect(logger.warning).not.toHaveBeenCalledWith(userReq, 'rating_persist_failed', expect.any(String), expect.anything());
    });

    it('does not log rating_persist_failed on clear when the cache is simply disabled', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      await service.rateBrief(userReq, 'committee-1', brief.uid, 'up', 1);
      valkeyServiceMock.isEnabled.mockReturnValue(false);
      valkeyServiceMock.del.mockResolvedValueOnce(false);

      await service.clearBriefRating(userReq, 'committee-1', brief.uid, brief.revision);

      expect(logger.warning).not.toHaveBeenCalledWith(userReq, 'rating_persist_failed', expect.any(String), expect.anything());
    });

    it('rateBrief rejects a briefUid that no longer matches the current brief with a 404, not a silent no-op', async () => {
      await expect(service.rateBrief(userReq, 'committee-1', 'stale-uid', 'up', 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rateBrief rejects a brief that is not in a shareable state (generating/error/empty) — LFXV2-3042 scope is generated/edited/approved only', async () => {
      const initial = await service.getCurrentBrief(userReq, WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID);
      expect(initial.brief?.state).toBe('error');

      await expect(service.rateBrief(userReq, WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID, initial.brief!.uid, 'up', 1)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rateBrief throws (401) when no resolvable user identity is available, instead of writing an unscoped rating', async () => {
      const anonReq = {} as unknown as Request;
      const initial = await service.getCurrentBrief(anonReq, 'committee-1');

      await expect(service.rateBrief(anonReq, 'committee-1', initial.brief!.uid, 'up', 1)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rateBrief throws (400) when the resolved identity cannot build a safe rating key (defense-in-depth — not reachable via normal auth)', async () => {
      const unsafeReq = { oidc: { user: { nickname: 'unsafe' } } } as unknown as Request;
      const initial = await service.getCurrentBrief(unsafeReq, 'committee-1');

      await expect(service.rateBrief(unsafeReq, 'committee-1', initial.brief!.uid, 'up', 1)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('getCurrentBrief omits caller_rating when no user identity is resolvable (fails soft, not with an error)', async () => {
      const anonReq = {} as unknown as Request;
      const result = await service.getCurrentBrief(anonReq, 'committee-1');
      expect(result.caller_rating).toBeUndefined();
    });

    it('getCurrentBrief treats a corrupt/legacy cache entry as a miss rather than surfacing it verbatim', async () => {
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const brief = initial.brief!;
      // 'alice' is never the 'unsafe' sentinel, so the mock key builder never returns null here.
      const key = buildWeeklyBriefRatingCacheKeyMock('committee-1', brief.uid, brief.revision, 'alice')!;
      valkeyStore.set(key, { rating: 'sideways' });

      const result = await service.getCurrentBrief(userReq, 'committee-1');

      expect(result.caller_rating).toBeNull();
    });
  });
});
