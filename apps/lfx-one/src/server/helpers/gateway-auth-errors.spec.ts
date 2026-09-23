// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { gatewayFetch } from './gateway-fetch.helper';

describe('Gateway fetch authentication boundary', () => {
  const options = { operation: 'synthetic_operation', service: 'test', errorMessage: 'failed', errorCode: 'FAILED' };
  afterEach(() => vi.unstubAllGlobals());

  it('does not silently substitute the primary token for a missing secondary grant', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = { bearerToken: 'primary-token', apiGatewayAuthStatus: 'required' } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', options)).rejects.toMatchObject({ statusCode: 403, code: 'API_GATEWAY_AUTH_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports transient refresh failures without an authorization redirect', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayAuthStatus: 'unavailable' } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', options)).rejects.toMatchObject({ statusCode: 503, code: 'API_GATEWAY_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the real user token during impersonation even if a caller populated the slot', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayToken: 'real-user-token', impersonationActive: true } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', options)).rejects.toMatchObject({ statusCode: 403, code: 'IMPERSONATION_READ_ONLY' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves explicit target-scoped overrides instead of upgrading impersonation to the real user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ read: true }));
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayToken: 'real-user-token', impersonationActive: true } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', { ...options, bearerToken: 'target-token' })).resolves.toEqual({ read: true });
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example/resource', expect.objectContaining({ headers: { Authorization: 'Bearer target-token' } }));
  });
});
