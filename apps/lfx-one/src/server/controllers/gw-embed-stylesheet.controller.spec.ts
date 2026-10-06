// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES,
  GW_EMBED_STYLESHEET_MAX_AGE_S,
  GW_EMBED_STYLESHEET_MAX_BYTES,
  GW_EMBED_STYLESHEET_MAX_IN_FLIGHT,
  GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS,
  GW_EMBED_STYLESHEET_ROUTE,
} from '@lfx-one/shared/constants';
import { SCOPE } from '../../../scripts/lib/contain-gw-embed-css.mjs';
import { resetGwEmbedThemeCache } from '../helpers/gw-embed.helper';
import { GwEmbedStylesheetController } from './gw-embed-stylesheet.controller';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';

type FetchResponse = globalThis.Response;

vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const EMBED_URL = 'https://admin.example.test/embed';
const NAME = 'admin-embed-C7yXdkZR.css';
const UPSTREAM_CSS = '.rt-Button{color:red}@keyframes enter{from{opacity:0}}';

type TestResponse = ExpressResponse & { body?: unknown; headers: Record<string, string>; statusCode: number; ended: boolean };

function makeRes(): TestResponse {
  const headers: Record<string, string> = {};
  const res = {
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
  return res;
}

function makeReq(name: string, headers: Record<string, string> = {}): Request {
  return { params: { name }, headers, url: `${GW_EMBED_STYLESHEET_ROUTE}/${name}` } as unknown as Request;
}

function cssResponse(body: string, init: { status?: number; contentType?: string; contentLength?: string | null } = {}): FetchResponse {
  const headers: Record<string, string> = { 'content-type': init.contentType ?? 'text/css' };
  const length = init.contentLength === undefined ? String(Buffer.byteLength(body)) : init.contentLength;
  if (length !== null) {
    headers['content-length'] = length;
  }
  return new Response(body, { status: init.status ?? 200, headers });
}

/** A chunked body with no Content-Length, `chunks` × `chunkBytes` bytes of valid CSS comments. */
function chunkedCss(chunks: number, chunkBytes: number): FetchResponse {
  const chunk = new TextEncoder().encode(`/*${'x'.repeat(chunkBytes - 4)}*/`);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/css' } });
}

describe('GwEmbedStylesheetController', () => {
  let controller: GwEmbedStylesheetController;
  let fetchMock: ReturnType<typeof vi.fn>;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  const serve = async (name = NAME, headers?: Record<string, string>): Promise<TestResponse> => {
    const res = makeRes();
    await controller.serve(makeReq(name, headers), res, next);
    return res;
  };
  const lastError = (): { statusCode?: number; code?: string } => next.mock.calls.at(-1)?.[0] as { statusCode?: number; code?: string };

  beforeEach(() => {
    process.env['GW_EMBED_URL'] = EMBED_URL;
    resetGwEmbedThemeCache();
    controller = new GwEmbedStylesheetController();
    fetchMock = vi.fn(async () => cssResponse(UPSTREAM_CSS));
    vi.stubGlobal('fetch', fetchMock);
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env['GW_EMBED_URL'];
  });

  describe('request validation', () => {
    it('answers 404 for a name that is not a hashed embed stylesheet, without touching upstream', async () => {
      for (const bad of ['admin.css', '../etc/passwd', 'admin-embed-abc.css/../x', 'admin-embed-.css', 'admin-embed-abc.js', 'ADMIN-EMBED-abc.css ']) {
        next.mockClear();
        await serve(bad);
        expect(lastError()).toMatchObject({ statusCode: 404 });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('fetches the named file from GW_EMBED_URL, scopes it, appends the theme and sets the full header set', async () => {
      const res = await serve();

      expect(next).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${EMBED_URL}/${NAME}`);
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));

      expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe(`public, max-age=${GW_EMBED_STYLESHEET_MAX_AGE_S}, stale-while-revalidate=604800`);
      expect(res.headers['cache-control']).not.toContain('immutable');
      expect(res.headers['etag']).toMatch(/^"[A-Za-z0-9_-]{43}"$/);

      const body = String(res.body);
      // Scoped: the upstream rule now sits under the host containers; the keyframe is namespaced.
      expect(body).toContain(SCOPE);
      expect(body).not.toMatch(/^\.rt-Button/m);
      expect(body).toContain('@keyframes gw-embed-enter');
      // The theme layer follows the contained CSS.
      expect(body).toContain('LFX theme for the embedded Gatewaze admin');
      expect(body.indexOf('gw-embed-enter')).toBeLessThan(body.indexOf('LFX theme for the embedded Gatewaze admin'));
    });

    it('serves a repeat request for the same name from memory', async () => {
      const first = await serve();
      const again = await serve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(again.body).toBe(first.body);
      expect(again.headers['etag']).toBe(first.headers['etag']);
    });

    it('answers 304 to a matching If-None-Match without a body', async () => {
      const first = await serve();
      const revalidated = await serve(NAME, { 'if-none-match': first.headers['etag'] });
      expect(revalidated.statusCode).toBe(304);
      expect(revalidated.ended).toBe(true);
      expect(revalidated.body).toBeUndefined();
      expect(revalidated.headers['etag']).toBe(first.headers['etag']);
      expect(revalidated.headers['cache-control']).toBe(first.headers['cache-control']);
    });

    it('coalesces concurrent first requests into one upstream fetch', async () => {
      await Promise.all([serve(), serve()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('evicts the oldest cached sheet once the cap is reached', async () => {
      const names = Array.from({ length: GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES + 1 }, (_, i) => `admin-embed-rel${i}.css`);
      for (const name of names) {
        await serve(name);
      }
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // The newest are still cached...
      await serve(names[names.length - 1]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // ...the first one was evicted and is fetched again.
      await serve(names[0]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length + 1);
    });
  });

  describe('upstream guards', () => {
    it('rejects a declared Content-Length over the cap or not finite, before reading the body', async () => {
      for (const declared of [String(GW_EMBED_STYLESHEET_MAX_BYTES + 1), 'abc', '-1', 'Infinity']) {
        next.mockClear();
        controller = new GwEmbedStylesheetController();
        fetchMock.mockImplementationOnce(async () => cssResponse(UPSTREAM_CSS, { contentLength: declared }));
        await serve();
        expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_too_large' });
      }
    });

    it('stops reading a body with no Content-Length as soon as it crosses the cap', async () => {
      const chunkBytes = 64 * 1024;
      const atCap = Math.ceil(GW_EMBED_STYLESHEET_MAX_BYTES / chunkBytes);
      const chunks = atCap + 50;
      let pulled = 0;
      const chunk = new TextEncoder().encode(`/*${'x'.repeat(chunkBytes - 4)}*/`);
      const stream = new ReadableStream<Uint8Array>({
        pull(ctl) {
          if (pulled >= chunks) {
            ctl.close();
            return;
          }
          pulled += 1;
          ctl.enqueue(chunk);
        },
      });
      fetchMock.mockImplementationOnce(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/css' } }));

      await serve();
      expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_too_large' });
      // Cancelled at the cap, not drained: the stream's one-chunk read-ahead aside, nothing past
      // the cap was pulled.
      expect(pulled).toBeGreaterThanOrEqual(atCap);
      expect(pulled).toBeLessThanOrEqual(atCap + 2);
    });

    it('accepts a chunked body under the cap', async () => {
      fetchMock.mockImplementationOnce(async () => {
        const stream = chunkedCss(3, 1024);
        // Prepend a real rule so the zero-rule guard does not fire.
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(ctl) {
              ctl.enqueue(new TextEncoder().encode(UPSTREAM_CSS));
              const reader = stream.body!.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                ctl.enqueue(value);
              }
              ctl.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/css' } }
        );
      });
      const res = await serve();
      expect(next).not.toHaveBeenCalled();
      expect(String(res.body)).toContain(SCOPE);
    });

    it('rejects a non-CSS content type and does not cache it', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('<html>proxy error</html>', { contentType: 'text/html' }));
      await serve();
      expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_bad_content_type' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a body that contains no rules after the transform', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('/* nothing here */'));
      await serve();
      expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_empty' });
    });

    it('reports a transport failure, a timeout and a refused redirect as 502 with a static message', async () => {
      for (const failure of [
        new Error('connect ECONNREFUSED'),
        Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
        new TypeError('unexpected redirect'),
      ]) {
        next.mockClear();
        controller = new GwEmbedStylesheetController();
        fetchMock.mockImplementationOnce(async () => {
          throw failure;
        });
        await serve();
        const error = lastError() as { statusCode?: number; code?: string; message?: string };
        expect(error).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_unreachable' });
        expect(error.message).not.toContain(failure.message);
      }
    });

    it('maps an upstream 404 to 404 and other statuses to 502 without echoing the status in the message', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 404 }));
      await serve('admin-embed-missing.css');
      expect(lastError()).toMatchObject({ statusCode: 404, code: 'gw_embed_stylesheet_upstream_status' });

      next.mockClear();
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 503 }));
      await serve('admin-embed-down.css');
      const error = lastError() as { message?: string };
      expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_upstream_status' });
      expect(error.message).not.toContain('503');
    });
  });

  describe('self-braking', () => {
    it('remembers a failed name for the negative-cache window instead of refetching', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 500 }));
      await serve();
      expect(lastError()).toMatchObject({ statusCode: 502 });

      next.mockClear();
      await serve();
      expect(lastError()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_upstream_status' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS + 1);
      next.mockClear();
      const res = await serve();
      expect(next).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(res.body)).toContain(SCOPE);
    });

    it('does not remember a misconfiguration, so fixing the env takes effect at once', async () => {
      delete process.env['GW_EMBED_URL'];
      await serve();
      expect(lastError()).toMatchObject({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' });

      process.env['GW_EMBED_URL'] = EMBED_URL;
      next.mockClear();
      await serve();
      expect(next).not.toHaveBeenCalled();
    });

    it('caps concurrent upstream fetches across names and answers the rest with 503', async () => {
      const gates: (() => void)[] = [];
      fetchMock.mockImplementation(
        () =>
          new Promise<FetchResponse>((resolve) => {
            gates.push(() => resolve(cssResponse(UPSTREAM_CSS)));
          })
      );
      const names = Array.from({ length: GW_EMBED_STYLESHEET_MAX_IN_FLIGHT + 1 }, (_, i) => `admin-embed-par${i}.css`);
      const pending = names.map((name) => serve(name));
      await Promise.resolve();
      // The one over the cap is refused immediately, before any gate opens.
      expect(fetchMock).toHaveBeenCalledTimes(GW_EMBED_STYLESHEET_MAX_IN_FLIGHT);
      gates.forEach((open) => open());
      await Promise.all(pending);
      expect(next).toHaveBeenCalledTimes(1);
      expect(lastError()).toMatchObject({ statusCode: 503, code: 'gw_embed_stylesheet_busy' });
    });
  });

  describe('configuration', () => {
    it('answers 503 with a named code when GW_EMBED_URL is unset or unusable, without fetching', async () => {
      for (const bad of [
        undefined,
        '',
        `${EMBED_URL}/`,
        'ftp://admin.example.test/embed',
        'https://user:pw@admin.example.test/embed',
        'not a url',
        `${EMBED_URL}?x=1`,
      ]) {
        next.mockClear();
        if (bad === undefined) {
          delete process.env['GW_EMBED_URL'];
        } else {
          process.env['GW_EMBED_URL'] = bad;
        }
        await serve();
        expect(lastError()).toMatchObject({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
