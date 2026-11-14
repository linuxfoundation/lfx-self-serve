// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts / meeting.service.spec.ts: the `@lfx-one/shared/*` alias
// isn't wired into this app's vitest config, so the real collaborator (ApiClientService) is
// mocked to isolate the bearerToken-override precedence logic under test.
const { request, streamRequest } = vi.hoisted(() => ({ request: vi.fn(), streamRequest: vi.fn() }));

vi.mock('./api-client.service', () => ({
  ApiClientService: class {
    public request = request;
    public streamRequest = streamRequest;
  },
}));

import type { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { MicroserviceProxyService } from './microservice-proxy.service';

const req = { bearerToken: 'req-token' } as unknown as Request;

describe('MicroserviceProxyService bearerToken override precedence', () => {
  let service: MicroserviceProxyService;

  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {} });
    service = new MicroserviceProxyService();
  });

  it('proxyRequest sends options.bearerToken instead of req.bearerToken when set', async () => {
    await service.proxyRequest(req, 'LFX_V2_SERVICE', '/path', 'GET', undefined, undefined, undefined, { bearerToken: 'override-token' });

    expect(request).toHaveBeenCalledTimes(1);
    const [, , bearerToken] = request.mock.calls[0];
    expect(bearerToken).toBe('override-token');
  });

  it('proxyRequest falls back to req.bearerToken when no override is given', async () => {
    await service.proxyRequest(req, 'LFX_V2_SERVICE', '/path', 'GET');

    const [, , bearerToken] = request.mock.calls[0];
    expect(bearerToken).toBe('req-token');
  });

  it('proxyRequestWithResponse sends options.bearerToken instead of req.bearerToken when set', async () => {
    await service.proxyRequestWithResponse(req, 'LFX_V2_SERVICE', '/path', 'GET', undefined, undefined, undefined, { bearerToken: 'override-token' });

    const [, , bearerToken] = request.mock.calls[0];
    expect(bearerToken).toBe('override-token');
  });

  it('proxyRequestWithResponse falls back to req.bearerToken when no override is given', async () => {
    await service.proxyRequestWithResponse(req, 'LFX_V2_SERVICE', '/path', 'GET');

    const [, , bearerToken] = request.mock.calls[0];
    expect(bearerToken).toBe('req-token');
  });
});

describe('MicroserviceProxyService.proxyStreamRequest options', () => {
  let service: MicroserviceProxyService;

  beforeEach(() => {
    streamRequest.mockReset();
    streamRequest.mockResolvedValue(new Response(''));
    service = new MicroserviceProxyService();
  });

  it('passes the headers and the timeout option through to the stream request', async () => {
    await service.proxyStreamRequest(req, 'LFX_V2_SERVICE', '/path', 'GET', undefined, { Range: 'bytes=0-9' }, { timeoutMs: 120_000 });

    expect(streamRequest).toHaveBeenCalledTimes(1);
    const [method, , bearerToken, , customHeaders, options] = streamRequest.mock.calls[0];
    expect(method).toBe('GET');
    expect(bearerToken).toBe('req-token');
    expect(customHeaders).toEqual({ Range: 'bytes=0-9' });
    expect(options).toEqual({ timeoutMs: 120_000 });
  });

  it('passes no options when none are given, so the client keeps its own timeout', async () => {
    await service.proxyStreamRequest(req, 'LFX_V2_SERVICE', '/path');

    const [, , , , , options] = streamRequest.mock.calls[0];
    expect(options).toBeUndefined();
  });
});

describe('MicroserviceProxyService.buildEndpoint path-traversal guard (linuxfoundation/lfx-self-serve-ops#434)', () => {
  let service: MicroserviceProxyService;

  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {} });
    service = new MicroserviceProxyService();
  });

  it.each([
    '/projects/../secrets',
    '/projects/./x',
    '/a?b=1',
    '/a#b',
    '/projects/%2e%2e/x',
    '/projects/%2E%2E/x',
    '/p/.%2e/x',
    '/p/%2e./x',
    '/p/%2e/x',
    '/p/..\\secrets',
    '/surveys/id\\responses',
    '/projects/.\t./x',
    '/projects/.%09./x',
    '/projects/.%0a./x',
    '/projects/.%0d./x',
    '/projects/.. ',
  ])('rejects a malicious path %s before calling the API client', async (path) => {
    await expect(service.proxyRequest(req, 'LFX_V2_SERVICE', path, 'GET')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not reject a normal UUID path', async () => {
    await service.proxyRequest(req, 'LFX_V2_SERVICE', '/projects/550e8400-e29b-41d4-a716-446655440000/settings', 'GET');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not reject a raw unencoded path containing WHATWG-re-encoded characters (e.g. a space)', async () => {
    await service.proxyRequest(req, 'LFX_V2_SERVICE', '/committees/abc def/invites/xyz', 'GET');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
