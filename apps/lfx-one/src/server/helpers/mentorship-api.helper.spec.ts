// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MicroserviceError } = await import('../errors');
const { proxyMentorshipRequest } = await import('./mentorship-api.helper');

type Proxy = Parameters<typeof proxyMentorshipRequest>[0];

const req = { path: '/api/mentorship/mentee/applications' } as Request;
const path = '/mentorship/v1/me/applications';

function upstream401(message: string) {
  return MicroserviceError.fromMicroserviceResponse(401, 'Unauthorized', { error: message }, 'LFX_V2_SERVICE', path);
}

describe('proxyMentorshipRequest', () => {
  let proxyRequest: ReturnType<typeof vi.fn>;
  let proxy: Proxy;

  beforeEach(() => {
    proxyRequest = vi.fn();
    proxy = { proxyRequest } as unknown as Proxy;
  });

  it('returns the upstream body when the user is already provisioned', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [] });

    await expect(proxyMentorshipRequest(proxy, req, path)).resolves.toEqual({ data: [] });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', path, 'GET', undefined, undefined);
  });

  it('provisions the user with PUT /me and retries once on the not-provisioned 401', async () => {
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 'app-1' });

    const body = { status: 'withdrawn' };
    await expect(proxyMentorshipRequest(proxy, req, path, 'PATCH', { limit: 5 }, body)).resolves.toEqual({ id: 'app-1' });

    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', path, 'PATCH', { limit: 5 }, body);
  });

  it('does not provision an impersonated user, since impersonation is read-only', async () => {
    const error = upstream401('local user is not provisioned');
    proxyRequest.mockRejectedValueOnce(error);
    const impersonatedReq = { ...req, impersonationActive: true } as Request;

    await expect(proxyMentorshipRequest(proxy, impersonatedReq, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry any other 401', async () => {
    const error = upstream401('authenticated gateway principal is required');
    proxyRequest.mockRejectedValueOnce(error);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-401 error', async () => {
    const error = MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { error: 'local user is not provisioned' }, 'LFX_V2_SERVICE', path);
    proxyRequest.mockRejectedValueOnce(error);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second time when the retry is also not provisioned', async () => {
    const second = upstream401('local user is not provisioned');
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockRejectedValueOnce(second);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(second);
    expect(proxyRequest).toHaveBeenCalledTimes(3);
  });

  it('propagates a PUT /me failure without retrying the original request', async () => {
    const bootstrapError = MicroserviceError.fromMicroserviceResponse(400, 'Bad Request', { error: 'invalid body' }, 'LFX_V2_SERVICE', '/mentorship/v1/me');
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockRejectedValueOnce(bootstrapError);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(bootstrapError);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});
