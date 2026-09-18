// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors';
import { GW_DRAIN_TIMEOUT_MS } from '@lfx-one/shared/constants';

import { drainRequestBody, ensureGwRequestId, getGwApiBaseUrl, isGwProxyPath } from './gw-api.helper';

describe('getGwApiBaseUrl', () => {
  const originalGwApiUrl = process.env['GW_API_URL'];
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['GW_API_URL'];
  });

  afterEach(() => {
    if (originalGwApiUrl === undefined) {
      delete process.env['GW_API_URL'];
    } else {
      process.env['GW_API_URL'] = originalGwApiUrl;
    }
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('throws a 503 MicroserviceError when GW_API_URL is unset', () => {
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(MicroserviceError);
    try {
      getGwApiBaseUrl('gw_proxy_request');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MicroserviceError);
      expect((error as MicroserviceError).statusCode).toBe(503);
      expect((error as MicroserviceError).code).toBe('GW_API_URL_MISCONFIGURED');
    }
  });

  it('throws when GW_API_URL is set but empty/whitespace-only', () => {
    process.env['GW_API_URL'] = '   ';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(MicroserviceError);
  });

  it('throws when GW_API_URL has a trailing slash', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = 'https://gw.example.com/';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/trailing slash/);
  });

  it.each([
    ['a scheme with no host', 'https://'],
    ['a bare hostname with no scheme', 'gw.example.com'],
    ['nonsense', 'not a url at all'],
  ])('reports %s as a misconfiguration, not a 500', (_label, value) => {
    // Each of these passed the old startsWith() check (or, in dev, no check at all) and then threw
    // a bare TypeError from `new URL()` in the controller — surfacing as a generic 500 instead of
    // the 503 this function exists to produce.
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = value;
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(expect.objectContaining({ statusCode: 503, code: 'GW_API_URL_MISCONFIGURED' }));
  });

  it.each([
    ['a query string', 'https://gw.example.com/api/v1?x=1'],
    ['a fragment', 'https://gw.example.com/api/v1#frag'],
  ])('rejects a base carrying %s, which would 400 every proxied request', (_label, value) => {
    // This slipped past the trailing-slash rule while breaking the same invariant. The controller
    // builds `new URL(`${base}/`)`, and for `…/api/v1?x=1` that pathname is `/api/v1` with NO
    // trailing slash — so every proxied path resolves outside the base and the route answers
    // 400 gw_path_escapes_base on every request. A total outage reported as an attack.
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = value;
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(expect.objectContaining({ statusCode: 503, code: 'GW_API_URL_MISCONFIGURED' }));
  });

  it('rejects a non-http(s) scheme even in development', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = 'file:///etc/passwd';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/http/);
  });

  it('throws when GW_API_URL is non-https outside dev/local/test NODE_ENV', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = 'http://gw.example.com';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/https/);
  });

  it('allows non-https GW_API_URL when NODE_ENV is development', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = 'http://localhost:5050';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('http://localhost:5050');
  });

  it('allows non-https GW_API_URL when NODE_ENV is local', () => {
    process.env['NODE_ENV'] = 'local';
    process.env['GW_API_URL'] = 'http://localhost:5050';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('http://localhost:5050');
  });

  it('returns the trimmed URL unchanged when valid', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = '  https://gw.example.com  ';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('https://gw.example.com');
  });
});

/**
 * The drain is what stops a rejected upload hanging until keep-alive. Every rejection path on
 * `/api/gw/*` decides before the body is read, and `apiErrorHandler` answers without touching the
 * request stream — so without this the client cannot finish writing.
 *
 * Tested directly because it is awaited on four paths now, and both of the defects it has had
 * (returning before actually draining, and stalling the full cap on an aborted request) were
 * invisible through the middleware spec's stub, which always settles on the next microtask.
 */
