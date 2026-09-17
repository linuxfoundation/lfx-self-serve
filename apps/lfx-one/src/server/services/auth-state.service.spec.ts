// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildAuthStateCacheKey, valkeyService, VALKEY_CACHE } = vi.hoisted(() => ({
  buildAuthStateCacheKey: vi.fn<(state: string) => string | null>(),
  valkeyService: {
    isEnabled: vi.fn(),
    getdelJson: vi.fn(),
    setJson: vi.fn(),
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
      expect(req.appSession?.['profileAuthSub']).toBe('sub-1');
    });

    it('does NOT fall back to the session when the Valkey write outcome is uncertain, to avoid a dual-write (#1938 review)', async () => {
      // `setJson` returning false doesn't prove the SET never landed (a client-side timeout races the
      // real write). Also writing the nonce to the session here would risk a later `consume()` fault
      // accepting a stale session duplicate as fresh even though the Valkey copy was already consumed
      // once — breaking single-use. The fix fails closed: no session copy, nonce issued via Valkey only.
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.setJson.mockResolvedValue(false);
      const req = buildReq();

      const state = await service.issue(req, 'sub-1');

      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(req.appSession?.['profileAuthState']).toBeUndefined();
      expect(req.appSession?.['profileAuthReturnTo']).toBeUndefined();
    });

    it('clears a stale session-stored nonce even when the Valkey write outcome is uncertain (#1938 review)', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.setJson.mockResolvedValue(false);
      const req = buildReq({ appSession: { profileAuthState: 'old-nonce', profileAuthReturnTo: '/old' } } as unknown as Partial<Request>);

      await service.issue(req, 'sub-1');

      expect(req.appSession?.['profileAuthState']).toBeUndefined();
      expect(req.appSession?.['profileAuthReturnTo']).toBeUndefined();
    });
  });

  describe('consume', () => {
    it('returns the record via a single atomic getdelJson call (single-use)', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      const record = { sub: 'sub-1', returnTo: '/x', createdAt: 123 };
      valkeyService.getdelJson.mockResolvedValue({ status: 'hit', value: record });
      const req = buildReq();

      await expect(service.consume(req, 'nonce-1')).resolves.toEqual(record);
      expect(valkeyService.getdelJson).toHaveBeenCalledTimes(1);
      expect(valkeyService.getdelJson).toHaveBeenCalledWith('lfx-ui:auth-state:v1:nonce-1', expect.any(Function), VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
    });

    it('returns null for an undefined state without calling Valkey', async () => {
      const req = buildReq();
      await expect(service.consume(req, undefined)).resolves.toBeNull();
      expect(valkeyService.getdelJson).not.toHaveBeenCalled();
    });

    it('returns null for an unsafe nonce without calling Valkey, then falls back to the session (also empty)', async () => {
      valkeyService.isEnabled.mockReturnValue(true);
      const req = buildReq();

      await expect(service.consume(req, 'unsafe')).resolves.toBeNull();
      expect(valkeyService.getdelJson).not.toHaveBeenCalled();
    });

    it('rejects a clean Valkey miss outright, without falling back to the session (#1938 review)', async () => {
      // A clean miss — expired, already consumed, or never existed — must be authoritative. Falling
      // back to the (TTL-less) session here would let a replayed or expired nonce succeed anyway.
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.getdelJson.mockResolvedValue({ status: 'miss' });
      const req = buildReq({ appSession: { profileAuthState: 'nonce-1' } } as unknown as Partial<Request>);

      await expect(service.consume(req, 'nonce-1')).resolves.toBeNull();
      expect(valkeyService.getdelJson).toHaveBeenCalledTimes(1);
      // Session is untouched — the miss short-circuits before consumeFromSession runs.
      expect(req.appSession?.['profileAuthState']).toBe('nonce-1');
    });

    it('rejects a faulted Valkey read outright, without falling back to the session (#2604 review)', async () => {
      // A GETDEL fault means the destructive delete's true outcome is unknown — it may have landed
      // server-side after the client timed out. Falling back to the (TTL-less) session here could
      // accept a stale nonce Valkey already consumed, so a fault must fail closed like a miss.
      valkeyService.isEnabled.mockReturnValue(true);
      valkeyService.getdelJson.mockResolvedValue({ status: 'fault' });
      const req = buildReq({
        appSession: { profileAuthState: 'nonce-1', profileAuthReturnTo: '/y' },
        oidc: { user: { sub: 'sub-2' } },
      } as unknown as Partial<Request>);

      await expect(service.consume(req, 'nonce-1')).resolves.toBeNull();
      // Session is untouched — the fault short-circuits before consumeFromSession runs.
      expect(req.appSession?.['profileAuthState']).toBe('nonce-1');
    });

    it('falls back to the session when Valkey is disabled, binding sub to the issuing user rather than the live oidc user (copilot review, PR #2604)', async () => {
      // The stored sub is from issue()-time, deliberately different from the callback's live oidc
      // user — proves the fallback no longer re-derives sub from req.oidc, which would make the
      // caller's same-sub CSRF check always pass.
      valkeyService.isEnabled.mockReturnValue(false);
      const req = buildReq({
        appSession: { profileAuthState: 'nonce-1', profileAuthReturnTo: '/y', profileAuthSub: 'sub-1' },
        oidc: { user: { sub: 'sub-2' } },
      } as unknown as Partial<Request>);

      const record = await service.consume(req, 'nonce-1');

      expect(record).toEqual({ sub: 'sub-1', returnTo: '/y', createdAt: expect.any(Number) });
      expect(req.appSession?.['profileAuthState']).toBeUndefined();
      expect(req.appSession?.['profileAuthReturnTo']).toBeUndefined();
      expect(req.appSession?.['profileAuthSub']).toBeUndefined();
    });

    it('session fallback rejects a mismatched nonce without deleting the still-pending stored one (#1938 review)', async () => {
      valkeyService.isEnabled.mockReturnValue(false);
      const req = buildReq({ appSession: { profileAuthState: 'nonce-1' } } as unknown as Partial<Request>);

      await expect(service.consume(req, 'other-nonce')).resolves.toBeNull();
      expect(req.appSession?.['profileAuthState']).toBe('nonce-1');
    });
  });
});
