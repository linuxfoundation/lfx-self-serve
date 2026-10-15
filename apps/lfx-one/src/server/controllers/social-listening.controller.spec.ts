// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';

// The shared barrels transitively reach Angular's partially-compiled @angular/common; under vitest
// that needs the JIT compiler, so load it before the module under test (mirrors the params-helper spec).
import '@angular/compiler';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { userPreferenceSvc, socialListeningSvc, logger } = vi.hoisted(() => ({
  userPreferenceSvc: { getPreference: vi.fn(), upsertPreference: vi.fn(), deletePreference: vi.fn() },
  socialListeningSvc: {
    getMentionsFeed: vi.fn(),
    getMentionsCount: vi.fn(),
    getMentionsTags: vi.fn(),
    getAnalyticsOverview: vi.fn(),
    getAnalyticsOverTime: vi.fn(),
    getAnalyticsPlatformDistribution: vi.fn(),
    getAnalyticsSentimentDistribution: vi.fn(),
    getAnalyticsTopProjects: vi.fn(),
  },
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), etag: vi.fn() },
}));

vi.mock('../services/user-preference.service', () => ({
  UserPreferenceService: vi.fn(function () {
    return userPreferenceSvc;
  }),
}));
vi.mock('../services/social-listening.service', () => ({
  SocialListeningService: vi.fn(function () {
    return socialListeningSvc;
  }),
}));
vi.mock('../services/logger.service', () => ({ logger }));

// `isSocialListeningPreferenceName` + SOCIAL_LISTENING_PREFERENCE_APP_NAME load for real (JIT import
// above) — faking the allowlist would let these tests pass against a broken name guard. Feed param
// validation itself is covered by social-listening-params.helper.spec.ts; the impersonation write-block
// lives in route middleware, outside this controller.
import { SocialListeningController } from './social-listening.controller';

const VALID_NAME = 'Social Listening Bookmarks - a0eeb0a1-0000-0000-0000-000000000001';

function buildReq(overrides: Record<string, unknown> = {}): any {
  return { params: {}, query: {}, body: undefined, path: '/test', log: {}, ...overrides };
}

function buildRes(): any {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
}

