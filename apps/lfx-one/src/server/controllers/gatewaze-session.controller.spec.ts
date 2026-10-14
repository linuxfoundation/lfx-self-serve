// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getGatewazeMe, endGatewazeSession, resolveConfig, loggerMock } = vi.hoisted(() => ({
  getGatewazeMe: vi.fn(),
  endGatewazeSession: vi.fn(),
  resolveConfig: vi.fn(),
  loggerMock: { startOperation: vi.fn(() => 0), success: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/gatewaze-session.service', () => ({
  getGatewazeSessionService: () => ({ getGatewazeMe, endGatewazeSession }),
  resolveGatewazeHostSessionConfig: resolveConfig,
  isGatewazeHostSessionEnabled: () => true,
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMock }));

import { GatewazeSessionController } from './gatewaze-session.controller';

// Synthetic values only.
const SITE = 'https://app.example.test';
const ANON_KEY = 'sb_publishable_synthetic';
const USER = { id: 'gw-user-synthetic', email: 'synthetic.user@example.test' };

interface Captured {
  status?: number;
  body?: unknown;
  headers: Record<string, string>;
  ended: boolean;
}

function call(method: 'me' | 'logout', headers: Record<string, string> = {}): Promise<{ out: Captured; next: ReturnType<typeof vi.fn> }> {
  const out: Captured = { headers: {}, ended: false };
  const res = {
    setHeader: (name: string, value: string) => (out.headers[name.toLowerCase()] = value),
    status: (code: number) => {
      out.status = code;
      return res;
    },
    json: (body: unknown) => {
      out.body = body;
      out.status ??= 200;
      return res;
    },
    end: () => {
      out.ended = true;
      return res;
    },
  } as unknown as Response;
  const req = { path: `/session/${method}`, get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const next = vi.fn();
  return new GatewazeSessionController()[method](req, res, next as unknown as NextFunction).then(() => ({ out, next }));
}

describe('GatewazeSessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PCC_BASE_URL', `${SITE}/`);
    resolveConfig.mockReturnValue({ supabaseUrl: 'https://supabase.example.test', anonKey: ANON_KEY, valkeyUrl: 'redis://x', authSecret: 's' });
  });

  afterEach(() => vi.unstubAllEnvs());

  describe('me (the /session/me contract table)', () => {
    it('answers 200 { user } for an admin session', async () => {
      getGatewazeMe.mockResolvedValue({ outcome: 'ok', user: USER });

      const { out, next } = await call('me');

      expect(out).toMatchObject({ status: 200, body: { user: USER } });
      expect(next).not.toHaveBeenCalled();
      expect(loggerMock.success).toHaveBeenCalledWith(expect.anything(), 'get_gatewaze_session_me', 0, { status_code: 200 });
    });

    it('answers 403 not_admin with the email', async () => {
      getGatewazeMe.mockResolvedValue({ outcome: 'not_admin', email: USER.email });

      const { out } = await call('me');

      expect(out).toMatchObject({ status: 403, body: { error: 'not_admin', email: USER.email } });
    });

    it('answers 503 admin_check_pending with Retry-After', async () => {
      getGatewazeMe.mockResolvedValue({ outcome: 'admin_check_pending', retryAfterSeconds: 17 });

      const { out } = await call('me');

      expect(out).toMatchObject({ status: 503, body: { error: 'admin_check_pending' }, headers: { 'retry-after': '17' } });
    });

    it('answers 401 with the x-gw-session expiry marker when the session ended', async () => {
      getGatewazeMe.mockResolvedValue({ outcome: 'ended' });

      const { out } = await call('me');

      expect(out).toMatchObject({ status: 401, headers: { 'x-gw-session': 'expired' } });
    });

    it.each(['unavailable', 'refused'])('answers 503 session_unavailable, never 401 or the marker, for %s', async (outcome) => {
      getGatewazeMe.mockResolvedValue({ outcome });

      const { out } = await call('me');

      expect(out).toMatchObject({ status: 503, body: { error: 'session_unavailable' } });
      expect(out.headers['x-gw-session']).toBeUndefined();
    });

    it('hands host_session_unavailable to the uniform 404', async () => {
      getGatewazeMe.mockResolvedValue({ outcome: 'host_session_unavailable' });

      const { out, next } = await call('me');

      expect(out.status).toBeUndefined();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
    });

    it('passes an unexpected error to next without logging it', async () => {
      const error = new Error('synthetic');
      getGatewazeMe.mockRejectedValue(error);

      const { next } = await call('me');

      expect(next).toHaveBeenCalledWith(error);
      expect(loggerMock.error).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const sameSite = { origin: SITE, apikey: ANON_KEY };

    it('ends the session without the sign-out marker and answers 204', async () => {
      endGatewazeSession.mockResolvedValue({ found: true, revoked: true, deleted: true });

      const { out } = await call('logout', sameSite);

      expect(out).toMatchObject({ status: 204, ended: true });
      expect(endGatewazeSession).toHaveBeenCalledOnce();
      expect(endGatewazeSession).toHaveBeenCalledWith(expect.anything(), { blockReMint: false });
    });

    it('still answers 204 when GoTrue did not revoke', async () => {
      endGatewazeSession.mockResolvedValue({ found: true, revoked: false, deleted: true });

      const { out } = await call('logout', sameSite);

      expect(out).toMatchObject({ status: 204, ended: true });
      expect(loggerMock.success).toHaveBeenCalledWith(expect.anything(), 'gatewaze_session_logout', 0, expect.objectContaining({ revoked: false }));
    });

    it('accepts a request with no Origin when the apikey matches', async () => {
      endGatewazeSession.mockResolvedValue({ found: false, revoked: false, deleted: false });

      const { out } = await call('logout', { apikey: ANON_KEY });

      expect(out.status).toBe(204);
    });

    it.each([
      ['a cross-site Origin', { origin: 'https://evil.example.test', apikey: ANON_KEY }],
      ['a missing apikey', { origin: SITE }],
      ['a wrong apikey', { origin: SITE, apikey: 'sb_publishable_other' }],
    ])('refuses %s with 403 and ends nothing', async (_label, headers) => {
      const { out } = await call('logout', headers);

      expect(out).toMatchObject({ status: 403, body: { error: 'cross_site' } });
      expect(endGatewazeSession).not.toHaveBeenCalled();
    });

    it('fails closed when PCC_BASE_URL is not a URL', async () => {
      vi.stubEnv('PCC_BASE_URL', '');

      const { out } = await call('logout', sameSite);

      expect(out.status).toBe(403);
      expect(endGatewazeSession).not.toHaveBeenCalled();
    });
  });
});
