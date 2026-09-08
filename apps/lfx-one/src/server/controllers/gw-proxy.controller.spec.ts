// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));
const flagMocks = vi.hoisted(() => ({
  isServerFeatureEnabled: vi.fn(() => true),
}));
const gwApiMocks = vi.hoisted(() => ({
  getGwApiBaseUrl: vi.fn(() => 'https://gw.example.com'),
}));
const streamMocks = vi.hoisted(() => ({
  pipeline: vi.fn(() => Promise.resolve()),
  fromWeb: vi.fn(() => ({ pipedFromWeb: true })),
}));

vi.mock('../services/logger.service', () => ({ logger: loggerMocks }));
vi.mock('../helpers/server-feature-flag.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/server-feature-flag.helper')>('../helpers/server-feature-flag.helper');
  return { ...actual, isServerFeatureEnabled: flagMocks.isServerFeatureEnabled };
});
vi.mock('../helpers/gw-api.helper', () => gwApiMocks);
vi.mock('node:stream/promises', () => ({ pipeline: streamMocks.pipeline }));
vi.mock('node:stream', () => ({ Readable: { fromWeb: streamMocks.fromWeb } }));

import type { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { GwProxyController } from './gw-proxy.controller';

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/orgs/123',
    path: '/api/gw/orgs/123',
    headers: { cookie: 'session=abc', 'x-custom': 'keep-me' },
    bearerToken: 'token-1',
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response & {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    status: vi.fn(function (this: any) {
      return this;
    }),
    json: vi.fn(),
    end: vi.fn(),
    setHeaders: vi.fn(),
  };
  return res as unknown as Response & {
    setHeader: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

describe('GwProxyController', () => {
  let controller: GwProxyController;
  let next: NextFunction & ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    flagMocks.isServerFeatureEnabled.mockReturnValue(true);
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com');
    controller = new GwProxyController();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('answers 404 gw_flag_disabled (with X-Request-Id) when the server flag is off, without calling fetch', async () => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(false);
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'gw_flag_disabled', requestId: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('answers the identical 404 gw_flag_disabled when the flag is on but the caller has no bearer token', async () => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(true);
    const req = buildReq({ bearerToken: undefined });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'gw_flag_disabled', requestId: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards method/path/query to GW_API_URL, sets Authorization from bearerToken, strips Cookie, and does not follow redirects', async () => {
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: {} });
    const req = buildReq({ url: '/orgs/123?foo=bar' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://gw.example.com/orgs/123?foo=bar');
    expect(calledInit.method).toBe('GET');
    expect(calledInit.redirect).toBe('manual');
    const headers = calledInit.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-custom')).toBe('keep-me');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('streams a non-GET/HEAD request body upstream with duplex half', async () => {
    const upstreamHeaders = new Headers();
    fetchMock.mockResolvedValue({ status: 201, headers: upstreamHeaders, body: {} });
    const req = buildReq({ method: 'POST', url: '/orgs' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.body).toBe(req);
    expect(calledInit.duplex).toBe('half');
  });

  it('passes an upstream 3xx straight through (redirect: manual means fetch resolves it, not throws)', async () => {
    const upstreamHeaders = new Headers({ location: 'https://gw.example.com/elsewhere' });
    fetchMock.mockResolvedValue({ status: 302, headers: upstreamHeaders, body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(302);
    expect(res.setHeader).toHaveBeenCalledWith('Location', 'https://gw.example.com/elsewhere');
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates a misconfigured GW_API_URL to next(error) as a 503 MicroserviceError, never calling logger.error itself', async () => {
    const configError = new MicroserviceError('GW_API_URL environment variable is not configured', 503, 'GW_API_URL_MISCONFIGURED', {
      operation: 'gw_proxy_request',
    });
    gwApiMocks.getGwApiBaseUrl.mockImplementation(() => {
      throw configError;
    });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(configError);
    expect(loggerMocks.error).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still sets X-Request-Id on the error path before delegating to next()', async () => {
    gwApiMocks.getGwApiBaseUrl.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(next).toHaveBeenCalled();
  });
});
