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
  checkSingleAccessStrictMock,
  getCommitteeByIdMock,
  getCommitteeBaseMock,
  hasMailingListStrictMock,
  createNewsletterMock,
  sendNewsletterMock,
  deleteNewsletterMock,
  getCommitteeActivityMock,
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
    // shareBrief's / shareToSlack's shared access-check collaborator — controlled per-test in
    // their respective describe blocks below.
    checkSingleAccessStrictMock: vi.fn(),
    // shareBrief's (LFXV2-2914 / LFXV2-3093) own committee + newsletter collaborators —
    // controlled per-test in the 'shareBrief' describe block below.
    getCommitteeByIdMock: vi.fn(),
    // buildCurrentActivity's (GH-1922) OWN gating collaborator — a separate mock from
    // getCommitteeByIdMock above, matching the production split (buildCurrentActivity calls
    // CommitteeService#getCommitteeBase, not #getCommitteeById — see its doc comment for
    // why). Controlled per-test in the 'current_activity (GH-1922)' describe block and in each
    // internal caller's "never triggers the fan-out" regression guard.
    getCommitteeBaseMock: vi.fn(),
    hasMailingListStrictMock: vi.fn(),
    createNewsletterMock: vi.fn(),
    sendNewsletterMock: vi.fn(),
    deleteNewsletterMock: vi.fn(),
    // buildCurrentActivity's (GH-1922) collaborator — controlled per-test in the
    // 'current_activity (GH-1922)' describe blocks below; defaults to an empty feed (see the
    // outer beforeEach) so unrelated tests elsewhere in this file never need to know it exists.
    getCommitteeActivityMock: vi.fn(),
  };
});

vi.mock('@lfx-one/shared/constants', () => ({
  ACTIVITY_FEED_MAX_PAGE_SIZE: 50,
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
// `isGoverningBoard` — minimal reimplementation (real one lives in committee.utils.ts, same
// barrel/JIT-failure reasoning) sufficient for this file's fixtures, which only ever use
// `category: 'Board'` or `category: 'Working Group'`.
vi.mock('@lfx-one/shared/utils', () => ({
  formatUtcDateRangeLabel: vi.fn(() => 'Jan 1 – Jan 7, 2026'),
  isGoverningBoard: vi.fn((category: string | undefined) => category === 'Board' || category === 'Government Advisory Council'),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));
// shareBrief's own committee collaborator (shareToSlack no longer calls committeeService at
// all — it needs only project_uid, fetched directly via a plain proxyRequest GET, same as any
// other upstream call in this file). getCommitteeById / hasMailingListStrict / createNewsletter /
// sendNewsletter / deleteNewsletter back shareBrief's (LFXV2-2914 / LFXV2-3093) precondition +
// send chain (see the 'shareBrief' describe block below).
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteeById = getCommitteeByIdMock;
    public getCommitteeBase = getCommitteeBaseMock;
    public hasMailingListStrict = hasMailingListStrictMock;
  },
}));
// buildCurrentActivity's (GH-1922) collaborator — the same live meeting/vote/document
// aggregation `committee-activity.service.spec.ts` covers on its own; this file only needs to
// control what it returns, not re-verify its internal aggregation logic.
vi.mock('./committee-activity.service', () => ({
  CommitteeActivityService: class {
    public getCommitteeActivity = getCommitteeActivityMock;
  },
}));
vi.mock('./newsletter.service', () => ({
  NewsletterService: class {
    public createNewsletter = createNewsletterMock;
    public sendNewsletter = sendNewsletterMock;
    public deleteNewsletter = deleteNewsletterMock;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrictMock;
  },
}));
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
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

import { logger } from './logger.service';
import { __resetMockBriefStateForTesting, briefWindow, currentWeekInProgressWindow, WeeklyBriefService } from './weekly-brief.service';

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

