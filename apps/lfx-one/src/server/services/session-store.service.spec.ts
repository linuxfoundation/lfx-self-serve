// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { SessionStorePayload } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from '../errors';

const { buildSessionCacheKey, valkeyService, VALKEY_CACHE } = vi.hoisted(() => ({
  buildSessionCacheKey: vi.fn<(sid: string) => string | null>(),
  valkeyService: {
    getJson: vi.fn(),
    setJson: vi.fn(),
    del: vi.fn(),
  },
  // `@lfx-one/shared/constants` resolves (under this repo's vitest setup, via the
  // `@lfx-one/shared/*` tsconfig path alias to TS source rather than the compiled `dist`
  // package.json export) through a barrel that transitively pulls in `@angular/common`,
  // which fails outside an Angular build/test context. Mock just the two values this spec
  // and the service under test actually need, mirroring valkey-cache.constants.ts, instead
  // of depending on the real module graph resolving.
  VALKEY_CACHE: { SESSION_EXPIRED_TTL_SECONDS: 1, SESSION_FALLBACK_TTL_SECONDS: 7 * 24 * 60 * 60 },
}));

vi.mock('./valkey.service', () => ({ buildSessionCacheKey, valkeyService }));
vi.mock('@lfx-one/shared/constants', () => ({ VALKEY_CACHE }));

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

import { SessionStoreService } from './session-store.service';

function buildPayload(overrides: Partial<SessionStorePayload> = {}): SessionStorePayload {
  return {
    header: { iat: 1000, uat: 1000, exp: 2000 },
    data: { id_token: 'a', access_token: 'b', refresh_token: 'c', token_type: 'Bearer', expires_at: '2000' },
    cookie: { expires: 123, maxAge: 60_000 },
    ...overrides,
  };
}

