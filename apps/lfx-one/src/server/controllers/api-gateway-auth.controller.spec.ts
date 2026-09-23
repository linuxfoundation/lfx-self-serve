// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/valkey.service', () => ({ valkeyService: { isEnabled: () => false }, buildAuthStateCacheKey: () => null }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { apiGatewayAuthService } from '../services/api-gateway-auth.service';
import { ApiGatewayAuthController } from './api-gateway-auth.controller';

describe('ApiGatewayAuthController', () => {
  const controller = new ApiGatewayAuthController();
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  function request(): Request {
    return {
      method: 'GET',
      query: {},
      appSession: { refresh_token: 'primary-refresh' },
      get: (name: string) => (name === 'Accept' ? 'text/html' : undefined),
      oidc: { isAuthenticated: () => true, user: { sub: 'auth0|synthetic-user' } },
    } as unknown as Request;
  }

  function response(): Response {
    return { redirect: vi.fn(), set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  }

  async function authorize(req: Request): Promise<string> {
    const url = new URL(await apiGatewayAuthService.getAuthorizationUrl(req, '/org/acme/easycla?tab=agreements'));
    return url.searchParams.get('state')!;
  }

  function token(sub = 'auth0|synthetic-user', audience = 'https://gateway.example/'): string {
    return `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({
        sub,
        aud: audience,
        iss: 'https://issuer.example/',
        azp: 'self-serve-client',
        scope: 'access:api',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url')}.signature`;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PCC_BASE_URL', 'https://self-serve.example');
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'self-serve-client');
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://issuer.example/');
    vi.stubEnv('API_GW_AUDIENCE', 'https://gateway.example/');
    fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(globalThis.Response.json({ access_token: token(), token_type: 'Bearer', expires_in: 3600, refresh_token: 'gateway-refresh' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts a navigation and returns to the sanitized path after successful code exchange', async () => {
    const req = request();
    req.query['returnTo'] = '/org/acme/easycla?tab=agreements';
    const res = response();
    const next = vi.fn() as NextFunction;
    await controller.start(req, res, next);
    const url = new URL(vi.mocked(res.redirect).mock.calls[0][0] as unknown as string);
    expect(url.searchParams.get('audience')).toBe('https://gateway.example/');
    req.query = { state: url.searchParams.get('state')!, code: 'synthetic-code', returnTo: 'https://outside.example' };
    await controller.callback(req, res, next);
    expect(res.redirect).toHaveBeenLastCalledWith('/org/acme/easycla?tab=agreements');
    expect(res.set).toHaveBeenCalledWith({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(res.redirect).mock.calls)).not.toContain('synthetic-code');
    expect(JSON.stringify(vi.mocked(res.redirect).mock.calls)).not.toContain(token());
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
  });

  it.each([undefined, 'forged', ['state', 'state']])('rejects an invalid state before processing a consent error (%j)', async (state) => {
    const req = request();
    const originalState = await authorize(req);
    req.query = { state, error: 'consent_required' };
    const res = response();
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledWith('/?api_gateway_error=invalid_state');
    expect(req.appSession!.apiGatewayAuthState!.state).toBe(originalState);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds callback state to the original authenticated subject, not a new login', async () => {
    const req = request();
    req.query = { state: await authorize(req), code: 'synthetic-code' };
    req.oidc.user!['sub'] = 'auth0|another-user';
    const res = response();
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledWith('/?api_gateway_error=invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['consent_required', 'interaction_required', 'login_required'])('retries %s interactively once, then stops', async (error) => {
    const req = request();
    req.query = { state: await authorize(req), error };
    const res = response();
    await controller.callback(req, res, vi.fn());
    const retry = new URL(vi.mocked(res.redirect).mock.calls[0][0] as unknown as string);
    expect(retry.searchParams.has('prompt')).toBe(false);
    expect(req.appSession!.apiGatewayAuthState!.silent).toBe(false);
    req.query = { state: retry.searchParams.get('state')!, error, error_description: 'never-forward-this' };
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenLastCalledWith('/org/acme/easycla?tab=agreements&api_gateway_error=authorization_failed');
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
    expect(req.appSession!.apiGatewayAuthAttempted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(res.redirect).mock.calls)).not.toContain('never-forward-this');
  });

  it('does not retry denial or reflect provider error descriptions', async () => {
    const req = request();
    req.query = { state: await authorize(req), error: 'access_denied', error_description: 'synthetic-secret' };
    const res = response();
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledExactlyOnceWith('/org/acme/easycla?tab=agreements&api_gateway_error=authorization_failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ['code-one', 'code-two']])('consumes state but never exchanges a missing/malformed code (%j)', async (code) => {
    const req = request();
    req.query = { state: await authorize(req), code };
    const res = response();
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledWith('/org/acme/easycla?tab=agreements&api_gateway_error=missing_code');
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['another subject', token('auth0|other')],
    ['primary audience', token('auth0|synthetic-user', 'https://v2.example/')],
  ])('does not store a callback token for %s', async (_description, accessToken) => {
    const req = request();
    req.query = { state: await authorize(req), code: 'synthetic-code' };
    fetchMock.mockResolvedValue(globalThis.Response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: 'wrong-grant' }));
    const res = response();
    await controller.callback(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledWith('/org/acme/easycla?tab=agreements&api_gateway_error=authorization_failed');
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
  });

  it('rejects a replay after successful authorization', async () => {
    const req = request();
    req.query = { state: await authorize(req), code: 'synthetic-code' };
    const res = response();
    await controller.callback(req, res, vi.fn());
    await controller.callback(req, res, vi.fn());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenLastCalledWith('/?api_gateway_error=invalid_state');
  });

  it.each(['start', 'callback'] as const)('blocks %s while impersonating', async (method) => {
    const req = request();
    req.impersonationActive = true;
    const res = response();
    const next = vi.fn();
    await controller[method](req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'IMPERSONATION_READ_ONLY' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each(['start', 'callback'] as const)('requires a real OIDC session for %s', async (method) => {
    const req = request();
    req.oidc.isAuthenticated = () => false;
    const res = response();
    const next = vi.fn();
    await controller[method](req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each(['start', 'callback'] as const)('returns JSON rather than redirecting an XHR/fetch %s', async (method) => {
    const req = request();
    req.get = ((name: string) => (name === 'Accept' ? 'application/json' : undefined)) as Request['get'];
    const res = response();
    await controller[method](req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'API_GATEWAY_AUTH_REQUIRED', authorize_url: '/api-gateway/auth/start' }));
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
  });

  it('returns an actionable configuration error without changing the primary session', async () => {
    vi.stubEnv('API_GW_AUDIENCE', '');
    const req = request();
    const res = response();
    const next = vi.fn();
    await controller.start(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, code: 'API_GATEWAY_UNAVAILABLE', message: 'API Gateway authorization is not configured.' })
    );
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
