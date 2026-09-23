// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { MicroserviceError } from '../errors';
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

  it('exposes the safe challenge without returning the primary token', async () => {
    const req = { bearerToken: 'primary-token', apiGatewayAuthStatus: 'required' } as Request;
    let error: unknown;
    try {
      await gatewayFetch(req, 'https://gateway.example/resource', options);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MicroserviceError);
    expect((error as MicroserviceError).toResponse()).toMatchObject({
      code: 'API_GATEWAY_AUTH_REQUIRED',
      details: { authorize_url: '/api-gateway/auth/start' },
    });
    expect(JSON.stringify((error as MicroserviceError).toResponse())).not.toContain('primary-token');
  });

  it.each(['unavailable', 'not_configured', undefined] as const)('preserves 503 for a missing token with status %s', async (status) => {
    const req = { bearerToken: 'primary-token', apiGatewayAuthStatus: status } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', options)).rejects.toMatchObject({
      statusCode: 503,
      code: 'API_GATEWAY_UNAVAILABLE',
      message: 'API Gateway authorization is temporarily unavailable. Check API_GW_AUDIENCE and authentication configuration, then retry.',
      operation: options.operation,
      service: options.service,
    });
  });

  it('selects a valid Gateway token instead of the primary token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ read: true }));
    vi.stubGlobal('fetch', fetchMock);
    const req = { bearerToken: 'primary-token', apiGatewayToken: 'gateway-token' } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', options)).resolves.toEqual({ read: true });
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example/resource', expect.objectContaining({ headers: { Authorization: 'Bearer gateway-token' } }));
  });

  it('does not use an empty explicit override as permission to forward the real user token while impersonating', async () => {
    const req = { apiGatewayToken: 'real-user-token', impersonationActive: true } as Request;
    await expect(gatewayFetch(req, 'https://gateway.example/resource', { ...options, bearerToken: '' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'IMPERSONATION_READ_ONLY',
    });
  });

  it('allows an explicitly reviewed GET using only the isolated operator token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ read: true }));
    vi.stubGlobal('fetch', fetchMock);
    const req = {
      bearerToken: 'target-token',
      apiGatewayToken: 'unreviewed-default-token',
      apiGatewayOperatorToken: 'operator-token',
      impersonationActive: true,
    } as Request;

    await expect(gatewayFetch(req, 'https://gateway.example/catalogue', { ...options, allowOperatorToken: true })).resolves.toEqual({ read: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example/catalogue',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer operator-token' } })
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('never permits an operator-token %s while impersonating', async (method) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayOperatorToken: 'operator-token', impersonationActive: true } as Request;

    await expect(gatewayFetch(req, 'https://gateway.example/resource', { ...options, allowOperatorToken: true, method })).rejects.toMatchObject({
      statusCode: 403,
      code: 'IMPERSONATION_READ_ONLY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not substitute a default or primary token when the reviewed operator token is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayToken: 'unreviewed-default-token', bearerToken: 'primary-token', impersonationActive: true } as Request;

    await expect(gatewayFetch(req, 'https://gateway.example/catalogue', { ...options, allowOperatorToken: true })).rejects.toMatchObject({
      statusCode: 503,
      code: 'API_GATEWAY_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an explicit target token authoritative even when an operator read is allowed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ read: true }));
    vi.stubGlobal('fetch', fetchMock);
    const req = { apiGatewayOperatorToken: 'operator-token', impersonationActive: true } as Request;

    await expect(gatewayFetch(req, 'https://gateway.example/resource', { ...options, allowOperatorToken: true, bearerToken: 'target-token' })).resolves.toEqual(
      { read: true }
    );
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example/resource', expect.objectContaining({ headers: { Authorization: 'Bearer target-token' } }));
  });
});
