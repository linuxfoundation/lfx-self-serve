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
  socialListeningSvc: { getMentionsFeed: vi.fn(), getMentionsTags: vi.fn() },
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

  describe('getMentionsFeed — endpoint wiring', () => {
    it('forwards the parsed scope and pagination to the service', async () => {
      socialListeningSvc.getMentionsFeed.mockResolvedValue({ mentions: [], computedAt: '2026-08-24T00:00:00Z' });
      const res = buildRes();

      await controller.getMentionsFeed(buildReq({ query: { foundationSlug: 'linuxfoundation' } }), res, next);

      expect(socialListeningSvc.getMentionsFeed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ foundationSlug: 'linuxfoundation' }));
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('400s via the real param helper when foundationSlug is missing', async () => {
      await controller.getMentionsFeed(buildReq({ query: {} }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(socialListeningSvc.getMentionsFeed).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      const failure = new Error('snowflake down');
      socialListeningSvc.getMentionsFeed.mockRejectedValue(failure);

      await controller.getMentionsFeed(buildReq({ query: { foundationSlug: 'linuxfoundation' } }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(failure);
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
});
