// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerWarningMock, loggerDebugMock } = vi.hoisted(() => ({
  loggerWarningMock: vi.fn(),
  loggerDebugMock: vi.fn(),
}));

vi.mock('../services/logger.service', () => ({
  logger: { warning: loggerWarningMock, debug: loggerDebugMock },
}));
// The util imports two type-only interfaces from the barrel; stub it so the shared
// interface graph never loads (mirrors profile.controller.spec.ts).
vi.mock('@lfx-one/shared/interfaces', () => ({}));

import { populateApiGatewayToken } from './refresh-token-exchange.util';

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
