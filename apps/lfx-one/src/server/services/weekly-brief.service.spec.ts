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
const { proxyRequest, proxyRequestWithResponse, MOCK_THROTTLE } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  MOCK_THROTTLE: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3 },
}));

vi.mock('@lfx-one/shared/constants', () => ({
  WEEKLY_BRIEF_DEFAULT_THROTTLE: MOCK_THROTTLE,
  WEEKLY_BRIEF_SHAREABLE_STATES: ['generated', 'edited', 'approved'],
  WEEKLY_BRIEF_ERROR_REASON: { NO_SOURCES: 'no_sources' },
  NEWSLETTER_SUBJECT_MAX_LENGTH: 200,
  NEWSLETTER_BODY_MAX_LENGTH: 100_000,
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

import type { Request } from 'express';

import { WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID } from '../constants';
import { MicroserviceError } from '../errors';

import { __resetMockBriefStateForTesting, briefWindow, WeeklyBriefService } from './weekly-brief.service';

const req = {} as unknown as Request;

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
    proxyRequest.mockReset();
    proxyRequestWithResponse.mockReset();
    process.env = { ...originalEnv };
    service = new WeeklyBriefService();
    __resetMockBriefStateForTesting();
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

    it('getCurrentBrief maps upstream error_reason onto the envelope (LFXV2-3000)', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'error', error_reason: 'no_sources' }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBe('no_sources');
    });

    it('getCurrentBrief ignores an unpinned `reason` field — only `error_reason` is normalized', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'error', reason: 'no_sources' }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBeUndefined();
    });

    it('getCurrentBrief leaves error_reason undefined when upstream sends no error_reason field', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'error' }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBeUndefined();
    });

    it('getCurrentBrief ignores a non-string error_reason value', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'error', error_reason: 42 }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBeUndefined();
    });

    it('getCurrentBrief does not normalize a `reason` field on a non-error state (only error_reason on state: error is normalized)', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'generated', reason: 'no_sources' }, throttle: null });

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result.brief?.error_reason).toBeUndefined();
    });

    it('getCurrentBrief leaves an already-present error_reason untouched on a non-error state — normalization only runs on state: error', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: { uid: 'b1', state: 'generated', error_reason: 'no_sources' }, throttle: null });

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

    it('generateBrief maps error_reason onto the 202 envelope too, in case upstream ever returns a terminal error there instead of `generating` (LFXV2-3000)', async () => {
      const data = { brief: { uid: 'b1', state: 'error', error_reason: 'no_sources' }, throttle: {} };
      proxyRequestWithResponse.mockResolvedValueOnce({ status: 202, data, statusText: 'Accepted', headers: {} });

      const result = await service.generateBrief(req, 'committee-1', { force: true });

      expect(result.data.brief?.error_reason).toBe('no_sources');
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
});