describe('drainRequestBody', () => {
  const buildReq = (overrides: Partial<Request> = {}): Request => {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      method: 'POST',
      readableEnded: false,
      destroyed: false,
      resume: vi.fn(),
      ...overrides,
    }) as unknown as Request;
  };

  afterEach(() => vi.useRealTimers());

  it.each([
    ['a GET has no body to drain', { method: 'GET' }],
    ['a HEAD has no body to drain', { method: 'HEAD' }],
    ['the stream already ended', { readableEnded: true }],
    ['the request was destroyed', { destroyed: true }],
  ])('resolves immediately and reads nothing when %s', async (_label, overrides) => {
    const req = buildReq(overrides as Partial<Request>);

    await drainRequestBody(req);

    expect(req.resume).not.toHaveBeenCalled();
  });

  it('does not stall the full cap on a request that was already aborted', async () => {
    // `destroyed` is the load-bearing half. For a caller that aborted mid-upload, readableEnded is
    // still false and 'end'/'close'/'error' have ALREADY fired, so no listener can fire again and
    // only the timer resolves — pinning an Express handler for five seconds per aborted upload,
    // on paths that are rejecting someone.
    vi.useFakeTimers();
    const req = buildReq({ destroyed: true });

    let settled = false;
    void drainRequestBody(req).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(true);
  });

  it.each(['end', 'close', 'error'])('resolves as soon as the request emits %s', async (event) => {
    vi.useFakeTimers();
    const req = buildReq();

    let settled = false;
    const pending = drainRequestBody(req).then(() => {
      settled = true;
    });

    expect(req.resume).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    (req as unknown as EventEmitter).emit(event);
    await pending;

    expect(settled).toBe(true);
  });

  it('gives up at the cap when the client never stops sending', async () => {
    // Bounded on purpose: these are rejection paths, so a client trickling bytes must not be able
    // to hold the handler open indefinitely.
    vi.useFakeTimers();
    const req = buildReq();

    let settled = false;
    const pending = drainRequestBody(req).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(GW_DRAIN_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('starts reading exactly once', async () => {
    vi.useFakeTimers();
    const req = buildReq();

    const pending = drainRequestBody(req);
    (req as unknown as EventEmitter).emit('end');
    await pending;

    expect(req.resume).toHaveBeenCalledOnce();
  });
});

describe('ensureGwRequestId', () => {
  // Both the middleware and the controller answer on this route and both need the header, so
  // minting independently produced two ids for one request with whichever ran last winning.
  const buildRes = (): Response => {
    const headers = new Map<string, unknown>();
    return {
      setHeader: vi.fn((name: string, value: unknown) => headers.set(String(name).toLowerCase(), value)),
      getHeader: vi.fn((name: string) => headers.get(String(name).toLowerCase())),
    } as unknown as Response;
  };

  it('mints an id when the response has none', () => {
    const res = buildRes();

    const id = ensureGwRequestId(res);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });

  it('keeps the first id, so two callers cannot disagree about the request', () => {
    const res = buildRes();
    const first = ensureGwRequestId(res);

    const second = ensureGwRequestId(res);

    expect(second).toBe(first);
    expect(res.setHeader).toHaveBeenCalledOnce();
  });
});

describe('isGwProxyPath', () => {
  // This guarded three carve-outs with no test of its own, and one of them was silently inert:
  // `compression`'s filter is deferred to the first `res.write`, by which point Express has
  // trimmed the mount prefix off `req.url`, so it was asking about `/newsletters/123` and gzipping
  // every proxied response. Inverting the segment-boundary check below failed nothing in the suite.
  it.each([
    ['the bare mount', '/api/gw'],
    ['a path under the mount', '/api/gw/newsletters/123'],
    ['an upper-cased mount, which Express routes case-insensitively', '/API/GW/newsletters'],
    ['a mixed-case mount', '/Api/Gw/media'],
  ])('matches %s', (_label, path) => {
    expect(isGwProxyPath(path)).toBe(true);
  });

  it.each([
    ['a sibling sharing the prefix', '/api/gwidgets'],
    ['a sibling under that prefix', '/api/gwidgets/list'],
    ['an unrelated api route', '/api/meetings'],
    ['the mount without its leading segment', '/gw/newsletters'],
    ['empty', ''],
  ])('does not match %s', (_label, path) => {
    // `/api/gwidgets` is the one that matters: a bare `startsWith('/api/gw')` swallows it and
    // silently strips its body parsing, which surfaces as an empty `req.body` rather than an error.
    expect(isGwProxyPath(path)).toBe(false);
  });

  it('cannot match a path Express has already trimmed, which is why callers must pass an untrimmed one', () => {
    // The shape of the compression bug, pinned. Inside `app.use('/api/gw', router)` the request
    // path is relative to the mount, so asking this function about it always answers false.
    expect(isGwProxyPath('/newsletters/123')).toBe(false);
  });
});
