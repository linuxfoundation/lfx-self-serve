// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pinoHttp from 'pino-http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { authMiddleware } from './auth.middleware';
import { createBrowserAssetsMiddleware } from './browser-assets.middleware';
import { apiErrorHandler } from './error-handler.middleware';

describe('browser assets before authentication', () => {
  let server: Server;
  let baseUrl: string;
  let browserFolder: string;
  const oidc = vi.fn();
  const render = vi.fn();

  beforeAll(async () => {
    browserFolder = await mkdtemp(join(tmpdir(), 'lfx-browser-assets-'));
    await Promise.all([
      writeFile(join(browserFolder, 'chunk-ABCDEFGH.js'), 'export const loaded = true;'),
      writeFile(join(browserFolder, 'styles-ABCDEFGH.css'), 'body { display: block; }'),
      writeFile(join(browserFolder, 'main.js'), 'export const development = true;'),
      writeFile(join(browserFolder, 'robots.txt'), 'User-agent: *'),
    ]);

    const app = express();
    app.use(createBrowserAssetsMiddleware(browserFolder));
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
  });

  it.each([
    ['/main.js', 'no-cache, must-revalidate'],
    ['/robots.txt', 'public, max-age=300'],
  ])('preserves the successful-response policy for %s', async (path, cacheControl) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(cacheControl);
    expect(oidc).not.toHaveBeenCalled();
  });

  it.each(['/', '/project/overview', '/u/chunk-IJKLMNOP.js/settings', '/profile/avatar.png', '/chunk-short.js', '/project/overview?file=chunk-IJKLMNOP.js'])(
    'does not bypass normal page authentication for %s',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://sso.example/authorize');
      expect(oidc).toHaveBeenCalledTimes(1);
      expect(render).not.toHaveBeenCalled();
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
  });

  it('does not intercept non-read methods', async () => {
    const response = await fetch(`${baseUrl}/chunk-IJKLMNOP.js`, { method: 'POST', redirect: 'manual' });

    expect(response.status).toBe(401);
    expect(oidc).toHaveBeenCalledTimes(1);
  });

  it('keeps the production asset boundary before both OIDC and selective authentication', async () => {
    // Importing server.ts boots Angular and configures OIDC/infrastructure. Keep this a source
    // guard; the HTTP tests above exercise routing. Anchor calls to exclude line-commented copies
    // and tolerate formatting changes, including multiline calls.
    const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
    const assetMountPattern = /^\s*app\.use\s*\(\s*createBrowserAssetsMiddleware\s*\(\s*browserDistFolder\s*\)\s*\)/m;
    const oidcMountPattern = /^\s*app\.use\s*\(\s*auth\s*\(\s*authConfig\s*\)\s*\)/m;
    const authMountPattern = /^\s*app\.use\s*\(\s*authMiddleware\s*\)/m;

    // The guard must work for both the current source and a reformatted equivalent.
    const multilineSource = source
      .replace(assetMountPattern, '\napp.use(\n  createBrowserAssetsMiddleware(\n    browserDistFolder\n  )\n)')
      .replace(oidcMountPattern, '\napp.use(\n  auth(\n    authConfig\n  )\n)')
      .replace(authMountPattern, '\napp.use(\n  authMiddleware\n)');

    for (const variant of [source, multilineSource]) {
      const assetMount = variant.search(assetMountPattern);
      expect(assetMount).toBeGreaterThan(-1);
      expect(variant.search(oidcMountPattern)).toBeGreaterThan(assetMount);
      expect(variant.search(authMountPattern)).toBeGreaterThan(assetMount);
    }
    expect('// app.use(createBrowserAssetsMiddleware(browserDistFolder));'.search(assetMountPattern)).toBe(-1);
    expect('// app.use(auth(authConfig));'.search(oidcMountPattern)).toBe(-1);
    expect('// app.use(authMiddleware);'.search(authMountPattern)).toBe(-1);
  });
});
