// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GW_EMBED_STYLESHEET_ROUTE } from '@lfx-one/shared/constants';
import { SCOPE } from '../../../scripts/lib/contain-gw-embed-css.mjs';
import { GwEmbedStylesheetController } from './gw-embed-stylesheet.controller';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const EMBED_URL = 'https://admin.example.test/embed';
const NAME = 'admin-embed-C7yXdkZR.css';
const UPSTREAM_CSS = '.rt-Button{color:red}@keyframes enter{from{opacity:0}}';

function makeRes(): Response & { body?: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    send: vi.fn(function (this: { body?: unknown }, body: unknown) {
      this.body = body;
    }),
  } as unknown as Response & { body?: unknown; headers: Record<string, string> };
  return res;
}

function makeReq(name: string): Request {
  return { params: { name }, url: `${GW_EMBED_STYLESHEET_ROUTE}/${name}` } as unknown as Request;
}

describe('GwEmbedStylesheetController', () => {
  let controller: GwEmbedStylesheetController;
  let fetchMock: ReturnType<typeof vi.fn>;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env['GW_EMBED_URL'] = EMBED_URL;
    controller = new GwEmbedStylesheetController();
    fetchMock = vi.fn(async () => new Response(UPSTREAM_CSS, { status: 200, headers: { 'content-type': 'text/css', 'content-length': String(UPSTREAM_CSS.length) } }));
    vi.stubGlobal('fetch', fetchMock);
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GW_EMBED_URL'];
  });

  it('answers 404 for a name that is not a hashed embed stylesheet, without touching upstream', async () => {
    for (const bad of ['admin.css', '../etc/passwd', 'admin-embed-abc.css/../x', 'admin-embed-.css', 'admin-embed-abc.js']) {
      next.mockClear();
      await controller.serve(makeReq(bad), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the named file from GW_EMBED_URL, scopes it, appends the theme and caches by name', async () => {
    const res = makeRes();
    await controller.serve(makeReq(NAME), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${EMBED_URL}/${NAME}`);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error' }));
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-control']).toContain('immutable');

    const body = String(res.body);
    // Scoped: the upstream rule now sits under the host containers; the keyframe is namespaced.
    expect(body).toContain(SCOPE);
    expect(body).not.toMatch(/^\.rt-Button/m);
    expect(body).toContain('@keyframes gw-embed-enter');
    // The theme layer follows the contained CSS.
    expect(body).toContain('LFX theme for the embedded Gatewaze admin');
    expect(body.indexOf('gw-embed-enter')).toBeLessThan(body.indexOf('LFX theme for the embedded Gatewaze admin'));

    // Second request for the same hashed name is served from cache.
    const again = makeRes();
    await controller.serve(makeReq(NAME), again, next);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.body).toBe(res.body);
  });

  it('coalesces concurrent first requests into one upstream fetch', async () => {
    await Promise.all([controller.serve(makeReq(NAME), makeRes(), next), controller.serve(makeReq(NAME), makeRes(), next)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('reports an upstream failure as 502 and a missing file as 404', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await controller.serve(makeReq(NAME), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 502 }));

    next.mockClear();
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 404 }));
    await controller.serve(makeReq('admin-embed-other.css'), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('answers 503 with a named code when GW_EMBED_URL is unset or malformed', async () => {
    delete process.env['GW_EMBED_URL'];
    await controller.serve(makeReq(NAME), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' }));

    next.mockClear();
    process.env['GW_EMBED_URL'] = `${EMBED_URL}/`;
    await controller.serve(makeReq(NAME), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
