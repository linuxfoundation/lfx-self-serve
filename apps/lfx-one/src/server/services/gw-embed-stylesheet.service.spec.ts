// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES,
  GW_EMBED_STYLESHEET_FAILURE_CACHE_MAX_ENTRIES,
  GW_EMBED_STYLESHEET_MAX_BYTES,
  GW_EMBED_STYLESHEET_MAX_IN_FLIGHT,
  GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS,
} from '@lfx-one/shared/constants';
import { SCOPE } from '../../../scripts/lib/contain-gw-embed-css.mjs';
import { resetGwEmbedThemeCache } from '../helpers/gw-embed.helper';
import { GwEmbedStylesheetService } from './gw-embed-stylesheet.service';
import type { GwEmbedScopedStylesheet } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

type FetchResponse = globalThis.Response;

vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const EMBED_URL = 'https://admin.example.test/embed';
const NAME = 'admin-embed-C7yXdkZR.css';
const UPSTREAM_CSS = '.rt-Button{color:red}@keyframes enter{from{opacity:0}}';

function makeReq(): Request {
  return { headers: {} } as unknown as Request;
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

describe('GwEmbedStylesheetService', () => {
  let service: GwEmbedStylesheetService;
  let fetchMock: ReturnType<typeof vi.fn>;

  const load = (name = NAME): Promise<GwEmbedScopedStylesheet> => service.load(makeReq(), name);
  const failure = async (name = NAME): Promise<{ statusCode?: number; code?: string; message?: string }> => {
    try {
      await load(name);
    } catch (error) {
      return error as { statusCode?: number; code?: string; message?: string };
    }
    throw new Error(`expected load(${name}) to reject`);
  };

  beforeEach(() => {
    process.env['GW_EMBED_URL'] = EMBED_URL;
    resetGwEmbedThemeCache();
    service = new GwEmbedStylesheetService();
    fetchMock = vi.fn(async () => cssResponse(UPSTREAM_CSS));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env['GW_EMBED_URL'];
  });

  describe('success path', () => {
    it('fetches the named file from GW_EMBED_URL, scopes it, appends the theme and derives an ETag', async () => {
      const sheet = await load();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${EMBED_URL}/${NAME}`);
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
      expect(sheet.etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);

      // Scoped: the upstream rule now sits under the host containers; the keyframe is namespaced.
      expect(sheet.css).toContain(SCOPE);
      expect(sheet.css).not.toMatch(/^\.rt-Button/m);
      expect(sheet.css).toContain('@keyframes gw-embed-enter');
      // The theme layer follows the contained CSS.
      expect(sheet.css).toContain('LFX theme for the embedded Gatewaze admin');
      expect(sheet.css.indexOf('gw-embed-enter')).toBeLessThan(sheet.css.indexOf('LFX theme for the embedded Gatewaze admin'));
    });

    it('serves a repeat request for the same name from memory', async () => {
      const first = await load();
      const again = await load();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(again).toBe(first);
    });

    it('coalesces concurrent first requests into one upstream fetch', async () => {
      const [a, b] = await Promise.all([load(), load()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
    });

    it('evicts the oldest cached sheet once the cap is reached', async () => {
      const names = Array.from({ length: GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES + 1 }, (_, i) => `admin-embed-rel${i}.css`);
      for (const name of names) {
        await load(name);
      }
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // The newest are still cached...
      await load(names[names.length - 1]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // ...the first one was evicted and is fetched again.
      await load(names[0]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length + 1);
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
      const sheet = await load();
      expect(sheet.css).toContain(SCOPE);
    });
  });

  describe('upstream guards', () => {
    it('rejects a declared Content-Length over the cap or not finite, before reading the body', async () => {
      for (const declared of [String(GW_EMBED_STYLESHEET_MAX_BYTES + 1), 'abc', '-1', 'Infinity']) {
        service = new GwEmbedStylesheetService();
        fetchMock.mockImplementationOnce(async () => cssResponse(UPSTREAM_CSS, { contentLength: declared }));
        expect(await failure()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_too_large' });
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

      expect(await failure()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_too_large' });
      // Cancelled at the cap, not drained: the stream's one-chunk read-ahead aside, nothing past
      // the cap was pulled.
      expect(pulled).toBeGreaterThanOrEqual(atCap);
      expect(pulled).toBeLessThanOrEqual(atCap + 2);
    });

    it('rejects a non-CSS content type and does not cache it', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('<html>proxy error</html>', { contentType: 'text/html' }));
      expect(await failure()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_bad_content_type' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a body that contains no rules after the transform', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('/* nothing here */'));
      expect(await failure()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_empty' });
    });

    it('reports a transport failure, a timeout and a refused redirect as 502 with a static message', async () => {
      for (const cause of [
        new Error('connect ECONNREFUSED'),
        Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
        new TypeError('unexpected redirect'),
      ]) {
        service = new GwEmbedStylesheetService();
        fetchMock.mockImplementationOnce(async () => {
          throw cause;
        });
        const error = await failure();
        expect(error).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_unreachable' });
        expect(error.message).not.toContain(cause.message);
      }
    });

    it('maps an upstream 404 to 404 and other statuses to 502 without echoing the status in the message', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 404 }));
      expect(await failure('admin-embed-missing.css')).toMatchObject({ statusCode: 404, code: 'gw_embed_stylesheet_upstream_status' });

      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 503 }));
      const error = await failure('admin-embed-down.css');
      expect(error).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_upstream_status' });
      expect(error.message).not.toContain('503');
    });
  });

  describe('self-braking', () => {
    it('remembers a failed name for the negative-cache window instead of refetching', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 500 }));
      expect(await failure()).toMatchObject({ statusCode: 502 });

      expect(await failure()).toMatchObject({ statusCode: 502, code: 'gw_embed_stylesheet_upstream_status' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS + 1);
      const sheet = await load();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sheet.css).toContain(SCOPE);
    });

    it('bounds the failure memory, dropping expired entries first and then the oldest', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => cssResponse('nope', { status: 500 }));
      const names = Array.from({ length: GW_EMBED_STYLESHEET_FAILURE_CACHE_MAX_ENTRIES + 1 }, (_, i) => `admin-embed-bad${i}.css`);
      for (const name of names) {
        await failure(name);
      }
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // The newest failure is remembered...
      await failure(names[names.length - 1]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length);
      // ...the oldest was evicted to make room and is fetched again.
      await failure(names[0]);
      expect(fetchMock).toHaveBeenCalledTimes(names.length + 1);
    });

    it('does not remember an upstream 404, so a rollout race clears on the next request', async () => {
      fetchMock.mockImplementationOnce(async () => cssResponse('nope', { status: 404 }));
      expect(await failure()).toMatchObject({ statusCode: 404 });
      const sheet = await load();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sheet.css).toContain(SCOPE);
    });

    it('does not remember a misconfiguration, so fixing the env takes effect at once', async () => {
      delete process.env['GW_EMBED_URL'];
      expect(await failure()).toMatchObject({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' });

      process.env['GW_EMBED_URL'] = EMBED_URL;
      await expect(load()).resolves.toMatchObject({ css: expect.stringContaining(SCOPE) });
    });

    it('caps concurrent upstream fetches across names and refuses the rest with 503', async () => {
      const gates: (() => void)[] = [];
      fetchMock.mockImplementation(
        () =>
          new Promise<FetchResponse>((resolve) => {
            gates.push(() => resolve(cssResponse(UPSTREAM_CSS)));
          })
      );
      const names = Array.from({ length: GW_EMBED_STYLESHEET_MAX_IN_FLIGHT + 1 }, (_, i) => `admin-embed-par${i}.css`);
      const pending = names.map((name) =>
        load(name).then(
          () => null,
          (error: unknown) => error as { statusCode?: number; code?: string }
        )
      );
      await Promise.resolve();
      // The one over the cap is refused immediately, before any gate opens.
      expect(fetchMock).toHaveBeenCalledTimes(GW_EMBED_STYLESHEET_MAX_IN_FLIGHT);
      gates.forEach((open) => open());
      const outcomes = await Promise.all(pending);
      expect(outcomes.filter((o) => o !== null)).toEqual([expect.objectContaining({ statusCode: 503, code: 'gw_embed_stylesheet_busy' })]);
    });
  });

  describe('configuration', () => {
    it('rejects with 503 and a named code when GW_EMBED_URL is unset or unusable, without fetching', async () => {
      for (const bad of [
        undefined,
        '',
        `${EMBED_URL}/`,
        'ftp://admin.example.test/embed',
        'https://user:pw@admin.example.test/embed',
        'not a url',
        `${EMBED_URL}?x=1`,
      ]) {
        if (bad === undefined) {
          delete process.env['GW_EMBED_URL'];
        } else {
          process.env['GW_EMBED_URL'] = bad;
        }
        expect(await failure()).toMatchObject({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
