// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildAuthStateCacheKey, valkeyService, VALKEY_CACHE } = vi.hoisted(() => ({
  buildAuthStateCacheKey: vi.fn<(state: string) => string | null>(),
  valkeyService: {
    isEnabled: vi.fn(),
    getJson: vi.fn(),
    setJson: vi.fn(),
    del: vi.fn(),
  },
  // See session-store.service.spec.ts for why `@lfx-one/shared/constants` is mocked directly:
  // the barrel it resolves through transitively pulls in `@angular/common`.
  VALKEY_CACHE: { AUTH_STATE_TTL_SECONDS: 600, AUTH_STATE_OP_TIMEOUT_MS: 3000 },
}));

vi.mock('./valkey.service', () => ({ buildAuthStateCacheKey, valkeyService }));
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

import { AuthStateService } from './auth-state.service';

function buildReq(overrides: Partial<Request> = {}): Request {
  return { appSession: {}, oidc: undefined, ...overrides } as unknown as Request;
}

describe('AuthStateService', () => {
  let service: AuthStateService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthStateService();
    buildAuthStateCacheKey.mockImplementation((state: string) => (state === 'unsafe' ? null : `lfx-ui:auth-state:v1:${state}`));
  });

  describe('issue', () => {
    it('writes a record via setJson with the derived key and TTL, and returns a 64-hex nonce', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.setJson.mockResolvedValue(true);
      const req = buildReq();

      const state = await service.issue(req, 'sub-1', '/profile/identities');

      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(valkeyService.setJson).toHaveBeenCalledWith(
        `lfx-ui:auth-state:v1:${state}`,
        { sub: 'sub-1', returnTo: '/profile/identities', createdAt: expect.any(Number) },
        VALKEY_CACHE.AUTH_STATE_TTL_SECONDS,
        VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS
      );
    });

    it('falls back to req.appSession when Valkey is disabled', async () => {
      valkeyService.isEnabled.mockReturnValue(false);
      const req = buildReq();

      const state = await service.issue(req, 'sub-1', '/profile/identities');

      expect(valkeyService.setJson).not.toHaveBeenCalled();
      expect(req.appSession?.['profileAuthState']).toBe(state);
      expect(req.appSession?.['profileAuthReturnTo']).toBe('/profile/identities');
    });

    it('falls back to req.appSession when the Valkey write fails', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.setJson.mockResolvedValue(false);
      const req = buildReq();

      const state = await service.issue(req, 'sub-1');

      expect(req.appSession?.['profileAuthState']).toBe(state);
      expect(req.appSession?.['profileAuthReturnTo']).toBeUndefined();
    });
  });

  describe('consume', () => {
    it('returns the record and deletes the key exactly once (single-use)', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      const record = { sub: 'sub-1', returnTo: '/x', createdAt: 123 };
      valkeyService.getJson.mockResolvedValue(record);
      valkeyService.del.mockResolvedValue(true);
      const req = buildReq();

      await expect(service.consume(req, 'nonce-1')).resolves.toEqual(record);
      expect(valkeyService.del).toHaveBeenCalledTimes(1);
      expect(valkeyService.del).toHaveBeenCalledWith('lfx-ui:auth-state:v1:nonce-1', VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
    });

    it('returns null for an undefined state without calling Valkey', async () => {
      const req = buildReq();
      await expect(service.consume(req, undefined)).resolves.toBeNull();
      expect(valkeyService.getJson).not.toHaveBeenCalled();
    });

    it('returns null for an unsafe nonce without calling Valkey, then falls back to the session (also empty)', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      const req = buildReq();

      await expect(service.consume(req, 'unsafe')).resolves.toBeNull();
      expect(valkeyService.getJson).not.toHaveBeenCalled();
    });

    it('deletes and returns null for a malformed record', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.getJson.mockResolvedValue(null); // getJson's accept() guard already rejected it
      valkeyService.del.mockResolvedValue(true);
      const req = buildReq();

      await expect(service.consume(req, 'nonce-1')).resolves.toBeNull();
      expect(valkeyService.del).toHaveBeenCalledTimes(1);
    });

    it('falls back to the session when Valkey is disabled, deleting the fields and binding sub to the live oidc user', async () => {
      valkeyService.isEnabled.mockReturnValue(false);
      const req = buildReq({
        appSession: { profileAuthState: 'nonce-1', profileAuthReturnTo: '/y' },
        oidc: { user: { sub: 'sub-2' } },
      } as unknown as Partial<Request>);

      const record = await service.consume(req, 'nonce-1');

      expect(record).toEqual({ sub: 'sub-2', returnTo: '/y', createdAt: expect.any(Number) });
      expect(req.appSession?.['profileAuthState']).toBeUndefined();
      expect(req.appSession?.['profileAuthReturnTo']).toBeUndefined();
    });

    it('session fallback rejects a mismatched nonce', async () => {
      valkeyService.isEnabled.mockReturnValue(false);
      const req = buildReq({ appSession: { profileAuthState: 'nonce-1' } } as unknown as Partial<Request>);

      await expect(service.consume(req, 'other-nonce')).resolves.toBeNull();
    });
  });
});
