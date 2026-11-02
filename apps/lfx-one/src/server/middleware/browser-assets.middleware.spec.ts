// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { BROWSER_ASSET_MISS_LOG_INTERVAL_MS, BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH } from '@lfx-one/shared/constants';
import express from 'express';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pinoHttp from 'pino-http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../services/logger.service';
import { authMiddleware } from './auth.middleware';
import { createBrowserAssetsMiddleware } from './browser-assets.middleware';
import { apiErrorHandler } from './error-handler.middleware';

describe('browser assets before authentication', () => {
  let server: Server;
  let baseUrl: string;
  let browserFolder: string;
  let browserAssets: ReturnType<typeof createBrowserAssetsMiddleware>;
  let now: number;
  let rejectRequestLogAccess: boolean;
  const oidc = vi.fn();
  const render = vi.fn();
  const requestLogRead = vi.fn();

  // Other application operations may also log: only inspect this operation's calls.
  function assetMissLogs() {
    return vi.mocked(logger.info).mock.calls.filter(([, operation]) => operation === 'browser_asset_miss');
  }

  beforeAll(async () => {
    browserFolder = await mkdtemp(join(tmpdir(), 'lfx-browser-assets-'));
    await Promise.all([
      writeFile(join(browserFolder, 'chunk-ABCDEFGH.js'), 'export const loaded = true;'),
      writeFile(join(browserFolder, 'styles-ABCDEFGH.css'), 'body { display: block; }'),
      writeFile(join(browserFolder, 'main.js'), 'export const development = true;'),
      writeFile(join(browserFolder, 'robots.txt'), 'User-agent: *'),
    ]);

    const app = express();
    app.use((req, _res, next) => {
      if (rejectRequestLogAccess) {
        Object.defineProperty(req, 'log', {
          get: () => {
            requestLogRead();
            throw new Error('Request logger is not available before pino-http');
          },
        });
      }
      next();
    });
    app.use((req, res, next) => browserAssets(req, res, next));
    app.use(pinoHttp({ level: 'silent', autoLogging: false }));
    // Only the OIDC provider boundary is a stand-in. Exercise the real auth classification and
    // API error handler, without making network calls to an identity provider.
    app.use((req, res, next) => {
      oidc();
      Object.defineProperty(req, 'oidc', { value: { isAuthenticated: () => false } });
      Object.defineProperty(res, 'oidc', {
        value: {
          login: () => {
            res.cookie('auth_verification', 'synthetic-transaction');
            res.redirect('https://sso.example/authorize');
          },
        },
      });
      next();
    });
    app.use(authMiddleware);
    app.use(apiErrorHandler);
    app.use((_req, res) => {
      render();
      res.send('SSR page');
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    oidc.mockClear();
    render.mockClear();
    requestLogRead.mockClear();
    rejectRequestLogAccess = false;
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    browserAssets = createBrowserAssetsMiddleware(browserFolder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    } finally {
      if (browserFolder) await rm(browserFolder, { recursive: true, force: true });
    }
  });

  it.each(['/chunk-ABCDEFGH.js', '/styles-ABCDEFGH.css'])('preserves successful hashed-asset caching for %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toMatch(/javascript|css/);
    expect(await response.text()).not.toBe('');
    expect(oidc).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(assetMissLogs()).toHaveLength(0);
  });

  it.each(['/main-IJKLMNOP.js', '/chunk-IJKLMNOP.js', '/styles-IJKLMNOP.css', '/polyfills-IJKLMNOP.js', '/chunk-IJKLMNOP.js?retry=1', '/%63hunk-IJKLMNOP.js'])(
    'returns a non-cacheable 404 for missing %s without invoking OIDC or SSR',
    async (path) => {
      for (const cookie of ['', 'appSession=synthetic-session']) {
        const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: { Cookie: cookie } });

        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.text()).toBe('Not found');
      }
      expect(oidc).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(assetMissLogs()).toHaveLength(1);
      expect(assetMissLogs()[0][0]).toBeUndefined();
      expect(assetMissLogs()[0][3]).toMatchObject({ asset_path: decodeURIComponent(path.split('?')[0]), method: 'GET', status_code: 404 });
    }
  );

  it('handles HEAD for a missing bundle without a response body or authentication', async () => {
    const response = await fetch(`${baseUrl}/chunk-IJKLMNOP.js`, { method: 'HEAD', redirect: 'manual' });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
    expect(oidc).not.toHaveBeenCalled();
    expect(assetMissLogs()).toHaveLength(1);
    expect(assetMissLogs()[0][3]).toMatchObject({ method: 'HEAD' });
  });

  it.each([
    ['/main.js', 'no-cache, must-revalidate'],
    ['/robots.txt', 'public, max-age=300'],
  ])('preserves the successful-response policy for %s', async (path, cacheControl) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(cacheControl);
    expect(oidc).not.toHaveBeenCalled();
    expect(assetMissLogs()).toHaveLength(0);
  });

  it.each(['/', '/project/overview', '/u/chunk-IJKLMNOP.js/settings', '/profile/avatar.png', '/chunk-short.js', '/project/overview?file=chunk-IJKLMNOP.js'])(
    'does not bypass normal page authentication for %s',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://sso.example/authorize');
      expect(oidc).toHaveBeenCalledTimes(1);
      expect(render).not.toHaveBeenCalled();
      expect(assetMissLogs()).toHaveLength(0);
    }
  );

  it('preserves the protected API JSON 401 even when its last segment looks like a bundle', async () => {
    const response = await fetch(`${baseUrl}/api/documents/chunk-IJKLMNOP.js`, { redirect: 'manual' });

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(oidc).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(assetMissLogs()).toHaveLength(0);
  });

  it('does not intercept non-read methods', async () => {
    const response = await fetch(`${baseUrl}/chunk-IJKLMNOP.js`, { method: 'POST', redirect: 'manual' });

    expect(response.status).toBe(401);
    expect(oidc).toHaveBeenCalledTimes(1);
    expect(assetMissLogs()).toHaveLength(0);
  });

  it('logs the first miss with explicit version data without reading a request logger', async () => {
    vi.stubEnv('APP_VERSION', 'synthetic-release-1169');
    rejectRequestLogAccess = true;

    const response = await fetch(`${baseUrl}/%63hunk-IJKLMNOP.js`, { redirect: 'manual' });

    expect(response.status).toBe(404);
    expect(requestLogRead).not.toHaveBeenCalled();
    expect(assetMissLogs()).toEqual([
      [
        undefined,
        'browser_asset_miss',
        'Browser bundle unavailable',
        { asset_path: '/chunk-IJKLMNOP.js', version: 'synthetic-release-1169', status_code: 404, method: 'GET' },
      ],
    ]);
  });

  it.each([undefined, ''])('uses development when APP_VERSION is %s', async (version) => {
    vi.stubEnv('APP_VERSION', version);

    expect((await fetch(`${baseUrl}/main-IJKLMNOP.js`)).status).toBe(404);
    expect(assetMissLogs()[0][3]).toMatchObject({ version: 'development' });
  });

  it('shares one throttle across distinct filenames and callers', async () => {
    for (let index = 0; index < 12; index++) {
      const response = await fetch(`${baseUrl}/chunk-${String(index).padStart(8, '0')}.js`, {
        headers: { 'X-Forwarded-For': `192.0.2.${index + 1}` },
      });
      expect(response.status).toBe(404);
    }

    expect(assetMissLogs()).toHaveLength(1);
    expect(assetMissLogs()[0][3]).toMatchObject({ asset_path: '/chunk-00000000.js' });
  });

  it('refills only after 30 seconds of monotonic time and never accumulates an idle burst', async () => {
    expect((await fetch(`${baseUrl}/main-IJKLMNOP.js`)).status).toBe(404);
    now = BROWSER_ASSET_MISS_LOG_INTERVAL_MS - 1;
    expect((await fetch(`${baseUrl}/chunk-IJKLMNOP.js`, { method: 'HEAD' })).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(1);

    now = BROWSER_ASSET_MISS_LOG_INTERVAL_MS;
    expect((await fetch(`${baseUrl}/styles-IJKLMNOP.css`)).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(2);
    expect(assetMissLogs()[1][3]).toMatchObject({ asset_path: '/styles-IJKLMNOP.css' });

    now = BROWSER_ASSET_MISS_LOG_INTERVAL_MS * 10;
    expect((await fetch(`${baseUrl}/polyfills-IJKLMNOP.js`, { method: 'HEAD' })).status).toBe(404);
    expect((await fetch(`${baseUrl}/chunk-QRSTUVWX.js`)).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(3);
    expect(assetMissLogs()[2][3]).toMatchObject({ method: 'HEAD' });
  });

  it('does not log arbitrary filename prefixes or let them consume the logging window', async () => {
    expect((await fetch(`${baseUrl}/private-user-marker-ABCDEFGH.js`)).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(0);
    expect((await fetch(`${baseUrl}/chunk-IJKLMNOP.js`)).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(1);
    expect(JSON.stringify(assetMissLogs())).not.toContain('private-user-marker');
  });

  it('allowlists metadata without leaking queries, headers, cookies, addresses or the request Host', async () => {
    vi.stubEnv('APP_VERSION', 'synthetic-release');
    const response = await fetch(`${baseUrl}/chunk-IJKLMNOP.js?private_query_marker=private-value`, {
      headers: {
        Authorization: 'Bearer private-auth-marker',
        Cookie: 'appSession=private-cookie-marker',
        'User-Agent': 'private-agent-marker',
        Referer: 'https://private-referrer.example/private-page',
        'X-Forwarded-For': '192.0.2.77',
        'X-Forwarded-Host': 'private-forwarded-host.example',
        Host: 'private-host.example',
      },
    });

    expect(response.status).toBe(404);
    expect(assetMissLogs()).toHaveLength(1);
    expect(assetMissLogs()[0][3]).toEqual({ asset_path: '/chunk-IJKLMNOP.js', version: 'synthetic-release', status_code: 404, method: 'GET' });
    const output = JSON.stringify(assetMissLogs());
    expect(output).not.toContain('private');
    expect(output).not.toContain('192.0.2.77');
    expect(output).not.toContain(baseUrl);
  });

  it('caps the decoded asset pathname in the log', async () => {
    const path = `/chunk-${'A'.repeat(BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH * 2)}.js`;
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(404);
    expect(assetMissLogs()).toHaveLength(1);
    expect(assetMissLogs()[0][3]?.['asset_path']).toBe(path.slice(0, BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH));
  });

  it('preserves the 404 and the throttle when the logger throws', async () => {
    vi.mocked(logger.info).mockImplementation(() => {
      throw new Error('Synthetic logger failure');
    });

    for (const path of ['/chunk-IJKLMNOP.js', '/main-QRSTUVWX.js']) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.text()).toBe('Not found');
    }
    expect(assetMissLogs()).toHaveLength(1);
    expect(oidc).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    now = BROWSER_ASSET_MISS_LOG_INTERVAL_MS;
    expect((await fetch(`${baseUrl}/styles-QRSTUVWX.css`)).status).toBe(404);
    expect(assetMissLogs()).toHaveLength(2);
  });

  it('keeps the production asset boundary before pino-http, OIDC and selective authentication', async () => {
    // Importing server.ts boots Angular and configures OIDC/infrastructure. Keep this a source
    // guard; the HTTP tests above exercise routing. Anchor calls to exclude line-commented copies
    // and tolerate formatting changes, including multiline calls.
    const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
    const assetMountPattern = /^\s*app\.use\s*\(\s*createBrowserAssetsMiddleware\s*\(\s*browserDistFolder\s*\)\s*\)/m;
    const oidcMountPattern = /^\s*app\.use\s*\(\s*auth\s*\(\s*authConfig\s*\)\s*\)/m;
    const authMountPattern = /^\s*app\.use\s*\(\s*authMiddleware\s*\)/m;
    const httpLoggerMountPattern = /^\s*app\.use\s*\(\s*httpLogger\s*\)/m;

    // The guard must work for both the current source and a reformatted equivalent.
    const multilineSource = source
      .replace(assetMountPattern, '\napp.use(\n  createBrowserAssetsMiddleware(\n    browserDistFolder\n  )\n)')
      .replace(oidcMountPattern, '\napp.use(\n  auth(\n    authConfig\n  )\n)')
      .replace(httpLoggerMountPattern, '\napp.use(\n  httpLogger\n)')
      .replace(authMountPattern, '\napp.use(\n  authMiddleware\n)');

    for (const variant of [source, multilineSource]) {
      const assetMount = variant.search(assetMountPattern);
      expect(assetMount).toBeGreaterThan(-1);
      expect(variant.search(oidcMountPattern)).toBeGreaterThan(assetMount);
      expect(variant.search(authMountPattern)).toBeGreaterThan(assetMount);
      expect(variant.search(httpLoggerMountPattern)).toBeGreaterThan(assetMount);
    }
    expect('// app.use(createBrowserAssetsMiddleware(browserDistFolder));'.search(assetMountPattern)).toBe(-1);
    expect('// app.use(auth(authConfig));'.search(oidcMountPattern)).toBe(-1);
    expect('// app.use(authMiddleware);'.search(authMountPattern)).toBe(-1);
    expect('// app.use(httpLogger);'.search(httpLoggerMountPattern)).toBe(-1);
  });
});
