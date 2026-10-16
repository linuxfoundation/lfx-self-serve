// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S, GW_EMBED_STYLESHEET_MAX_AGE_S, GW_EMBED_STYLESHEET_ROUTE } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import { GwEmbedStylesheetService } from '../services/gw-embed-stylesheet.service';
import { GwEmbedStylesheetController } from './gw-embed-stylesheet.controller';
import type { NextFunction, Request, Response } from 'express';

const OWN_KEY = 'ownKey0123456789';
const getKey = vi.fn((): string => OWN_KEY);
vi.mock('../helpers/gw-embed.helper', () => ({ getGwEmbedStylesheetKey: () => getKey() }));

const NAME = 'admin-embed-C7yXdkZR.css';
const SHEET = {
  css: '#scoped{color:red}',
  etag: '"abc123"',
  identity: Buffer.from('#scoped{color:red}'),
  gzip: Buffer.from('gzip-bytes'),
  br: Buffer.from('br-bytes'),
};

type TestResponse = Response & { body?: Uint8Array; headers: Record<string, string>; statusCode: number; ended: boolean };

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
    end: vi.fn(function (this: TestResponse, body?: Uint8Array) {
      this.ended = true;
      this.body = body;
    }),
  } as unknown as TestResponse;
}

interface ServeOptions {
  key?: string;
  headers?: Record<string, string>;
  /** What Express's negotiator would pick from ('br', 'gzip', 'identity'). */
  accepted?: string | false;
}

describe('GwEmbedStylesheetController', () => {
  let load: ReturnType<typeof vi.fn>;
  let controller: GwEmbedStylesheetController;
  let next: NextFunction & ReturnType<typeof vi.fn>;
  let acceptsEncodings: ReturnType<typeof vi.fn>;

  const serve = async (name = NAME, { key, headers = {}, accepted = 'identity' }: ServeOptions = {}): Promise<TestResponse> => {
    const res = makeRes();
    acceptsEncodings = vi.fn(() => accepted);
    const params = key === undefined ? { name } : { key, name };
    const req = { params, headers, acceptsEncodings, url: `${GW_EMBED_STYLESHEET_ROUTE}/${name}` } as unknown as Request;
    await controller.serve(req, res, next);
    return res;
  };

  beforeEach(() => {
    getKey.mockReset().mockReturnValue(OWN_KEY);
    load = vi.fn(async () => SHEET);
    controller = new GwEmbedStylesheetController({ load } as unknown as GwEmbedStylesheetService);
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  it('answers 404 for a name that is not a hashed embed stylesheet, without asking the service', async () => {
    for (const bad of ['admin.css', '../etc/passwd', 'admin-embed-abc.css/../x', 'admin-embed-.css', 'admin-embed-abc.js', 'ADMIN-EMBED-abc.css ']) {
      next.mockClear();
      const res = await serve(bad);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('answers 404 for a key segment that is not a stylesheet key, without asking the service', async () => {
    for (const bad of ['short', 'has/slash0123456', 'toolong0123456789', 'dots..0123456789']) {
      next.mockClear();
      await serve(NAME, { key: bad });
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('sends the unkeyed form with the full header set and a revalidating cache policy', async () => {
    const res = await serve();
    expect(next).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith(expect.anything(), NAME);
    expect(Buffer.from(res.body ?? []).toString('utf8')).toBe(SHEET.css);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(SHEET.css)));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['etag']).toBe(SHEET.etag);
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.headers['cache-control']).toBe(`public, max-age=${GW_EMBED_STYLESHEET_MAX_AGE_S}, stale-while-revalidate=604800`);
    expect(res.headers['cache-control']).not.toContain('immutable');
  });

  it("serves the keyed form as immutable for a year when the key is this server's own", async () => {
    const res = await serve(NAME, { key: OWN_KEY });
    expect(load).toHaveBeenCalledWith(expect.anything(), NAME);
    expect(res.headers['cache-control']).toBe(`public, max-age=${GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S}, immutable`);
  });

  it('serves the current body under a foreign key, but never lets it be cached under that URL', async () => {
    // A page rendered by a replica of another release during a rollout: the body is still useful,
    // but pinning it as immutable under a key that names a different body would be wrong for a year.
    const res = await serve(NAME, { key: 'otherKey01234567' });
    expect(Buffer.from(res.body ?? []).toString('utf8')).toBe(SHEET.css);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('treats a key it cannot compute as a mismatch', async () => {
    getKey.mockImplementation(() => {
      throw new Error('theme unavailable');
    });
    const res = await serve(NAME, { key: OWN_KEY });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends the precompressed Brotli body when the client prefers it, with its own ETag', async () => {
    const res = await serve(NAME, { key: OWN_KEY, accepted: 'br' });
    expect(acceptsEncodings).toHaveBeenCalledWith('br', 'gzip', 'identity');
    expect(res.body).toBe(SHEET.br);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-length']).toBe(String(SHEET.br.length));
    expect(res.headers['etag']).toBe('"abc123-br"');
  });

  it('sends the precompressed gzip body when that is the best the client takes', async () => {
    const res = await serve(NAME, { accepted: 'gzip' });
    expect(res.body).toBe(SHEET.gzip);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['etag']).toBe('"abc123-gzip"');
  });

  it('falls back to the plain body, encoded once with the entry, when the client accepts no supported encoding', async () => {
    const res = await serve(NAME, { accepted: false });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(SHEET.identity);
  });

  it('answers 304 to a matching If-None-Match without a body, keeping the cache headers', async () => {
    const res = await serve(NAME, { headers: { 'if-none-match': SHEET.etag } });
    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.headers['etag']).toBe(SHEET.etag);
    expect(res.headers['cache-control']).toContain('max-age=');
  });

  it('matches If-None-Match per encoding, in a list and weakly', async () => {
    expect((await serve(NAME, { accepted: 'br', headers: { 'if-none-match': '"zzz", W/"abc123-br"' } })).statusCode).toBe(304);
    // The identity ETag does not validate the Brotli body.
    expect((await serve(NAME, { accepted: 'br', headers: { 'if-none-match': SHEET.etag } })).statusCode).toBe(200);
  });

  it('passes a service failure to the error handler untouched, marked no-store', async () => {
    const error = new MicroserviceError('The embed stylesheet is not available upstream', 502, 'gw_embed_stylesheet_upstream_status');
    load.mockRejectedValueOnce(error);
    const res = await serve();
    expect(next).toHaveBeenCalledWith(error);
    expect(res.body).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
