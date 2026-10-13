// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerWarningMock, loggerDebugMock, loggerErrorMock } = vi.hoisted(() => ({
  loggerWarningMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('../services/logger.service', () => ({
  logger: { warning: loggerWarningMock, debug: loggerDebugMock, error: loggerErrorMock },
}));

import { exchangeRefreshTokenForIdToken, populateApiGatewayToken } from './refresh-token-exchange.util';

// populateApiGatewayToken is the single owner of the API_GW_AUDIENCE / PCC_AUTH0_* wiring and the
// 'apiGatewayToken' session-key contract shared by the auth middleware and routes that skip it.
// The exchange itself is exercised end-to-end here via a mocked fetch.
describe('populateApiGatewayToken', () => {
  const fetchMock = vi.fn();

  function buildReq(overrides: Record<string, unknown> = {}): Request {
    return { appSession: { refresh_token: 'rt-1' }, ...overrides } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('API_GW_AUDIENCE', 'https://gw.test/');
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.example.com/');
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'client-id');
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'client-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('warns and skips the exchange when API_GW_AUDIENCE is not set', async () => {
    vi.stubEnv('API_GW_AUDIENCE', '');
    const req = buildReq();

    await populateApiGatewayToken(req);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.apiGatewayToken).toBeUndefined();
    expect(loggerWarningMock).toHaveBeenCalledWith(req, 'api_gateway_token', expect.stringContaining('API_GW_AUDIENCE'));
  });

  it('does nothing when the request already carries a gateway token', async () => {
    const req = buildReq({ apiGatewayToken: 'existing-token' });

    await populateApiGatewayToken(req);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.apiGatewayToken).toBe('existing-token');
  });

  it('fails open without a refresh token in the session', async () => {
    const req = { appSession: {} } as unknown as Request;

    await populateApiGatewayToken(req);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.apiGatewayToken).toBeUndefined();
  });

  it('serves the session-cached token without an exchange', async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = buildReq({
      appSession: { refresh_token: 'rt-1', apiGatewayToken: 'cached-token', apiGatewayTokenExpiresAt: now + 600 },
    });

    await populateApiGatewayToken(req);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.apiGatewayToken).toBe('cached-token');
  });

  it('exchanges the refresh token, then assigns and session-caches the gateway token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'new-gw-token', expires_in: 3600 }) });
    const req = buildReq();

    await populateApiGatewayToken(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.example.com/oauth/token');
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain(`audience=${encodeURIComponent('https://gw.test/')}`);
    expect(req.apiGatewayToken).toBe('new-gw-token');
    expect(req.appSession?.['apiGatewayToken']).toBe('new-gw-token');
    expect(req.appSession?.['apiGatewayTokenExpiresAt']).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('fails open (no throw, no token) when the exchange errors', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const req = buildReq();

    await expect(populateApiGatewayToken(req)).resolves.toBeUndefined();

    expect(req.apiGatewayToken).toBeUndefined();
  });

  it('fails open (no throw, no token) when the exchange returns a non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
    const req = buildReq();

    await populateApiGatewayToken(req);

    expect(req.apiGatewayToken).toBeUndefined();
  });
});

// The ID token feeds GoTrue's id_token grant (Gatewaze host-session mode, #2738). What matters: the
// request asks for OIDC scopes and no audience (so the token carries no nonce), the token is never
// cached or logged, and a dead LFX session (`ended`) is told apart from an IdP outage (`unavailable`).
describe('exchangeRefreshTokenForIdToken', () => {
  const fetchMock = vi.fn();
  const ID_TOKEN = 'synthetic.id-token.value';
  const REFRESH_TOKEN = 'synthetic-refresh-token';

  function buildReq(appSession: Record<string, unknown> | undefined = { refresh_token: REFRESH_TOKEN }): Request {
    return { appSession } as unknown as Request;
  }

  function respond(status: number, body: unknown) {
    fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  }

  function loggedText(): string {
    return JSON.stringify([...loggerWarningMock.mock.calls, ...loggerDebugMock.mock.calls, ...loggerErrorMock.mock.calls].map((call) => call.slice(1)));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.example.com/');
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'client-id');
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'client-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('asks Auth0 for OIDC scopes with no audience and returns the id_token', async () => {
    respond(200, { access_token: 'synthetic-access', id_token: ID_TOKEN, expires_in: 3600 });

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'ok', idToken: ID_TOKEN });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.example.com/oauth/token');
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('scope')).toBe('openid email profile');
    expect(body.has('audience')).toBe(false);
  });

  it('asks Authelia for the openid scope with no audience', async () => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local');
    respond(200, { id_token: ID_TOKEN });

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'ok', idToken: ID_TOKEN });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.k8s.orb.local/api/oidc/token');
    expect(init.headers['Authorization']).toMatch(/^Basic /);
    const body = new URLSearchParams(init.body);
    expect(body.get('scope')).toBe('openid email profile');
    expect(body.has('audience')).toBe(false);
  });

  it('never caches the token in the session and never logs it', async () => {
    respond(200, { id_token: ID_TOKEN });
    const req = buildReq();

    await exchangeRefreshTokenForIdToken(req);

    expect(req.appSession).toEqual({ refresh_token: REFRESH_TOKEN });
    expect(loggedText()).not.toContain(ID_TOKEN);
    expect(loggedText()).not.toContain(REFRESH_TOKEN);
  });

  it.each([
    ['invalid_grant on 403', 403, { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' }],
    ['invalid_grant on 400', 400, { error: 'invalid_grant' }],
    ['invalid_grant on an unexpected status', 500, { error: 'invalid_grant' }],
  ])('reports the LFX session ended for %s', async (_label, status, body) => {
    respond(status, body);

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'ended' });
    expect(loggedText()).not.toContain('Unknown or invalid refresh token');
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  // Only invalid_grant means the LFX session is over. Any other 4xx is a client or tenant fault that
  // signing out cannot fix, so it is unavailable and logged at ERROR with the OAuth code only.
  it.each([
    ['401 invalid_client', 401, { error: 'invalid_client', error_description: 'Synthetic client description.' }, 'invalid_client'],
    ['403 unauthorized_client', 403, { error: 'unauthorized_client', error_description: 'Synthetic client description.' }, 'unauthorized_client'],
    ['400 invalid_request', 400, { error: 'invalid_request', error_description: 'Synthetic client description.' }, 'invalid_request'],
    ['400 invalid_scope', 400, { error: 'invalid_scope' }, 'invalid_scope'],
    ['a bare 401', 401, null, undefined],
    ['a bare 403', 403, {}, undefined],
  ])('reports unavailable and logs an ERROR for %s', async (_label, status, body, code) => {
    respond(status, body);

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock.mock.calls[0][4]).toEqual({ status, error: code });
    expect(loggedText()).not.toContain('Synthetic client description');
  });

  it.each([
    ['a 500', 500, { error: 'server_error' }],
    ['a 429', 429, { error: 'too_many_requests' }],
    ['a 200 with no id_token', 200, { access_token: 'synthetic-access' }],
  ])('reports the IdP unavailable for %s', async (_label, status, body) => {
    respond(status, body);

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports the IdP unavailable on a network error or timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports unavailable without calling the IdP when the session has no refresh token', async () => {
    await expect(exchangeRefreshTokenForIdToken(buildReq({}))).resolves.toEqual({ outcome: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable without calling the IdP when PCC_AUTH0_* is not configured', async () => {
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', '');

    await expect(exchangeRefreshTokenForIdToken(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
