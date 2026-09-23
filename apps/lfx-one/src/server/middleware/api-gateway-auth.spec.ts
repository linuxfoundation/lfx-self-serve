// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/valkey.service', () => ({ valkeyService: { isEnabled: () => false }, buildAuthStateCacheKey: () => null }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { apiGatewayAuthService } from '../services/api-gateway-auth.service';
import { CrowdfundingAuthService } from '../services/crowdfunding-auth.service';
import { createAuthMiddleware } from './auth.middleware';

describe('Gateway acquisition in the selective auth middleware', () => {
  const middleware = createAuthMiddleware();
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  function request(path: string, method = 'GET', accept = 'text/html'): Request {
    return {
      path,
      originalUrl: path,
      method,
      query: {},
      cookies: {},
      appSession: { refresh_token: 'primary-refresh' },
      get: (name: string) => (name === 'Accept' ? accept : undefined),
      oidc: {
        isAuthenticated: () => true,
        user: { sub: 'auth0|synthetic-user' },
        accessToken: { access_token: 'primary-token', isExpired: () => false, refresh: vi.fn() },
      },
    } as unknown as Request;
  }

  function response(): Response {
    return { redirect: vi.fn(), set: vi.fn(), oidc: { login: vi.fn(), logout: vi.fn() } } as unknown as Response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PCC_BASE_URL', 'https://self-serve.example');
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'self-serve-client');
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'synthetic-secret');
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://issuer.example/');
    vi.stubEnv('API_GW_AUDIENCE', 'https://gateway.example/');
    vi.stubEnv('CROWDFUNDING_API_AUDIENCE', 'https://crowdfunding.example/');
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('actually starts the Gateway code grant on the first protected document navigation', async () => {
    const req = request('/org/acme/easycla');
    req.originalUrl = '/org/acme/easycla?tab=agreements';
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    const authorize = new URL(vi.mocked(res.redirect).mock.calls[0][0] as unknown as string);
    expect(authorize.pathname).toBe('/authorize');
    expect(authorize.searchParams.get('audience')).toBe('https://gateway.example/');
    expect(req.appSession!.apiGatewayAuthState!.returnTo).toBe('/org/acme/easycla?tab=agreements');
    expect(next).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
  });

  it.each(['/api-gateway/callback', '/api-gateway/auth/start'])('lets the dedicated session-only route %s handle its own flow', async (path) => {
    const req = request(path);
    req.oidc.accessToken!.isExpired = () => true;
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.oidc.accessToken!.refresh).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can authorize an authenticated navigation independently of primary access-token expiry', async () => {
    const req = request('/org/acme/easycla');
    req.oidc.accessToken!.isExpired = () => true;
    const res = response();
    await middleware(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(req.oidc.accessToken!.refresh).not.toHaveBeenCalled();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
  });

  it.each(['/public/api/meetings', '/meetings/public-one', '/docs/authentication', '/u/synthetic-user', '/auth-error'])(
    'does not start or refresh Gateway authorization on public/optional %s',
    async (path) => {
      const req = request(path);
      const next = vi.fn();
      const res = response();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(['/crowdfunding/callback', '/social/callback', '/passwordless/callback'])('does not intercept another grant callback (%s)', async (path) => {
    const next = vi.fn();
    const res = response();
    await middleware(request(path), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE'])('never redirects/replays an API %s; only Gateway operations require the secondary grant', async (method) => {
    const req = request('/api/orgs/acme/clas', method);
    const next = vi.fn();
    const res = response();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(req.bearerToken).toBe('primary-token');
    expect(req.apiGatewayAuthStatus).toBe('required');
    await expect(
      gatewayFetch(req, 'https://gateway.example/easycla', {
        operation: 'gateway_operation',
        service: 'test',
        errorMessage: 'failed',
        errorCode: 'FAILED',
        method: 'POST',
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'API_GATEWAY_AUTH_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', 'text/html'],
    ['GET', 'application/json'],
    ['GET', '*/*'],
  ])('does not start the grant on a non-document SSR request (%s %s)', async (method, accept) => {
    const req = request('/org/acme/easycla', method, accept);
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('discards a legacy wrong-audience cache and reauthorizes instead of forwarding the primary token', async () => {
    const req = request('/org/acme/easycla');
    req.appSession!.apiGatewayToken = 'primary-token';
    req.appSession!.apiGatewayTokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    const res = response();
    await middleware(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds automatic authorization even if a failed callback URL is revisited', async () => {
    const req = request('/org/acme/easycla');
    const res = response();
    await middleware(req, res, vi.fn());
    await middleware(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledTimes(1);
    delete req.appSession!.apiGatewayAuthAttempted;
    req.query = { api_gateway_error: 'authorization_failed' };
    await middleware(req, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledTimes(1);
  });

  it('keeps primary routes working during a transient Gateway refresh outage', async () => {
    const req = request('/api/projects/acme');
    req.appSession!.apiGatewayGrant = {
      sub: 'auth0|synthetic-user',
      issuer: 'https://issuer.example/',
      audience: 'https://gateway.example/',
      clientId: 'self-serve-client',
    };
    req.appSession!.apiGatewayRefreshToken = 'gateway-refresh';
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.bearerToken).toBe('primary-token');
    expect(req.apiGatewayAuthStatus).toBe('unavailable');
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
    expect(res.oidc.logout).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('leaves the existing Crowdfunding cache and separate authorize grant intact', async () => {
    const req = request('/api/crowdfunding/initiatives');
    const cf = new CrowdfundingAuthService();
    cf.storeToken(req, {
      access_token: 'crowdfunding-token',
      refresh_token: 'crowdfunding-refresh',
      token_type: 'Bearer',
      scope: 'access:me',
      expires_in: 3600,
    });
    const next = vi.fn();
    await middleware(req, response(), next);
    expect(req.crowdfundingToken).toBe('crowdfunding-token');
    expect(req.appSession!.crowdfundingRefreshToken).toBe('crowdfunding-refresh');
    expect(req.bearerToken).toBe('primary-token');
    const url = new URL(cf.getAuthorizationUrl(req, '/crowdfunding/initiatives'));
    expect(url.searchParams.get('audience')).toBe('https://crowdfunding.example/');
    expect(url.searchParams.get('redirect_uri')).toBe('https://self-serve.example/crowdfunding/callback');
    expect(url.searchParams.get('scope')).toContain('access:me');
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Crowdfunding refresh on its own RT, never the primary or Gateway RT', async () => {
    const req = request('/api/crowdfunding/initiatives');
    req.appSession!.crowdfundingRefreshToken = 'crowdfunding-refresh';
    fetchMock.mockResolvedValue(globalThis.Response.json({ access_token: 'renewed-cf', refresh_token: 'rotated-cf', expires_in: 3600, token_type: 'Bearer' }));
    await middleware(req, response(), vi.fn());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body)).get('refresh_token')).toBe('crowdfunding-refresh');
    expect(req.crowdfundingToken).toBe('renewed-cf');
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
  });

  it('does not initiate or expose a real-user grant during impersonation, including SSR without bearer extraction', async () => {
    const req = request('/org/acme/easycla');
    req.appSession!['impersonationToken'] = 'header.eyJzdWIiOiJ0YXJnZXQifQ.signature';
    req.appSession!['impersonationExpiresAt'] = Date.now() + 60_000;
    req.appSession!['impersonationUser'] = { sub: 'target' };
    const res = response();
    await middleware(req, res, vi.fn());
    expect(req.impersonationActive).toBe(true);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(req.apiGatewayToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(apiGatewayAuthService.getAuthorizationUrl(req, '/')).rejects.toThrow();
  });

  it.each(['/api/projects/acme', '/meetings/public-one'])('preserves the existing Authelia exchange on %s', async (path) => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    fetchMock.mockResolvedValue(globalThis.Response.json({ access_token: 'local-gateway-token', expires_in: 3600 }));
    const req = request(path);
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.k8s.orb.local/api/oidc/token');
    const options = fetchMock.mock.calls[0][1]!;
    expect(Object.fromEntries(new URLSearchParams(String(options.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'primary-refresh',
      audience: 'https://gateway.example/',
    });
    expect(options.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('self-serve-client:synthetic-secret').toString('base64')}` });
    expect(req.apiGatewayToken).toBe('local-gateway-token');
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
  });

  it('reuses an existing Authelia cache without a new grant or token request', async () => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    const req = request('/api/projects/acme');
    req.appSession!.apiGatewayToken = 'cached-local-token';
    req.appSession!.apiGatewayTokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    await middleware(req, response(), vi.fn());
    expect(req.apiGatewayToken).toBe('cached-local-token');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.appSession!.apiGatewayGrant).toBeUndefined();
  });

  it.each([false, true])('isolates the Authelia operator token during impersonation (cached: %s)', async (cached) => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    const req = request('/api/events/visa-applications', 'POST', 'application/json');
    const targetToken = 'header.eyJzdWIiOiJ0YXJnZXQifQ.signature';
    req.appSession!['impersonationToken'] = targetToken;
    req.appSession!['impersonationExpiresAt'] = Date.now() + 60_000;
    req.appSession!['impersonationUser'] = { sub: 'target' };
    if (cached) {
      req.appSession!.apiGatewayToken = 'local-operator-token';
      req.appSession!.apiGatewayTokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    }
    fetchMock.mockResolvedValue(globalThis.Response.json({ access_token: 'local-operator-token', expires_in: 3600 }));
    const res = response();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.impersonationActive).toBe(true);
    expect(req.bearerToken).toBe(targetToken);
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.apiGatewayOperatorToken).toBe('local-operator-token');
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(req.oidc.accessToken!.refresh).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(cached ? 0 : 1);
    await expect(
      gatewayFetch(req, 'https://gateway.example/resource', {
        operation: 'synthetic_write',
        service: 'test',
        errorMessage: 'failed',
        errorCode: 'FAILED',
        method: 'POST',
        allowOperatorToken: true,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'IMPERSONATION_READ_ONLY' });
    expect(fetchMock).toHaveBeenCalledTimes(cached ? 0 : 1);
  });

  it('does not redirect local Authelia document navigation into the Auth0-only grant', async () => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    const req = request('/org/acme/easycla');
    const res = response();
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.appSession!.apiGatewayAuthAttempted).toBeUndefined();
  });

  it('retains the existing Authelia failure behavior without clearing the primary session', async () => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    fetchMock.mockResolvedValue(globalThis.Response.json({ error: 'temporarily_unavailable' }, { status: 503 }));
    const req = request('/api/projects/acme');
    const next = vi.fn();
    await middleware(req, response(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(req.appSession!.apiGatewayAuthAttempted).toBeUndefined();
  });
});
