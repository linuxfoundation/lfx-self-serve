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
// Partial mock: only the base-URL resolver is stubbed. `ensureGwRequestId` is real, so the
// header behaviour under test is the shipped behaviour rather than a double.
vi.mock('../helpers/gw-api.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/gw-api.helper')>('../helpers/gw-api.helper');
  return { ...actual, getGwApiBaseUrl: gwApiMocks.getGwApiBaseUrl };
});
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
    // The pre-stream rejections await drainRequestBody, which no-ops without these — so leaving
    // them off would make every drain assertion below pass without exercising anything.
    readableEnded: false,
    destroyed: false,
    resume: vi.fn(),
    once: vi.fn((event: string, callback: () => void) => {
      if (event === 'end') {
        queueMicrotask(callback);
      }
    }),
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response & {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const headers = new Map<string, unknown>();
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn((name: string, value: unknown) => headers.set(String(name).toLowerCase(), value)),
    getHeader: vi.fn((name: string) => headers.get(String(name).toLowerCase())),
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

  it('answers the uniform 404 (with X-Request-Id) when the server flag is off, without calling fetch', async () => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(false);
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    // Routed through the shared error pipeline rather than a hand-rolled res.status().json(), so
    // the body shape matches every other /api/* error.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
    expect(res.json).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers the identical uniform 404 when the flag is on but the caller has no bearer token', async () => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(true);
    const req = buildReq({ bearerToken: undefined });
    const res = buildRes();

    await controller.proxy(req, res, next);

    // Identical to the flag-off case above: same status, same code, same path through next().
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
    expect(res.json).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an upstream Location pointing off the configured GW_API_URL origin', async () => {
    // Forwarded verbatim, a 3xx naming another host is an upstream-controlled open redirect
    // wearing the LFX origin.
    const upstreamHeaders = new Headers({ location: 'https://evil.example.com/phish' });
    fetchMock.mockResolvedValue({ status: 302, headers: upstreamHeaders, body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    const locationWrites = res.setHeader.mock.calls.filter((c: unknown[]) => String(c[0]).toLowerCase() === 'location');
    expect(locationWrites).toHaveLength(0);
  });

  it('rewrites a relative Location back onto the proxy mount rather than forwarding it verbatim', async () => {
    // Forwarded as-is, the BROWSER resolves it against the LFX origin, not the upstream base — so
    // `/orgs/123/moved` would land outside /api/gw entirely.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: '/api/v1/orgs/123/moved' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('location', '/api/gw/orgs/123/moved');
  });

  it('resolves a path-relative Location against the request, not the configured base', async () => {
    // RFC 3986 §5: a relative reference resolves against the URL of the request that produced it.
    // For a request to <base>/orgs/123, `moved` means <base>/orgs/moved. Resolving against the
    // base instead produced <base>/moved — a different resource, silently.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'moved' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('location', '/api/gw/orgs/moved');
  });

  it('keeps the current path when the Location is query-only', async () => {
    // The worse half of the same bug: `?page=2` against the base dropped the path entirely and
    // pointed the browser back at the collection root instead of page 2 of this resource.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: '?page=2' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('location', '/api/gw/orgs/123?page=2');
  });

  it('still drops a relative Location that climbs out of the configured base', async () => {
    // Containment is judged against the configured base even though resolution now uses the
    // request URL, so dot segments cannot walk a browser off the upstream we chose.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: '../../admin' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalledWith('location', expect.anything());
  });

  it('rewrites an absolute same-origin Location so the browser is not sent at the internal upstream', async () => {
    // GW_API_URL is cluster-internal: handing a browser the absolute upstream URL is both
    // unreachable and a leak of the internal address.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'https://gw.example.com/api/v1/orgs/9?x=1' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('location', '/api/gw/orgs/9?x=1');
  });

  it('drops a same-origin Location that escapes the configured base path', async () => {
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'https://gw.example.com/admin' }), body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader.mock.calls.filter((c: unknown[]) => String(c[0]).toLowerCase() === 'location')).toHaveLength(0);
  });

  it('rejects a dot-segment path that would resolve outside the configured base path, without calling fetch', async () => {
    // Express does NOT normalize the path it hands the router: `/api/gw/../../secret` arrives here
    // as `/../../secret`, verified against a real Express mount. Concatenating it onto a base that
    // carries a path would send `https://gw.example.com/secret` upstream — outside the base.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    const req = buildReq({ url: '/../../secret' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'gw_path_escapes_base' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an escaping upload finish sending rather than leaving it stuck', async () => {
    // The path check runs before anything reads the body, and apiErrorHandler answers without
    // touching the request stream — so a POST still uploading when its path is rejected could
    // never finish writing. The 404, 403, fail-closed 5xx and 413 paths all drain; this one was
    // missed when they were done.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    const req = buildReq({ method: 'POST', url: '/../../secret' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(req.resume).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'gw_path_escapes_base' }));
  });

  it('forwards a first path segment containing a colon instead of reading it as a URL scheme', async () => {
    // Without the `./` prefix on the relative reference, `messages:send` parses as scheme
    // `messages:` with origin `null` and the escape check rejects it — making any Google-style
    // custom method on the upstream unreachable behind an opaque 400.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 200, headers: new Headers(), body: null });
    const req = buildReq({ url: '/messages:send' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://gw.example.com/api/v1/messages:send');
  });

  it('still forwards a path containing dot segments that stay inside the base path', async () => {
    // The guard must reject escape, not every `..` — this one normalizes back inside the base.
    gwApiMocks.getGwApiBaseUrl.mockReturnValue('https://gw.example.com/api/v1');
    fetchMock.mockResolvedValue({ status: 200, headers: new Headers(), body: null });
    const req = buildReq({ url: '/orgs/../orgs/123' });
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gw.example.com/api/v1/orgs/123');
  });

  it('sets nosniff and a sandboxing CSP on the proxied response, and upstream cannot override them', async () => {
    // host-media is in the enabled module set, so user-uploaded bytes are served from the LFX
    // origin through this route. Without these, an uploaded .html or .svg executes script in the
    // LFX origin with reach over the session cookie and localStorage.
    const upstreamHeaders = new Headers({ 'content-type': 'text/html', 'content-security-policy': "default-src 'unsafe-inline'" });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: null });
    const req = buildReq();
    const res = buildRes();

    await controller.proxy(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', "sandbox; default-src 'none'");
    // Ours must be the last write for that header, or upstream's value would stand.
    const cspWrites = res.setHeader.mock.calls.filter((c: unknown[]) => String(c[0]).toLowerCase() === 'content-security-policy');
    expect(cspWrites.at(-1)?.[1]).toBe("sandbox; default-src 'none'");
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

  it("does not forward the caller's own accept-encoding negotiation upstream", async () => {
    // Note what this does and does not buy: undici supplies its own `accept-encoding` when the
    // header is absent, so this does NOT stop the upstream compressing. The protection against a
    // decoded body outrunning content-length is the content-encoding check asserted below.
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

  it('refuses a request body past the size ceiling instead of streaming it upstream unbounded', async () => {
    // /api/gw is excluded from the body parsers, so it inherits none of their limits. The count is
    // on bytes actually seen, because a chunked upload has no content-length to precheck.
    fetchMock.mockImplementation(async (_url: string, init: { body?: ReadableStream }) => {
      // Drain the forwarded stream so the limiter's Transform actually runs, then fail the way
      // undici does: it wraps ANY request-body stream error in `TypeError: fetch failed` and hangs
      // the original off `.cause`. Re-throwing the raw error would let the controller pass a test
      // that production fails.
      const reader = (init.body as ReadableStream).getReader();
      try {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (err) {
        throw new TypeError('fetch failed', { cause: err });
      }
      return { status: 200, headers: new Headers(), body: null };
    });

    const oversized = Readable.from([Buffer.alloc(101 * 1024 * 1024)]);
    const req = Object.assign(oversized, {
      method: 'POST',
      url: '/media',
      path: '/api/gw/media',
      headers: { authorization: 'Bearer supabase-token' },
      bearerToken: 'token-1',
    }) as unknown as Request;

    await controller.proxy(req, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 413, code: 'gw_body_too_large' }));
  });

  it('drops content-length whenever the upstream encoded the body, so the decoded body is not truncated', async () => {
    // The actual anti-truncation guarantee. fetch decodes the body but leaves content-length at
    // the compressed value; copying it truncates the write. Dropping it falls back to chunked.
    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': '533',
    });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.setHeader).not.toHaveBeenCalledWith('content-length', '533');
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
  });

  it('still forwards content-length when the upstream did not encode the body', async () => {
    const upstreamHeaders = new Headers({ 'content-type': 'application/json', 'content-length': '7901' });
    fetchMock.mockResolvedValue({ status: 200, headers: upstreamHeaders, body: null });
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(res.setHeader).toHaveBeenCalledWith('content-length', '7901');
  });

  it('reports an upstream timeout as 408 TIMEOUT rather than a generic 500', async () => {
    // An abort rejects with a DOMException named AbortError, which is not a BaseApiError — left
    // unmapped it reaches apiErrorHandler's fallback and the caller cannot tell a hung upstream
    // from a bug in this controller. Mirrors api-client.service.ts's own timeout mapping.
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortError);
    const res = buildRes();

    await controller.proxy(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 408, code: 'TIMEOUT' }));
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
    // Rewritten onto the proxy mount — see rewriteUpstreamLocation. Forwarding the upstream URL
    // verbatim would hand the browser the cluster-internal host.
    expect(res.setHeader).toHaveBeenCalledWith('location', '/api/gw/elsewhere');
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
