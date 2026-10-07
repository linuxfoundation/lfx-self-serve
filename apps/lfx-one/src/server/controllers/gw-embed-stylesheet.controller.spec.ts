// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GW_EMBED_STYLESHEET_MAX_AGE_S, GW_EMBED_STYLESHEET_ROUTE } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import { GwEmbedStylesheetService } from '../services/gw-embed-stylesheet.service';
import { GwEmbedStylesheetController } from './gw-embed-stylesheet.controller';
import type { NextFunction, Request, Response } from 'express';

const NAME = 'admin-embed-C7yXdkZR.css';
const SHEET = { css: '#scoped{color:red}', etag: '"abc123"' };

type TestResponse = Response & { body?: unknown; headers: Record<string, string>; statusCode: number; ended: boolean };

function makeRes(): TestResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: vi.fn(function (this: TestResponse, code: number) {
      this.statusCode = code;
      return this;
    }),
    end: vi.fn(function (this: TestResponse) {
      this.ended = true;
    }),
    send: vi.fn(function (this: TestResponse, body: unknown) {
      this.body = body;
    }),
  } as unknown as TestResponse;
}

function makeReq(name: string, headers: Record<string, string> = {}): Request {
  return { params: { name }, headers, url: `${GW_EMBED_STYLESHEET_ROUTE}/${name}` } as unknown as Request;
}

describe('GwEmbedStylesheetController', () => {
  let load: ReturnType<typeof vi.fn>;
  let controller: GwEmbedStylesheetController;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  const serve = async (name = NAME, headers?: Record<string, string>): Promise<TestResponse> => {
    const res = makeRes();
    await controller.serve(makeReq(name, headers), res, next);
    return res;
  };

  beforeEach(() => {
    load = vi.fn(async () => SHEET);
    controller = new GwEmbedStylesheetController({ load } as unknown as GwEmbedStylesheetService);
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  it('answers 404 for a name that is not a hashed embed stylesheet, without asking the service', async () => {
    for (const bad of ['admin.css', '../etc/passwd', 'admin-embed-abc.css/../x', 'admin-embed-.css', 'admin-embed-abc.js', 'ADMIN-EMBED-abc.css ']) {
      next.mockClear();
      await serve(bad);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('sends the sheet with the full header set: css content type, nosniff, ETag and a revalidating cache policy', async () => {
    const res = await serve();
    expect(next).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith(expect.anything(), NAME);
    expect(res.body).toBe(SHEET.css);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['etag']).toBe(SHEET.etag);
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.headers['cache-control']).toBe(`public, max-age=${GW_EMBED_STYLESHEET_MAX_AGE_S}, stale-while-revalidate=604800`);
    expect(res.headers['cache-control']).not.toContain('immutable');
  });

  it('answers 304 to a matching If-None-Match without a body, keeping the cache headers', async () => {
    const res = await serve(NAME, { 'if-none-match': SHEET.etag });
    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.headers['etag']).toBe(SHEET.etag);
    expect(res.headers['cache-control']).toContain('max-age=');
  });

  it('passes a service failure to the error handler untouched', async () => {
    const error = new MicroserviceError('The embed stylesheet is not available upstream', 502, 'gw_embed_stylesheet_upstream_status');
    load.mockRejectedValueOnce(error);
    const res = await serve();
    expect(next).toHaveBeenCalledWith(error);
    expect(res.body).toBeUndefined();
  });
});