describe('SessionStoreService', () => {
  let service: SessionStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SessionStoreService();
    buildSessionCacheKey.mockImplementation((sid: string) => (sid === 'unsafe' ? null : `lfx-ui:session:v1:${sid}`));
  });

  describe('get', () => {
    it('resolves the promise form with the stored session on a hit', async () => {
      const payload = buildPayload();
      valkeyService.getJson.mockResolvedValue(payload);

      await expect(service.get('sid-1')).resolves.toEqual(payload);
      expect(valkeyService.getJson).toHaveBeenCalledWith('lfx-ui:session:v1:sid-1', expect.any(Function));
    });

    it('invokes the callback form with (null, session) on a hit', async () => {
      const payload = buildPayload();
      valkeyService.getJson.mockResolvedValue(payload);

      const [err, session] = await new Promise<[unknown, SessionStorePayload | null | undefined]>((resolve) => {
        service.get('sid-1', (err, session) => resolve([err, session]));
      });
      expect(err).toBeNull();
      expect(session).toEqual(payload);
    });

    it('invokes the callback form with the error when the read rejects', async () => {
      const boom = new Error('boom');
      valkeyService.getJson.mockRejectedValue(boom);

      const [err] = await new Promise<[unknown]>((resolve) => {
        service.get('sid-1', (err) => resolve([err]));
      });
      expect(err).toBe(boom);
    });

    it('fails closed to null without calling Valkey when the session id is not filter-safe', async () => {
      await expect(service.get('unsafe')).resolves.toBeNull();
      expect(valkeyService.getJson).not.toHaveBeenCalled();
    });

    it('passes an accept() guard to getJson that rejects a malformed cached payload', async () => {
      valkeyService.getJson.mockResolvedValue(null);
      await service.get('sid-1');

      const accept = valkeyService.getJson.mock.calls[0][1] as (value: unknown) => boolean;

      expect(accept(buildPayload())).toBe(true);
      expect(accept(null)).toBe(false);
      expect(accept({})).toBe(false);
      expect(accept({ ...buildPayload(), header: undefined })).toBe(false);
      expect(accept({ ...buildPayload(), data: null })).toBe(false);
      expect(accept({ ...buildPayload(), cookie: {} })).toBe(false);
      expect(accept({ ...buildPayload(), header: { iat: '1000', uat: 1000, exp: 2000 } })).toBe(false);
    });
  });

  describe('set', () => {
    it('probe-safety: treats a call with no session as a no-op instead of writing undefined', async () => {
      await expect(service.set('sid-1')).resolves.toBeUndefined();
      expect(valkeyService.setJson).not.toHaveBeenCalled();
    });

    it('probe-safety: invokes the callback immediately when session is omitted', () => {
      const callback = vi.fn();
      service.set('sid-1', undefined, callback);
      expect(callback).toHaveBeenCalledWith();
      expect(valkeyService.setJson).not.toHaveBeenCalled();
    });

    it('persists a valid session and resolves (promise form) on success', async () => {
      valkeyService.setJson.mockResolvedValue(true);
      const payload = buildPayload();

      await expect(service.set('sid-1', payload)).resolves.toBeUndefined();
      expect(valkeyService.setJson).toHaveBeenCalledWith('lfx-ui:session:v1:sid-1', payload, 60);
    });

    it('invokes the callback form with no args on a successful write', async () => {
      valkeyService.setJson.mockResolvedValue(true);

      const [err] = await new Promise<[unknown]>((resolve) => {
        service.set('sid-1', buildPayload(), (err) => resolve([err]));
      });
      expect(err).toBeUndefined();
    });

    it('fails closed with a clearSession AuthenticationError when the session id is not filter-safe', async () => {
      await expect(service.set('unsafe', buildPayload())).rejects.toMatchObject({
        constructor: AuthenticationError,
        clearSession: true,
      });
      expect(valkeyService.setJson).not.toHaveBeenCalled();
    });

    it('fails closed and invalidates the stale key on a write failure, even when invalidation succeeds', async () => {
      valkeyService.setJson.mockResolvedValue(false);
      valkeyService.del.mockResolvedValue(true);

      await expect(service.set('sid-1', buildPayload())).rejects.toBeInstanceOf(AuthenticationError);
      await expect(service.set('sid-1', buildPayload())).rejects.toMatchObject({ clearSession: true });
      expect(valkeyService.del).toHaveBeenCalledTimes(2); // one per rejected set() call above
    });

    it('retries invalidation exactly once more when the first del() attempt fails', async () => {
      valkeyService.setJson.mockResolvedValue(false);
      valkeyService.del.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(service.set('sid-1', buildPayload())).rejects.toBeInstanceOf(AuthenticationError);
      expect(valkeyService.del).toHaveBeenCalledTimes(2);
    });

    it('still fails closed (throws) even when both invalidation attempts fail', async () => {
      valkeyService.setJson.mockResolvedValue(false);
      valkeyService.del.mockResolvedValue(false);

      await expect(service.set('sid-1', buildPayload())).rejects.toBeInstanceOf(AuthenticationError);
      expect(valkeyService.del).toHaveBeenCalledTimes(2);
    });

    describe('ttlSecondsFor', () => {
      it('derives the TTL (seconds) from a positive cookie.maxAge (ms), rounding up', async () => {
        valkeyService.setJson.mockResolvedValue(true);
        await service.set('sid-1', buildPayload({ cookie: { expires: 0, maxAge: 1500 } }));
        expect(valkeyService.setJson).toHaveBeenCalledWith(expect.any(String), expect.anything(), 2);
      });

      it('falls back to SESSION_EXPIRED_TTL_SECONDS for a non-positive maxAge', async () => {
        valkeyService.setJson.mockResolvedValue(true);
        await service.set('sid-1', buildPayload({ cookie: { expires: 0, maxAge: 0 } }));
        expect(valkeyService.setJson).toHaveBeenCalledWith(expect.any(String), expect.anything(), VALKEY_CACHE.SESSION_EXPIRED_TTL_SECONDS);

        await service.set('sid-1', buildPayload({ cookie: { expires: 0, maxAge: -10 } }));
        expect(valkeyService.setJson).toHaveBeenLastCalledWith(expect.any(String), expect.anything(), VALKEY_CACHE.SESSION_EXPIRED_TTL_SECONDS);
      });

      it('falls back to SESSION_FALLBACK_TTL_SECONDS when cookie metadata is missing/malformed', async () => {
        valkeyService.setJson.mockResolvedValue(true);
        const payload = buildPayload();
        // @ts-expect-error deliberately malformed for the fallback path
        delete payload.cookie.maxAge;

        await service.set('sid-1', payload);
        expect(valkeyService.setJson).toHaveBeenCalledWith(expect.any(String), expect.anything(), VALKEY_CACHE.SESSION_FALLBACK_TTL_SECONDS);
      });
    });
  });

  describe('destroy', () => {
    it('deletes the underlying key (promise form)', async () => {
      valkeyService.del.mockResolvedValue(true);

      await expect(service.destroy('sid-1')).resolves.toBeUndefined();
      expect(valkeyService.del).toHaveBeenCalledWith('lfx-ui:session:v1:sid-1');
    });

    it('invokes the callback form with no args regardless of delete outcome', async () => {
      valkeyService.del.mockResolvedValue(false);

      const [err] = await new Promise<[unknown]>((resolve) => {
        service.destroy('sid-1', (err) => resolve([err]));
      });
      expect(err).toBeUndefined();
    });

    it('is fail-soft: does not throw when the underlying delete fails', async () => {
      valkeyService.del.mockResolvedValue(false);
      await expect(service.destroy('sid-1')).resolves.toBeUndefined();
    });

    it('no-ops without calling Valkey when the session id is not filter-safe', async () => {
      await expect(service.destroy('unsafe')).resolves.toBeUndefined();
      expect(valkeyService.del).not.toHaveBeenCalled();
    });
  });
});