describe('currentWeekInProgressWindow (GH-1922)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('always looks at the current week, not the last completed one, on a weekday (Wednesday)', () => {
    // 2026-01-14 is a Wednesday (UTC) — briefWindow() would resolve to the *previous* week here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'));

    const { window_start, window_end } = currentWeekInProgressWindow();

    expect(window_start).toBe('2026-01-11T00:00:00.000Z'); // this week's Sunday, not last week's
    expect(window_end).toBe('2026-01-14T12:00:00.000Z'); // now, not a fixed Saturday 23:59:59.999
  });

  it('on Sunday itself, the window starts and ends the same day', () => {
    // 2026-01-11 is a Sunday (UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-11T08:30:00.000Z'));

    const { window_start, window_end } = currentWeekInProgressWindow();

    expect(window_start).toBe('2026-01-11T00:00:00.000Z');
    expect(window_end).toBe('2026-01-11T08:30:00.000Z');
  });

  it('on Saturday, matches briefWindow()’s start but ends at now instead of 23:59:59.999', () => {
    // 2026-01-17 is a Saturday (UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-17T09:00:00.000Z'));

    const inProgress = currentWeekInProgressWindow();
    const completed = briefWindow();

    expect(inProgress.window_start).toBe(completed.window_start);
    expect(inProgress.window_end).toBe('2026-01-17T09:00:00.000Z');
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
    // Safe default for buildCurrentActivity's (GH-1922) collaborators — a non-governance
    // committee with an empty activity feed, so every test elsewhere in this file that calls
    // getCurrentBrief (the vast majority) never needs to know these mocks exist. Tests that
    // specifically exercise current_activity override both below.
    getCommitteeBaseMock.mockResolvedValue({ category: 'Working Group' });
    getCommitteeActivityMock.mockResolvedValue({ data: [], page_token: undefined });
    // shareBrief's own committee collaborator (unrelated to buildCurrentActivity — see
    // getCommitteeBaseMock above) — a safe default so tests elsewhere that incidentally
    // route through fetchBriefResponse's internal callers don't need their own override.
    getCommitteeByIdMock.mockResolvedValue({ uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1', category: 'Working Group' });
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

    it('never triggers the current_activity fan-out (GH-1922) — getActionItems only ever reads brief_text', async () => {
      // A governance committee, so a regression back to `this.getCurrentBrief` here would
      // actually trigger the fan-out this test exists to catch — not pass vacuously.
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      extractBriefActionItems.mockResolvedValue({ items: [] });

      await service.getActionItems(req, 'committee-1');

      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
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

    it('scopes each item uid to the committee too, not just the cache key', async () => {
      // The mock fixture shares one brief uid across committees, so an unscoped item uid would
      // collide the dismiss-cookie identity across committees (PR #1362 review — Copilot).
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

      // includeCurrentActivity: false — this test is about the mock/live proxy passthrough,
      // not the current_activity merge (covered by its own describe block below), so opt out
      // to keep the assertion a true pass-through-by-reference check.
      const result = await service.getCurrentBrief(req, 'committee-1', { includeCurrentActivity: false });

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

  /**
   * GH-1922 rework: `current_activity` is sourced from `CommitteeActivityService`'s existing
   * live meeting/vote/document aggregation (mocked here via `getCommitteeActivityMock`), not a
   * weekly-brief-specific mock/live split — these tests run against BOTH `getCurrentBrief`
   * branches to prove that (mock mode still needs `delete process.env['WEEKLY_BRIEF_BACKEND']`
   * for the *brief* itself to stay mocked; `current_activity` behaves identically either way).
   */
  describe('current_activity (GH-1922)', () => {
    it.each([
      ['mock mode', () => delete process.env['WEEKLY_BRIEF_BACKEND']],
      [
        'live mode',
        () => {
          process.env['WEEKLY_BRIEF_BACKEND'] = 'live';
          proxyRequest.mockResolvedValue({ brief: { uid: 'b1', state: 'generated' }, throttle: null });
        },
      ],
    ])('populates current_activity for a governance committee, mapping kinds and excluding an in-progress vote (%s)', async (_label, setBackend) => {
      setBackend();
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({
        data: [
          {
            type: 'meeting_held',
            occurred_at: '2026-01-12T10:00:00Z',
            committee_uid: 'committee-1',
            payload: { meeting_id: 'm1', meeting_occurrence_id: 'm1-occ', title: 'Board Sync', password: null },
          },
          {
            type: 'vote_closed',
            occurred_at: '2026-01-12T11:00:00Z',
            committee_uid: 'committee-1',
            payload: { vote_uid: 'v1', name: 'Q3 Resolution', status: 'Ended' },
          },
          // Deliberately excluded from the tally — see mapActivityEventToCurrentActivityRef's doc comment.
          {
            type: 'vote_opened',
            occurred_at: '2026-01-12T09:00:00Z',
            committee_uid: 'committee-1',
            payload: { vote_uid: 'v2', name: 'Q4 Budget', status: 'Active' },
          },
          {
            type: 'document_uploaded',
            occurred_at: '2026-01-12T12:00:00Z',
            committee_uid: 'committee-1',
            payload: { document_uid: 'd1', name: 'Minutes.pdf', document_type: 'file' },
          },
        ],
        page_token: undefined,
      });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toBeDefined();
      const refs = result.current_activity?.source_refs ?? [];
      expect(refs).toHaveLength(3);
      expect(refs.map((ref) => ref.kind).sort()).toEqual(['doc', 'meeting', 'vote']);
      expect(refs.find((ref) => ref.kind === 'vote')?.title).toBe('Q3 Resolution');
      expect(refs.some((ref) => ref.title === 'Q4 Budget')).toBe(false);
      // No kind prefix on meeting/vote — see mapActivityEventToCurrentActivityRef's doc comment
      // for why: a vote ref's id passes straight through as VoteDrawerActivityFeedAction.voteUid
      // (a `vote:` prefix would reach that action as a corrupted id), and a meeting ref's id is
      // deliberately the occurrence-scoped tracking id, not (yet) a click-through navigation id —
      // same doc comment covers that known v1 residual.
      expect(refs.find((ref) => ref.kind === 'meeting')?.id).toBe('m1-occ');
      expect(refs.find((ref) => ref.kind === 'vote')?.id).toBe('v1');
    });

    it('folds survey events into the "other" kind rather than dropping them', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({
        data: [
          {
            type: 'survey_closed',
            occurred_at: '2026-01-12T10:00:00Z',
            committee_uid: 'committee-1',
            payload: { survey_uid: 's1', title: 'Annual Review', status: 'Closed' },
          },
        ],
        page_token: undefined,
      });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity?.source_refs).toEqual([{ id: 's1', kind: 'other', title: 'Annual Review' }]);
    });

    it('maps notes_added to kind "doc", and its id carries the meeting_scope discriminant so it cannot collide with a document_uploaded event sharing the same document_uid', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({
        data: [
          {
            type: 'notes_added',
            occurred_at: '2026-01-12T10:00:00Z',
            committee_uid: 'committee-1',
            payload: { document_uid: 'shared-uid', name: 'Meeting Notes', document_type: 'file', meeting_scope: 'past' },
          },
          // Different upstream uid namespace (committee_document, not v1_past_meeting_attachment)
          // coincidentally sharing the same raw document_uid — eventKey()'s own rationale for why
          // committee-activity.service.ts prefixes with document_type/meeting_scope, not just the uid.
          {
            type: 'document_uploaded',
            occurred_at: '2026-01-12T11:00:00Z',
            committee_uid: 'committee-1',
            payload: { document_uid: 'shared-uid', name: 'Charter.pdf', document_type: 'file' },
          },
        ],
        page_token: undefined,
      });

      const result = await service.getCurrentBrief(req, 'committee-1');

      const refs = result.current_activity?.source_refs ?? [];
      expect(refs).toEqual([
        { id: 'note:past:shared-uid', kind: 'doc', title: 'Meeting Notes' },
        { id: 'document:file:shared-uid', kind: 'doc', title: 'Charter.pdf' },
      ]);
      // The whole point of the discriminant — two refs in the same kind, distinct ids.
      expect(refs[0].id).not.toBe(refs[1].id);
    });

    it('sets current_activity to null (a settled, not a transient, absence) when the returned page itself is full', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({
        // ACTIVITY_FEED_MAX_PAGE_SIZE (mocked to 50) worth of in-window events — the actual signal
        // that some of them may have been cut, unlike a bare page_token (see the next test).
        data: Array.from({ length: 50 }, (_, i) => ({
          type: 'meeting_held',
          occurred_at: '2026-01-12T10:00:00Z',
          committee_uid: 'committee-1',
          payload: { meeting_id: `m${i}`, meeting_occurrence_id: `m${i}-occ`, title: 'Board Sync', password: null },
        })),
        page_token: undefined,
      });

      const result = await service.getCurrentBrief(req, 'committee-1');

      // null, not undefined: more in-window activity only ever accumulates within a poll cycle,
      // so a caller (the client's pollUntilTerminal) is right to treat this as settled and stop
      // asking, unlike a genuine transient failure — see buildCurrentActivity's doc comment.
      expect(result.current_activity).toBeNull();
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'get_weekly_brief_current_activity',
        expect.stringContaining('fills a full page'),
        expect.objectContaining({ committee_id: 'committee-1' })
      );
    });

    it("does NOT omit current_activity merely because page_token is present with a short page — a committee with >fetchSize lifetime notes/surveys saturates those legs regardless of the current week (see buildCurrentActivity's own doc comment)", async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({
        data: [
          {
            type: 'meeting_held',
            occurred_at: '2026-01-12T10:00:00Z',
            committee_uid: 'committee-1',
            payload: { meeting_id: 'm1', meeting_occurrence_id: 'm1-occ', title: 'Board Sync', password: null },
          },
        ],
        // A real, non-truncating page_token: notes/surveys legs saturate on lifetime volume, not
        // in-window volume — see committee-activity.service.ts's fetchNotesAddedEvents/
        // fetchSurveyEvents doc comments.
        page_token: 'saturated-on-an-unrelated-leg',
      });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toBeDefined();
      expect(result.current_activity?.source_refs).toHaveLength(1);
    });

    it('renders a genuine quiet week as current_activity present with an empty source_refs array, not absent', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockResolvedValue({ data: [], page_token: undefined });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toEqual({
        window_start: expect.any(String),
        window_end: expect.any(String),
        source_refs: [],
      });
    });

    it('passes currentWeekInProgressWindow().window_start as since, and never briefWindow()', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });

      vi.useFakeTimers();
      try {
        // 2026-01-14 is a Wednesday (UTC) — briefWindow() resolves to the previous week here;
        // currentWeekInProgressWindow() must not.
        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'));

        const result = await service.getCurrentBrief(req, 'committee-1');

        expect(getCommitteeActivityMock).toHaveBeenCalledWith(
          req,
          'committee-1',
          { since: '2026-01-11T00:00:00.000Z', limit: expect.any(Number) },
          { category: 'Board' }
        );
        expect(result.current_activity?.window_start).toBe('2026-01-11T00:00:00.000Z');
        expect(result.current_activity?.window_end).toBe('2026-01-14T12:00:00.000Z');
        expect(result.brief?.window_start).toBe('2026-01-04T00:00:00.000Z');
      } finally {
        vi.useRealTimers();
      }
    });

    it('excludes an event whose occurred_at is after window_end — getCommitteeActivity has no upper-bound param of its own to enforce this', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'));

        getCommitteeActivityMock.mockResolvedValue({
          data: [
            {
              // vote_closed, not meeting_held — this is the real mechanism that can produce an
              // occurred_at ahead of "now": mapVoteToEvent stamps occurred_at from
              // early_end_time ?? end_time for a closed vote, and an administratively-ended vote
              // (status ENDED) can carry an end_time still in the future.
              type: 'vote_closed',
              // Ahead of window_end (2026-01-14T12:00:00.000Z).
              occurred_at: '2026-01-14T13:00:00.000Z',
              committee_uid: 'committee-1',
              payload: { vote_uid: 'v1', name: 'Future Vote', status: 'Ended' },
            },
            {
              type: 'meeting_held',
              occurred_at: '2026-01-14T11:00:00.000Z',
              committee_uid: 'committee-1',
              payload: { meeting_id: 'm2', meeting_occurrence_id: 'm2-occ', title: 'Real Meeting', password: null },
            },
          ],
          page_token: undefined,
        });

        const result = await service.getCurrentBrief(req, 'committee-1');

        expect(result.current_activity?.source_refs).toEqual([{ id: 'm2-occ', kind: 'meeting', title: 'Real Meeting' }]);
        // A dropped event is a real data-quality anomaly, not an expected silent case — must
        // warn like this method's other degrade paths, not drop quietly.
        expect(logger.warning).toHaveBeenCalledWith(req, 'get_weekly_brief_current_activity', 'Dropped one or more events stamped after window_end', {
          committee_id: 'committee-1',
          dropped_count: 1,
          window_end: '2026-01-14T12:00:00.000Z',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('never calls getCommitteeActivity for a non-governance committee, and current_activity settles to null (not undefined)', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Working Group' });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
      // null, not undefined: this committee will never become governance-classified mid-poll,
      // so a caller is right to treat this as settled and stop asking — see
      // buildCurrentActivity's doc comment.
      expect(result.current_activity).toBeNull();
    });

    it('skips the entire fan-out (getCommitteeBase and getCommitteeActivity) when includeCurrentActivity is false, even for a governance committee', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });

      const result = await service.getCurrentBrief(req, 'committee-1', { includeCurrentActivity: false });

      expect(getCommitteeBaseMock).not.toHaveBeenCalled();
      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
      expect(result.current_activity).toBeUndefined();
    });

    it('degrades to current_activity: undefined (not a thrown error) when the committee lookup fails', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockRejectedValue(new Error('upstream unavailable'));

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toBeUndefined();
      expect(result.brief).toBeDefined(); // the brief itself still renders — only the tally degrades
    });

    it('degrades to current_activity: undefined (not a thrown error) when the committee lookup returns nothing (the empty-body case)', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue(undefined);

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toBeUndefined();
      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
      expect(result.brief).toBeDefined();
    });

    it.each([
      ['absent entirely', { uid: 'committee-1' }],
      ['an empty string', { uid: 'committee-1', category: '' }],
    ])(
      'degrades to current_activity: undefined (not null) when the committee resolves with category %s — an anomaly, not a "not governance" verdict',
      async (_label, committee) => {
        delete process.env['WEEKLY_BRIEF_BACKEND'];
        // Not the empty-body case getCommitteeBase's own doc comment covers (that resolves to
        // undefined, not an object) — a resolved committee whose category isn't usable.
        getCommitteeBaseMock.mockResolvedValue(committee);

        const result = await service.getCurrentBrief(req, 'committee-1');

        // undefined, not null: isGoverningBoard('')/isGoverningBoard(undefined) are both false,
        // so a naive falsy-only check on the RESULT of isGoverningBoard would settle this to null
        // (permanent "not governance") — this is a transient anomaly worth asking again on the
        // next poll tick instead.
        expect(result.current_activity).toBeUndefined();
        expect(getCommitteeActivityMock).not.toHaveBeenCalled();
      }
    );

    it('degrades to current_activity: undefined (not a thrown error) when the activity fetch fails', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      getCommitteeActivityMock.mockRejectedValue(new Error('upstream unavailable'));

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.current_activity).toBeUndefined();
      expect(result.brief).toBeDefined();
    });
  });

  describe('weekly-brief rating (LFXV2-3042)', () => {
    beforeEach(() => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      delete process.env['NODE_ENV'];
    });

    it('never triggers the current_activity fan-out (GH-1922) — rateBrief/clearBriefRating only ever read brief/caller_rating', async () => {
      // A governance committee, so a regression back to `this.getCurrentBrief` inside
      // resolveRatableBrief would actually trigger the fan-out this test exists to catch.
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      const initial = await service.getCurrentBrief(userReq, 'committee-1');
      const briefUid = initial.brief!.uid;
      getCommitteeActivityMock.mockClear(); // the setup call above is allowed to fan out; only what follows is under test.

      await service.rateBrief(userReq, 'committee-1', briefUid, 'up', 1);
      await service.clearBriefRating(userReq, 'committee-1', briefUid, 1);

      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
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

  describe('shareToSlack (LFXV2-3080)', () => {
    beforeEach(() => {
      process.env['WEEKLY_BRIEF_BACKEND'] = 'live';
      // On by default here — the dedicated FEATURE_DISABLED test below covers it off; every other
      // test in this block exercises what happens once the kill switch is enabled.
      process.env[ServerFeatureFlag.WeeklyBriefSlack] = 'true';
      checkSingleAccessStrictMock.mockResolvedValue(true);
    });

    /** A brief in a shareable state, queued up for the fetchBriefResponse call shareToSlack makes internally. */
    function mockShareableBrief(overrides: Record<string, unknown> = {}): void {
      proxyRequest.mockResolvedValueOnce({
        brief: {
          uid: 'b1',
          state: 'generated',
          revision: 1,
          brief_text: 'Hello committee',
          window_start: '2026-01-01',
          window_end: '2026-01-07',
          ...overrides,
        },
        throttle: null,
      });
    }

    /** The plain committee GET shareToSlack makes for project_uid — queued up right after mockShareableBrief. */
    function mockCommittee(overrides: Record<string, unknown> = {}): void {
      proxyRequest.mockResolvedValueOnce({ uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1', ...overrides });
    }

    it('throws 409 FEATURE_DISABLED before any upstream call when the server-side kill switch is off, independent of WG_WEEKLY_BRIEF_SLACK_FLAG which never reaches this method', async () => {
      delete process.env[ServerFeatureFlag.WeeklyBriefSlack];

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'FEATURE_DISABLED' });

      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('throws 404 when there is no brief to share', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: null, throttle: null });

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      expect(proxyRequest).toHaveBeenCalledOnce();
    });

    it('throws 404 when the brief is not in a shareable state', async () => {
      mockShareableBrief({ state: 'generating' });

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      expect(proxyRequest).toHaveBeenCalledOnce();
    });

    it('throws 409 REVISION_MISMATCH when the caller-supplied revision is stale', async () => {
      mockShareableBrief({ revision: 2 });

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'REVISION_MISMATCH' });
      expect(proxyRequest).toHaveBeenCalledOnce();
    });

    it('throws 404 when the committee no longer exists, before running the project-writer check', async () => {
      mockShareableBrief();
      proxyRequest.mockResolvedValueOnce(null);

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      expect(checkSingleAccessStrictMock).not.toHaveBeenCalled();
    });

    it("throws 403 NOT_PROJECT_WRITER when the caller is not a project writer — this repo's own boundary, stricter than Heimdall's committee-writer enforcement on the upstream endpoint itself", async () => {
      mockShareableBrief();
      mockCommittee();
      checkSingleAccessStrictMock.mockResolvedValue(false);

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 403, code: 'NOT_PROJECT_WRITER' });
      expect(proxyRequest).toHaveBeenCalledTimes(2);
    });

    it('throws 409 BACKEND_NOT_LIVE when WEEKLY_BRIEF_BACKEND is not "live" — checked only after every other local precondition passes, before the committee-service call', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      // getCurrentBrief is itself gated on isLive() and returns a canned mock brief (revision 1,
      // 'generated') without calling proxyRequest when not live — so mockShareableBrief() isn't
      // used here. The committee GET below is NOT gated on isLive() (it's a real precondition
      // check, enforced "regardless of backend mode" per this method's own doc comment), so it's
      // still the one and only real proxyRequest call in this scenario.
      mockCommittee();

      await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'BACKEND_NOT_LIVE' });
      expect(proxyRequest).toHaveBeenCalledOnce();
    });

    it('POSTs { revision } to the committee-service share-to-chat endpoint and resolves on a 204', async () => {
      mockShareableBrief();
      mockCommittee();
      proxyRequest.mockResolvedValueOnce(undefined);

      await expect(service.shareToSlack(req, 'committee-1', 1)).resolves.toEqual({});

      expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/share-to-chat', 'POST', undefined, {
        revision: 1,
      });
    });

    it('never triggers the current_activity fan-out (GH-1922) — shareToSlack only ever reads brief', async () => {
      // A governance committee, so a regression back to `this.getCurrentBrief` here would
      // actually trigger the fan-out this test exists to catch.
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      mockShareableBrief();
      mockCommittee();
      proxyRequest.mockResolvedValueOnce(undefined);

      await service.shareToSlack(req, 'committee-1', 1);

      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
    });

    it('logs the sending user (as their opaque sub, not the human-readable username) on a successful send — the committee-service call carries no caller identity of its own beyond the bearer token, so this is the only record of who shared it', async () => {
      mockShareableBrief();
      mockCommittee();
      proxyRequest.mockResolvedValueOnce(undefined);

      await service.shareToSlack(userReq, 'committee-1', 1);

      expect(logger.info).toHaveBeenCalledWith(userReq, 'share_weekly_brief_slack_sent', expect.any(String), {
        committee_id: 'committee-1',
        shared_by: 'auth0|alice-sub',
      });
    });

    describe('committee-service response mapping', () => {
      beforeEach(() => {
        mockShareableBrief();
        mockCommittee();
      });

      it('maps a 400 (brief not shareable) to a 404 — a race between the local shareable-state check and this call landing, not the primary path', async () => {
        proxyRequest.mockRejectedValueOnce(new MicroserviceError('Brief is not in a shareable state', 400, 'BAD_REQUEST'));

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      });

      it('maps a 403 to NOT_PROJECT_WRITER — defense-in-depth beyond the local strict check above', async () => {
        proxyRequest.mockRejectedValueOnce(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 403, code: 'NOT_PROJECT_WRITER' });
      });

      it('maps a 404 straight through to a 404', async () => {
        proxyRequest.mockRejectedValueOnce(new MicroserviceError('Not found', 404, 'NOT_FOUND'));

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      });

      it('maps a 409 to REVISION_MISMATCH, with the same client-facing message the local revision check uses', async () => {
        proxyRequest.mockRejectedValueOnce(new MicroserviceError('stale revision', 409, 'REVISION_CONFLICT'));

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({
          statusCode: 409,
          code: 'REVISION_MISMATCH',
          message: 'The brief has been updated since you last viewed it. Reload to review the latest version before sharing.',
        });
      });

      it('maps a 422 to NO_SLACK_WEBHOOK — the Settings-tab "not configured" UX depends on this exact code', async () => {
        proxyRequest.mockRejectedValueOnce(new MicroserviceError('no webhook', 422, 'UNPROCESSABLE_ENTITY'));

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toMatchObject({
          statusCode: 409,
          code: 'NO_SLACK_WEBHOOK',
          message: 'Committee has no Slack webhook configured',
        });
      });

      it('passes a 500/503 MicroserviceError through unchanged rather than reshaping it', async () => {
        const upstreamError = new MicroserviceError('Internal server error', 500, 'INTERNAL_SERVER_ERROR');
        proxyRequest.mockRejectedValueOnce(upstreamError);

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toBe(upstreamError);
      });

      it('rethrows a non-MicroserviceError as-is instead of trying to map a status code off it', async () => {
        const genericError = new Error('network blip');
        proxyRequest.mockRejectedValueOnce(genericError);

        await expect(service.shareToSlack(req, 'committee-1', 1)).rejects.toBe(genericError);
      });
    });
  });

  describe('shareBrief (LFXV2-2914 / LFXV2-3093)', () => {
    beforeEach(() => {
      process.env['WEEKLY_BRIEF_BACKEND'] = 'live';
      getCommitteeByIdMock.mockResolvedValue({ uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1' });
      hasMailingListStrictMock.mockResolvedValue(true);
      checkSingleAccessStrictMock.mockResolvedValue(true);
      createNewsletterMock.mockResolvedValue({ id: 'newsletter-1', version: 1 });
      sendNewsletterMock.mockResolvedValue({ total_recipients: 42 });
    });

    /** A brief in a shareable state, queued up for the fetchBriefResponse call shareBrief makes internally. */
    function mockShareableBrief(overrides: Record<string, unknown> = {}): void {
      proxyRequest.mockResolvedValueOnce({
        brief: {
          uid: 'b1',
          state: 'generated',
          revision: 1,
          brief_text: 'Hello committee',
          window_start: '2026-01-01',
          window_end: '2026-01-07',
          ...overrides,
        },
        throttle: null,
      });
    }

    const nonImpersonatingReq = { oidc: { user: { email: 'Writer@Example.com' } }, bearerToken: 'writer-token' } as unknown as Request;

    /**
     * Impersonation session: `bearerToken` starts as the impersonation token (what
     * auth.middleware.ts would have set), `oidc.user.email` is the real staff member's own OIDC
     * identity, and `oidc.accessToken` is the real staff member's own (never impersonation-swapped)
     * session token — see resolveRealAccessToken's doc comment for why this is the source of the
     * "real" identity during impersonation.
     */
    function buildImpersonatingReq(opts: { realTokenExpired?: boolean; refreshedToken?: string; refreshFails?: boolean } = {}): Request {
      const refresh = opts.refreshFails
        ? vi.fn(async () => {
            throw new Error('refresh failed');
          })
        : vi.fn(async () => ({ access_token: opts.refreshedToken ?? 'refreshed-real-token' }));
      return {
        appSession: {
          impersonationToken: 'imp-token',
          impersonationExpiresAt: Date.now() + 60_000,
          impersonationUser: { email: 'Target@Example.com', sub: 'auth0|target' },
        },
        oidc: {
          user: { email: 'Staff@Example.com' },
          accessToken: {
            access_token: 'real-staff-token',
            isExpired: () => !!opts.realTokenExpired,
            refresh,
          },
        },
        bearerToken: 'imp-token',
      } as unknown as Request;
    }

    it("non-impersonating: authorizes and sends under the caller's own token/email, unaffected by the real-identity plumbing", async () => {
      mockShareableBrief();

      const result = await service.shareBrief(nonImpersonatingReq, 'committee-1', 1);

      expect(result).toEqual({ committee_name: 'Test Committee', total_recipients: 42 });
      expect(checkSingleAccessStrictMock).toHaveBeenCalledWith(nonImpersonatingReq, { resource: 'project', id: 'project-1', access: 'writer' });
      expect(createNewsletterMock).toHaveBeenCalledWith(
        nonImpersonatingReq,
        'project-1',
        expect.objectContaining({ ed_reply_email: 'writer@example.com', committee_uids: ['committee-1'] })
      );
      expect(nonImpersonatingReq.bearerToken).toBe('writer-token');
    });

    it('never triggers the current_activity fan-out (GH-1922) — shareBrief only ever reads brief', async () => {
      // A governance committee, so a regression back to `this.getCurrentBrief` here would
      // actually trigger the fan-out this test exists to catch. Both mocks: shareBrief itself
      // calls getCommitteeById (for name/project_uid), while buildCurrentActivity — reachable
      // only via the regression this test guards against — calls getCommitteeBase.
      getCommitteeByIdMock.mockResolvedValue({ uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1', category: 'Board' });
      getCommitteeBaseMock.mockResolvedValue({ category: 'Board' });
      mockShareableBrief();

      await service.shareBrief(nonImpersonatingReq, 'committee-1', 1);

      expect(getCommitteeActivityMock).not.toHaveBeenCalled();
    });

    it("impersonating: authorizes and sends under the REAL staff member's token/email, not the impersonated target's, and restores the impersonation token afterward", async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq();

      let tokenDuringCommitteeFetch: string | undefined;
      getCommitteeByIdMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringCommitteeFetch = r.bearerToken;
        return { uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1' };
      });
      let tokenDuringAuthCheck: string | undefined;
      checkSingleAccessStrictMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringAuthCheck = r.bearerToken;
        return true;
      });
      let tokenDuringMailingListCheck: string | undefined;
      hasMailingListStrictMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringMailingListCheck = r.bearerToken;
        return true;
      });
      let tokenDuringCreate: string | undefined;
      createNewsletterMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringCreate = r.bearerToken;
        return { id: 'newsletter-1', version: 1 };
      });
      let tokenDuringSend: string | undefined;
      sendNewsletterMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringSend = r.bearerToken;
        return { total_recipients: 7 };
      });

      const result = await service.shareBrief(req, 'committee-1', 1);

      expect(result).toEqual({ committee_name: 'Test Committee', total_recipients: 7 });
      expect(tokenDuringAuthCheck).toBe('real-staff-token');
      expect(tokenDuringCreate).toBe('real-staff-token');
      expect(tokenDuringSend).toBe('real-staff-token');
      // getCommitteeById and hasMailingListStrict are precondition READS — stay on the
      // effective/target identity (the impersonation token), not the real one, same as every
      // other read in this method (brief fetch included, via mockShareableBrief's proxyRequest).
      expect(tokenDuringCommitteeFetch).toBe('imp-token');
      expect(tokenDuringMailingListCheck).toBe('imp-token');
      expect(createNewsletterMock).toHaveBeenCalledWith(req, 'project-1', expect.objectContaining({ ed_reply_email: 'staff@example.com' }));
      // Restored to the impersonation token once the write finishes, regardless of outcome.
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: refreshes an expired real access token and sends under the refreshed token', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq({ realTokenExpired: true, refreshedToken: 'refreshed-token' });

      let tokenDuringCreate: string | undefined;
      createNewsletterMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringCreate = r.bearerToken;
        return { id: 'newsletter-1', version: 1 };
      });

      await service.shareBrief(req, 'committee-1', 1);

      expect(tokenDuringCreate).toBe('refreshed-token');
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: the REAL user being denied project-writer access is rejected even though the impersonated target might have it — proving authorization runs against the real identity', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq();
      checkSingleAccessStrictMock.mockResolvedValueOnce(false);

      await expect(service.shareBrief(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 403, code: 'NOT_PROJECT_WRITER' });
      expect(createNewsletterMock).not.toHaveBeenCalled();
      // Token restored even on the authorization-failure path.
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: restores the impersonation token even when checkSingleAccessStrict THROWS (not just returns false) — proving the finally, not just a linear post-call restore, is what closes this window', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq();
      const outage = new MicroserviceError('Access-check service unavailable', 503, 'ACCESS_CHECK_UNAVAILABLE', {});
      checkSingleAccessStrictMock.mockRejectedValueOnce(outage);

      await expect(service.shareBrief(req, 'committee-1', 1)).rejects.toBe(outage);

      expect(createNewsletterMock).not.toHaveBeenCalled();
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: restores the impersonation token even when createNewsletter itself THROWS, before any send is attempted', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq();
      const createFailure = new MicroserviceError('Bad request', 400, 'INVALID_REQUEST', {});
      createNewsletterMock.mockRejectedValueOnce(createFailure);

      await expect(service.shareBrief(req, 'committee-1', 1)).rejects.toBe(createFailure);

      expect(sendNewsletterMock).not.toHaveBeenCalled();
      expect(deleteNewsletterMock).not.toHaveBeenCalled();
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: fails closed with an AuthenticationError — never falls back to the impersonation token — when the real access token cannot be resolved', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq({ realTokenExpired: true, refreshFails: true });

      await expect(service.shareBrief(req, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
      expect(checkSingleAccessStrictMock).not.toHaveBeenCalled();
      expect(createNewsletterMock).not.toHaveBeenCalled();
      expect(req.bearerToken).toBe('imp-token');
    });

    it('impersonating: cleans up the orphaned draft on a deterministic send rejection, still under the real token, and restores the impersonation token afterward', async () => {
      mockShareableBrief();
      const req = buildImpersonatingReq();
      const rejection = new MicroserviceError('Bad request', 400, 'INVALID_REQUEST', {});
      sendNewsletterMock.mockRejectedValueOnce(rejection);
      // `req` is a mutable object the finally-restore mutates back to 'imp-token' before this
      // test's own assertions run — a bare `toHaveBeenCalledWith(req, ...)` check would pass
      // regardless of what token was live AT delete-call time, since it inspects the (by-then
      // restored) object, not a snapshot. Capture the token synchronously inside the mock instead,
      // the same way the auth-check/create/send captures above do.
      let tokenDuringDelete: string | undefined;
      deleteNewsletterMock.mockImplementationOnce(async (r: Request) => {
        tokenDuringDelete = r.bearerToken;
      });

      await expect(service.shareBrief(req, 'committee-1', 1)).rejects.toBe(rejection);

      expect(deleteNewsletterMock).toHaveBeenCalledWith(req, 'project-1', 'newsletter-1');
      expect(tokenDuringDelete).toBe('real-staff-token');
      expect(req.bearerToken).toBe('imp-token');
    });

    it('throws 404 when there is no brief to share', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: null, throttle: null });

      await expect(service.shareBrief(nonImpersonatingReq, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 404 });
      expect(checkSingleAccessStrictMock).not.toHaveBeenCalled();
    });

    it('throws 409 REVISION_MISMATCH when the caller-supplied revision is stale', async () => {
      mockShareableBrief({ revision: 2 });

      await expect(service.shareBrief(nonImpersonatingReq, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'REVISION_MISMATCH' });
      expect(checkSingleAccessStrictMock).not.toHaveBeenCalled();
    });

    it('throws 409 NO_MAILING_LIST when the committee has no mailing list configured', async () => {
      mockShareableBrief();
      hasMailingListStrictMock.mockResolvedValueOnce(false);

      await expect(service.shareBrief(nonImpersonatingReq, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'NO_MAILING_LIST' });
      expect(createNewsletterMock).not.toHaveBeenCalled();
    });

    it('throws 409 BACKEND_NOT_LIVE when WEEKLY_BRIEF_BACKEND is not "live" — checked only after every other precondition passes', async () => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      mockShareableBrief();

      await expect(service.shareBrief(nonImpersonatingReq, 'committee-1', 1)).rejects.toMatchObject({ statusCode: 409, code: 'BACKEND_NOT_LIVE' });
      expect(createNewsletterMock).not.toHaveBeenCalled();
    });
  });
});