describe('SocialListeningController', () => {
  let controller: SocialListeningController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SocialListeningController();
    next = vi.fn() as unknown as NextFunction;
  });

  describe('getPreference', () => {
    it('returns the stored value for an allowlisted preference name', async () => {
      userPreferenceSvc.getPreference.mockResolvedValue('{"ids":["m1"]}');
      const res = buildRes();

      await controller.getPreference(buildReq({ params: { name: VALID_NAME } }), res, next);

      expect(userPreferenceSvc.getPreference).toHaveBeenCalledWith(expect.anything(), 'PCC', VALID_NAME);
      expect(res.json).toHaveBeenCalledWith({ name: VALID_NAME, value: '{"ids":["m1"]}' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns value: null when the preference does not exist', async () => {
      userPreferenceSvc.getPreference.mockResolvedValue(null);
      const res = buildRes();

      await controller.getPreference(buildReq({ params: { name: VALID_NAME } }), res, next);

      expect(res.json).toHaveBeenCalledWith({ name: VALID_NAME, value: null });
      expect(next).not.toHaveBeenCalled();
    });

    it('400s on a name outside the allowlist without calling the service', async () => {
      await controller.getPreference(buildReq({ params: { name: 'Admin Settings - p1' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.getPreference).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      const failure = new Error('upstream down');
      userPreferenceSvc.getPreference.mockRejectedValue(failure);

      await controller.getPreference(buildReq({ params: { name: VALID_NAME } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(failure);
    });
  });

  describe('upsertPreference', () => {
    it('upserts a valid JSON value and echoes it back', async () => {
      userPreferenceSvc.upsertPreference.mockResolvedValue(undefined);
      const res = buildRes();
      const value = '{"ids":["m1"]}';

      await controller.upsertPreference(buildReq({ params: { name: VALID_NAME }, body: { value } }), res, next);

      expect(userPreferenceSvc.upsertPreference).toHaveBeenCalledWith(expect.anything(), 'PCC', VALID_NAME, value);
      expect(res.json).toHaveBeenCalledWith({ name: VALID_NAME, value });
      expect(next).not.toHaveBeenCalled();
    });

    it('400s when the body is not { value: string }', async () => {
      await controller.upsertPreference(buildReq({ params: { name: VALID_NAME }, body: { value: 42 } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.upsertPreference).not.toHaveBeenCalled();
    });

    it('400s when value is not valid JSON', async () => {
      await controller.upsertPreference(buildReq({ params: { name: VALID_NAME }, body: { value: '{nope' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.upsertPreference).not.toHaveBeenCalled();
    });

    it('400s when value exceeds the server-side size cap', async () => {
      const value = `"${'x'.repeat(64_000)}"`;

      await controller.upsertPreference(buildReq({ params: { name: VALID_NAME }, body: { value } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.upsertPreference).not.toHaveBeenCalled();
    });

    it('400s on a blocked name even when the value is well-formed', async () => {
      await controller.upsertPreference(buildReq({ params: { name: 'Nope' }, body: { value: '{}' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.upsertPreference).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      const failure = new Error('upstream down');
      userPreferenceSvc.upsertPreference.mockRejectedValue(failure);

      await controller.upsertPreference(buildReq({ params: { name: VALID_NAME }, body: { value: '{}' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(failure);
    });
  });

  describe('deletePreference', () => {
    it('deletes and responds with value: null (idempotent)', async () => {
      userPreferenceSvc.deletePreference.mockResolvedValue(undefined);
      const res = buildRes();

      await controller.deletePreference(buildReq({ params: { name: VALID_NAME } }), res, next);

      expect(userPreferenceSvc.deletePreference).toHaveBeenCalledWith(expect.anything(), 'PCC', VALID_NAME);
      expect(res.json).toHaveBeenCalledWith({ name: VALID_NAME, value: null });
      expect(next).not.toHaveBeenCalled();
    });

    it('400s on a blocked name without calling the service', async () => {
      await controller.deletePreference(buildReq({ params: { name: '' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(userPreferenceSvc.deletePreference).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      const failure = new Error('upstream down');
      userPreferenceSvc.deletePreference.mockRejectedValue(failure);

      await controller.deletePreference(buildReq({ params: { name: VALID_NAME } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(failure);
    });
  });

  describe.each(['getMentionsFeed', 'getMentionsCount'] as const)('%s JSON boundary', (method) => {
    it.each([{}, { foundationSlug: 'invalid_slug' }, { foundationSlug: 42 }])('rejects invalid body scope before data access', async (body) => {
      await controller[method](buildReq({ body, query: { foundationSlug: 'synthetic-owned' } }), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(socialListeningSvc[method]).not.toHaveBeenCalled();
    });

    it('rejects a missing body even when query scope is valid', async () => {
      await controller[method](buildReq({ query: { foundationSlug: 'synthetic-owned' } }), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(socialListeningSvc[method]).not.toHaveBeenCalled();
    });

    it('forwards service failures to central error handling', async () => {
      const failure = new Error('snowflake down');
      socialListeningSvc[method].mockRejectedValue(failure);
      const res = buildRes();
      await controller[method](buildReq({ body: { foundationSlug: 'synthetic-owned' } }), res, next);
      expect(next).toHaveBeenCalledWith(failure);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getMentionsTags — endpoint wiring', () => {
    it('drops caller-supplied bookmark/read-state params — tags stay read-state-blind', async () => {
      socialListeningSvc.getMentionsTags.mockResolvedValue([]);
      const res = buildRes();

      await controller.getMentionsTags(
        buildReq({
          query: {
            foundationSlug: 'linuxfoundation',
            sentiment: 'negative',
            mentionIds: ['m1'],
            unreadOnly: 'true',
            readIds: ['m2'],
            unreadIds: ['m3'],
            readBeforeTs: '2026-08-01 12:00:00',
          },
        }),
        res,
        next
      );

      const params = socialListeningSvc.getMentionsTags.mock.calls[0][1];
      expect(params).toMatchObject({ foundationSlug: 'linuxfoundation', sentiment: 'negative' });
      expect(params).not.toHaveProperty('mentionIds');
      expect(params).not.toHaveProperty('unreadOnly');
      expect(params).not.toHaveProperty('readIds');
      expect(params).not.toHaveProperty('unreadIds');
      expect(params).not.toHaveProperty('readBeforeTs');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe.each([
    'getAnalyticsOverview',
    'getAnalyticsOverTime',
    'getAnalyticsPlatformDistribution',
    'getAnalyticsSentimentDistribution',
    'getAnalyticsTopProjects',
  ] as const)('%s — request boundary', (method) => {
    beforeEach(() => {
      socialListeningSvc[method].mockReset();
      socialListeningSvc[method].mockResolvedValue(method === 'getAnalyticsOverview' ? { TOTAL_MENTIONS: 0 } : []);
    });

    it('serves analytics despite malformed stale content filters instead of sending a validation error', async () => {
      const res = buildRes();

      await controller[method](
        buildReq({
          query: {
            foundationSlug: 'cncf',
            period: 'ytd',
            sentiment: 'bogus',
            relevance: 'bogus',
            hasTitle: 'bogus',
            language: 'x'.repeat(201),
            search: 'x'.repeat(501),
            authors: Array.from({ length: 201 }, () => 'alice'),
            keywords: ['x'.repeat(201)],
            tags: ['x'.repeat(201)],
            readBeforeTs: 'not-a-timestamp',
          },
        }),
        res,
        next
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledTimes(1);
    });

    it.each([
      { query: { foundationSlug: 'cncf', period: 'not-a-period' }, field: 'period' },
      { query: { period: 'ytd' }, field: 'foundationSlug' },
      { query: { foundationSlug: 'bad_slug' }, field: 'foundationSlug' },
      { query: { foundationSlug: 'cncf', sourceProjectId: 'x'.repeat(201) }, field: 'sourceProjectId' },
      { query: { foundationSlug: 'cncf', platform: 'x'.repeat(201) }, field: 'platform' },
    ])('routes invalid $field to the 400 error path without serving analytics', async ({ query, field }) => {
      const res = buildRes();

      await controller[method](buildReq({ query }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR', validationErrors: [expect.objectContaining({ field })] })
      );
      expect(socialListeningSvc[method]).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('routes a governed-read failure to the error handler without a partial success response', async () => {
      const failure = new Error('governed relation unavailable');
      socialListeningSvc[method].mockRejectedValueOnce(failure);
      const res = buildRes();

      await controller[method](buildReq({ query: { foundationSlug: 'cncf' } }), res, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(res.json).not.toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
    });
  });

  it('rejects a non-integer top-project limit even when content filters are ignored', async () => {
    const res = buildRes();

    await controller.getAnalyticsTopProjects(buildReq({ query: { foundationSlug: 'cncf', limit: '1.5', sentiment: 'bogus' } }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, validationErrors: [expect.objectContaining({ field: 'limit' })] }));
    expect(socialListeningSvc.getAnalyticsTopProjects).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('continues rejecting invalid content filters on the tags endpoint', async () => {
    const res = buildRes();

    await controller.getMentionsTags(buildReq({ query: { foundationSlug: 'cncf', sentiment: 'bogus' } }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, validationErrors: [expect.objectContaining({ field: 'sentiment' })] }));
    expect(socialListeningSvc.getMentionsTags).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
