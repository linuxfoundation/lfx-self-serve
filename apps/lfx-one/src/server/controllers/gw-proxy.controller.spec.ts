// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Readable } from 'node:stream';

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
// Keep the real module and stub only the boundary we assert on. `Readable.toWeb` (used to hand
// the request stream to fetch) and `Readable.from` (used to build one in a test) both need the
// genuine implementation.
vi.mock('node:stream', async () => {
  const actual = await vi.importActual<typeof import('node:stream')>('node:stream');
  return { ...actual, Readable: Object.assign(actual.Readable, { fromWeb: streamMocks.fromWeb }) };
});

import type { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { GwProxyController } from './gw-proxy.controller';

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/orgs/123',
    path: '/api/gw/orgs/123',
    headers: { cookie: 'session=abc', 'x-custom': 'keep-me', authorization: 'Bearer supabase-token', origin: 'http://localhost:4200' },
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
    // Routed through the shared error pipeline rather than a hand-rolled res.status().json(), so
    // the body shape matches every other /api/* error.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'gw_flag_disabled' }));
    expect(res.json).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers the identical 404 gw_flag_disabled when the flag is on but the caller has no bearer token', async () => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(true);
    const req = buildReq({ bearerToken: undefined });
    const res = buildRes();

    await controller.proxy(req, res, next);

    // Identical to the flag-off case above: same status, same code, same path through next().
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'gw_flag_disabled' }));
    expect(res.json).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards method/path/query to GW_API_URL, passes the caller's Authorization through, strips Cookie/Origin, and does not follow redirects", async () => {
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
    // The embed's Supabase token rides through untouched. It must NOT be replaced by the LFX
    // session token (`bearerToken: 'token-1'`) — the Gatewaze API only accepts Supabase JWTs, and
    // forwarding an LFX credential to it would leak one.
    expect(headers.get('authorization')).toBe('Bearer supabase-token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('origin')).toBeNull();
    expect(headers.get('x-custom')).toBe('keep-me');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('streams a non-GET/HEAD request body upstream with duplex half', async () => {
    const upstreamHeaders = new Headers();
    fetchMock.mockResolvedValue({ status: 201, headers: upstreamHeaders, body: {} });
    // A real Readable carrying the request fields, not a bare object: the controller converts the
    // request stream with Readable.toWeb (which is what removed the cast through `unknown`), and
    // that only works on an actual stream.
    const stream = Readable.from(['{"a":1}']);
    const req = Object.assign(stream, {
      method: 'POST',
      url: '/orgs',
      path: '/api/gw/orgs',
      headers: { authorization: 'Bearer supabase-token' },
      bearerToken: 'token-1',
    }) as unknown as Request;
    const res = buildRes();

    await controller.proxy(req, res, next);

    const [, calledInit] = fetchMock.mock.calls[0];
    // The raw req stream converted to a web stream — Readable.toWeb rather than a cast, so the
    // value handed to fetch is a real ReadableStream.
    expect(calledInit.body).toBeInstanceOf(ReadableStream);
    expect(calledInit.duplex).toBe('half');
  });

  it('never lets the browser negotiate compression upstream, so a decoded body cannot outrun Content-Length', async () => {
    // Regression: `fetch` DECODES a gzipped response body but leaves `content-length` at the
    // compressed value. Copying that header onto a response whose body is the decoded stream makes
    // Node truncate the write, delivering valid-looking JSON cut off mid-document. Stripping
    // accept-encoding on the way out means the upstream never compresses in the first place.
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: null });
    const req = buildReq();
    req.headers['accept-encoding'] = 'gzip, deflate, br';
    const res = buildRes();

    await controller.proxy(req, res, next);

    const [, calledInit] = fetchMock.mock.calls[0];
    expect((calledInit.headers as Headers).get('accept-encoding')).toBeNull();
  });

  it('forwards cache-control so an upstream no-store on authenticated data is not lost', async () => {
    const upstreamHeaders = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
  });

  it('gives up on a hung upstream rather than holding the socket open forever', async () => {
    fetchMock.mockResolvedValue({ status: 200, headers: new Headers(), body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes an upstream 3xx straight through (redirect: manual means fetch resolves it, not throws)', async () => {
    const upstreamHeaders = new Headers({ location: 'https://gw.example.com/elsewhere' });
    fetchMock.mockResolvedValue({ status: 302, headers: upstreamHeaders, body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(302);
    expect(res.setHeader).toHaveBeenCalledWith('location', 'https://gw.example.com/elsewhere');
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
