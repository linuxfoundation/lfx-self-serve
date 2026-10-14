// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createServer, IncomingHttpHeaders, IncomingMessage, request as httpRequest, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The host contract on the proxy (steps 3 to 6 of the `@gatewaze/host-session` README), run through
 * Express against a real local upstream so the headers and paths the upstream receives are the
 * ones asserted. The router's LFX gates have their own spec (gatewaze.route.spec.ts), and the
 * body cap, drain and timeout are in the integration spec.
 */

const ANON_KEY = 'sb_publishable_synthetic';
const SITE = 'https://app.example.test';

const { getGatewazeSession, authorizeGatewazeModule, config } = vi.hoisted(() => ({
  getGatewazeSession: vi.fn(),
  authorizeGatewazeModule: vi.fn(async () => true),
  config: { value: null as null | { supabaseUrl: string; anonKey: string; valkeyUrl: string; authSecret: string } },
}));

vi.mock('../services/gatewaze-session.service', () => ({
  getGatewazeSessionService: () => ({ getGatewazeSession }),
  resolveGatewazeHostSessionConfig: () => config.value,
  isGatewazeHostSessionEnabled: () => config.value !== null,
  hostSessionCoreLogger: () => ({ warn: vi.fn() }),
}));
vi.mock('../helpers/gatewaze-module.helper', async () => ({
  ...(await vi.importActual<typeof import('../helpers/gatewaze-module.helper')>('../helpers/gatewaze-module.helper')),
  authorizeGatewazeModule,
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { GatewazeProxyController, mountLocation } = await import('./gatewaze-proxy.controller');

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let upstream: Server;
let upstreamUrl: string;
let seen: Seen | null;
let respond: (req: IncomingMessage, res: ServerResponse) => void;

let app: Server;
let appUrl: string;

const adminSession = { access_token: 'gw-access-synthetic', is_admin: true, expires_at: Math.floor(Date.now() / 1000) + 3600 };

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body };
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const controller = new GatewazeProxyController();
  const router = express.Router();
  // Mirrors gatewaze.route.ts: no-store on every response unless the proxy replaces it.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.all(/^\/supabase\/(rest|storage|functions)\/v1(?:\/.*)?$/i, (req, res, next) => controller.proxySupabase(req, res, next));
  router.all(/^\/api(?:\/.*)?$/i, (req, res, next) => controller.proxyApi(req, res, next));
  const expressApp = express();
  expressApp.disable('x-powered-by');
  // Stands in for apiRateLimiter, which covers /api/ in server.ts; high enough never to trip here.
  expressApp.use(rateLimit({ windowMs: 60_000, limit: 10_000 }));
  expressApp.use('/api/gatewaze', router);
  // Stands in for apiErrorHandler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only treats a four-parameter function as an error handler
  expressApp.use((error: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.statusCode ?? 500).json({ code: error.code ?? 'unknown' });
  });
  await new Promise<void>((resolve) => {
    app = expressApp.listen(0, '127.0.0.1', resolve);
  });
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([app, upstream].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

beforeEach(() => {
  vi.clearAllMocks();
  seen = null;
  respond = (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  };
  config.value = { supabaseUrl: upstreamUrl, anonKey: ANON_KEY, valkeyUrl: 'redis://synthetic', authSecret: 'synthetic' };
  vi.stubEnv('PCC_BASE_URL', SITE);
  vi.stubEnv('GW_API_URL', upstreamUrl);
  getGatewazeSession.mockResolvedValue({ outcome: 'ok', session: adminSession });
  authorizeGatewazeModule.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A raw request, so browser-forbidden headers (Cookie, Origin) can be set as a browser would send them. */
function send(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    // `path` rather than a URL string: a URL string is normalised, which would resolve the dot
    // segments the path-containment tests send.
    const { hostname, port } = new URL(appUrl);
    const req = httpRequest({ hostname, port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** What supabase-js sends from the embed in host-session mode. */
const shimHeaders = { authorization: 'Bearer host-session', apikey: ANON_KEY, cookie: 'appSession=synthetic-lfx-sid', origin: SITE };

describe('GatewazeProxyController', () => {
  describe('token swap', () => {
    it('forwards a PostgREST read with the session token in place of the placeholder', async () => {
      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters?select=id&access_token=host-session', { headers: shimHeaders });

      expect(res.status).toBe(200);
      expect(seen?.url).toBe('/rest/v1/newsletters?select=id');
      expect(seen?.headers['authorization']).toBe(`Bearer ${adminSession.access_token}`);
      expect(seen?.headers['apikey']).toBe(ANON_KEY);
    });

    it('never forwards the cookie, origin, referer or client-address headers', async () => {
      await send('/api/gatewaze/supabase/rest/v1/newsletters', {
        headers: { ...shimHeaders, referer: `${SITE}/foundation/gw`, 'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9', via: '1.1 synthetic' },
      });

      for (const name of ['cookie', 'origin', 'referer', 'x-real-ip', 'cf-connecting-ip', 'via']) {
        expect(seen?.headers[name], name).toBeUndefined();
      }
    });

    it("sends LFX's resolved client address as X-Forwarded-For, never the browser's own chain", async () => {
      await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: { ...shimHeaders, 'x-forwarded-for': '198.51.100.7' } });

      // No `trust proxy` in this harness, so req.ip is the socket peer.
      expect(seen?.headers['x-forwarded-for']).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    });

    it('forwards a write with its body, keeping the shim headers PostgREST reads', async () => {
      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', {
        method: 'POST',
        headers: { ...shimHeaders, 'content-type': 'application/json', prefer: 'return=representation' },
        body: '{"title":"synthetic"}',
      });

      expect(res.status).toBe(200);
      expect(seen?.method).toBe('POST');
      expect(seen?.body).toBe('{"title":"synthetic"}');
      expect(seen?.headers['prefer']).toBe('return=representation');
    });

    it.each(['storage', 'functions'])('proxies %s under its own prefix', async (service) => {
      await send(`/api/gatewaze/supabase/${service}/v1/some/path`, { headers: shimHeaders });

      expect(seen?.url).toBe(`/${service}/v1/some/path`);
      expect(seen?.headers['authorization']).toBe(`Bearer ${adminSession.access_token}`);
    });

    it('forwards the Gatewaze API with the /api path kept, the bearer and no apikey', async () => {
      const res = await send('/api/gatewaze/api/modules/newsletters/editions?limit=5', { headers: shimHeaders });

      expect(res.status).toBe(200);
      expect(seen?.url).toBe('/api/modules/newsletters/editions?limit=5');
      expect(seen?.headers['authorization']).toBe(`Bearer ${adminSession.access_token}`);
      expect(seen?.headers['apikey']).toBeUndefined();
    });

    it('keeps no-store on a response whose upstream sent no Cache-Control', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'ok', session: { ...adminSession, is_admin: false } });

      const res = await send('/api/gatewaze/supabase/rest/v1/platform_settings', { headers: shimHeaders });

      expect(res.status).toBe(200);
      // An anon forward, so the package adds no private Cache-Control of its own.
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('marks a response made with the session private and varying on Cookie', async () => {
      respond = (_req, res) => {
        res.setHeader('cache-control', 'public, max-age=60');
        res.end('[]');
      };

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.headers['cache-control']).toBe('private, max-age=60');
      expect(res.headers['vary']).toContain('Cookie');
    });
  });

  describe('CSRF', () => {
    it('refuses a cross-site write with 403 before any session is loaded', async () => {
      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', {
        method: 'POST',
        headers: { ...shimHeaders, origin: 'https://attacker.example' },
        body: '{}',
      });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'cross_site' });
      expect(getGatewazeSession).not.toHaveBeenCalled();
      expect(seen).toBeNull();
    });

    it('refuses a same-site write with neither apikey nor a bearer, as a cross-site form post would send it', async () => {
      const res = await send('/api/gatewaze/api/modules/newsletters/send', { method: 'POST', headers: { cookie: 'appSession=x' }, body: 'a=1' });

      expect(res.status).toBe(403);
      expect(seen).toBeNull();
    });

    it('refuses every request that needs proof when PCC_BASE_URL is missing', async () => {
      vi.stubEnv('PCC_BASE_URL', '');

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(403);
      expect(seen).toBeNull();
    });

    it('forwards a cross-site GET as anon, without loading the session', async () => {
      const res = await send('/api/gatewaze/supabase/storage/v1/object/public/media/a.png', { headers: { origin: 'https://attacker.example' } });

      expect(res.status).toBe(200);
      expect(getGatewazeSession).not.toHaveBeenCalled();
      // A publishable key is not a JWT, so anon goes in apikey only.
      expect(seen?.headers['apikey']).toBe(ANON_KEY);
      expect(seen?.headers['authorization']).toBeUndefined();
    });

    it('refuses a cross-site CORS preflight with 403', async () => {
      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', {
        method: 'OPTIONS',
        headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey' },
      });

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(seen).toBeNull();
    });

    it('never passes upstream CORS headers through', async () => {
      respond = (_req, res) => {
        res.setHeader('access-control-allow-origin', '*');
        res.end();
      };

      const res = await send('/api/gatewaze/supabase/storage/v1/object/public/media/a.png', { headers: { 'sec-fetch-site': 'same-origin' } });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('session outcomes', () => {
    it('answers 401 with the expiry marker when the LFX session has ended', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'ended' });

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(401);
      expect(res.headers['x-gw-session']).toBe('expired');
      expect(JSON.parse(res.body)).toEqual({ error: 'not_signed_in' });
      expect(seen).toBeNull();
    });

    it('answers 401 with the marker for a placeholder request with no store-backed session', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'host_session_unavailable' });

      const res = await send('/api/gatewaze/api/modules/newsletters/editions', { headers: shimHeaders });

      expect(res.status).toBe(401);
      expect(res.headers['x-gw-session']).toBe('expired');
      expect(seen).toBeNull();
    });

    it('forwards as anon when there is no session and no placeholder', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'host_session_unavailable' });

      const res = await send('/api/gatewaze/supabase/rest/v1/platform_settings', { headers: { apikey: ANON_KEY, origin: SITE } });

      expect(res.status).toBe(200);
      expect(seen?.headers['authorization']).toBeUndefined();
    });

    it.each(['refused', 'unavailable'])('answers 503 without the marker when the session is %s', async (outcome) => {
      getGatewazeSession.mockResolvedValue({ outcome });

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(503);
      expect(res.headers['x-gw-session']).toBeUndefined();
      expect(JSON.parse(res.body)).toEqual({ error: 'session_unavailable' });
    });

    it('refuses a non-admin with 403 and never attaches their token', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'ok', session: { ...adminSession, is_admin: false } });

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'not_admin' });
      expect(seen).toBeNull();
    });

    it("forwards a non-admin's public read as anon", async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'ok', session: { ...adminSession, is_admin: false } });

      const res = await send('/api/gatewaze/supabase/rest/v1/platform_settings', { headers: shimHeaders });

      expect(res.status).toBe(200);
      expect(seen?.headers['authorization']).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('answers 503 with Retry-After while the admin check is pending', async () => {
      getGatewazeSession.mockResolvedValue({ outcome: 'ok', session: { ...adminSession, is_admin: false, admin_check: 'pending' } });

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'admin_check_pending' });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('paths', () => {
    it.each([
      ['dot segments', '/api/gatewaze/supabase/rest/v1/../../auth/v1/user'],
      ['encoded dot segments', '/api/gatewaze/supabase/rest/v1/%2e%2e/%2e%2e/auth/v1/user'],
      ['an API path out of /api', '/api/gatewaze/api/../admin'],
    ])('answers 400 for %s that leave the prefix, before any session is loaded', async (_label, path) => {
      const res = await send(path, { headers: shimHeaders });

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ code: 'GW_BAD_PATH' });
      expect(getGatewazeSession).not.toHaveBeenCalled();
      expect(seen).toBeNull();
    });

    it('answers 503 when GW_API_URL carries a base path the package would drop', async () => {
      vi.stubEnv('GW_API_URL', `${upstreamUrl}/v2`);

      const res = await send('/api/gatewaze/api/modules/x', { headers: shimHeaders });

      expect(res.status).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ code: 'GW_API_URL_MISCONFIGURED' });
    });

    it('answers the uniform 404 when host-session mode turned off after the gate ran', async () => {
      config.value = null;

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ code: 'NOT_FOUND' });
    });
  });

  describe('module entitlement seam', () => {
    it('asks the hook about the module an API path names', async () => {
      await send('/api/gatewaze/api/modules/newsletters/editions', { headers: shimHeaders });

      expect(authorizeGatewazeModule).toHaveBeenCalledWith(expect.anything(), 'newsletters');
    });

    it('refuses with 403 when the hook refuses, before any session is loaded', async () => {
      authorizeGatewazeModule.mockResolvedValue(false);

      const res = await send('/api/gatewaze/api/modules/newsletters/editions', { headers: shimHeaders });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ code: 'GW_MODULE_ACCESS_REQUIRED' });
      expect(getGatewazeSession).not.toHaveBeenCalled();
      expect(seen).toBeNull();
    });

    it('does not ask about Supabase paths, which map to no module yet', async () => {
      await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(authorizeGatewazeModule).not.toHaveBeenCalled();
    });
  });

  describe('response headers', () => {
    it('keeps the allowlist, drops cookies, the upstream session marker and credential prompts, and adds nosniff and the CSP sandbox', async () => {
      respond = (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-range', '0-0/1');
        res.setHeader('set-cookie', 'upstream=1');
        res.setHeader('x-gw-session', 'expired');
        res.setHeader('x-powered-by', 'synthetic');
        res.setHeader('www-authenticate', 'Basic realm="synthetic"');
        res.setHeader('content-security-policy', 'default-src *');
        res.end('<script></script>');
      };

      const res = await send('/api/gatewaze/supabase/storage/v1/object/media/a.html', { headers: shimHeaders });

      expect(res.headers['content-type']).toBe('text/html');
      expect(res.headers['content-range']).toBe('0-0/1');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['x-gw-session']).toBeUndefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['www-authenticate']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    });

    it.each([
      [
        'a redirect to the upstream origin',
        () => `${upstreamUrl}/storage/v1/object/sign/media/a.png?token=t`,
        '/api/gatewaze/supabase/storage/v1/object/sign/media/a.png?token=t',
      ],
      ['a root-relative redirect', () => '/rest/v1/other', '/api/gatewaze/supabase/rest/v1/other'],
      ['an https redirect elsewhere', () => 'https://accounts.example.test/o/oauth2/auth', 'https://accounts.example.test/o/oauth2/auth'],
    ])('maps %s onto the mount, without following it', async (_label, location, expected) => {
      respond = (_req, res) => {
        res.statusCode = 302;
        res.setHeader('location', location());
        res.end();
      };

      const res = await send('/api/gatewaze/supabase/storage/v1/object/media/a.png', { headers: shimHeaders });

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(expected);
    });

    it.each([
      ['a protocol-relative redirect', '//attacker.example/x'],
      ['a path-relative redirect that walks off the mount', '../../../../../../settings'],
      ['a root-relative redirect that walks off the mount', '/../../../logout'],
    ])('drops %s', async (_label, location) => {
      respond = (_req, res) => {
        res.statusCode = 302;
        res.setHeader('location', location);
        res.end();
      };

      const res = await send('/api/gatewaze/supabase/storage/v1/object/media/a.png', { headers: shimHeaders });

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBeUndefined();
    });

    it('drops an unsafe redirect', async () => {
      respond = (_req, res) => {
        res.statusCode = 302;
        res.setHeader('location', 'javascript:alert(1)');
        res.end();
      };

      const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBeUndefined();
    });
  });

  it('answers 502 when the upstream cannot be reached', async () => {
    config.value = { supabaseUrl: 'http://127.0.0.1:1', anonKey: ANON_KEY, valkeyUrl: 'redis://synthetic', authSecret: 'synthetic' };

    const res = await send('/api/gatewaze/supabase/rest/v1/newsletters', { headers: shimHeaders });

    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ code: 'GW_UPSTREAM_UNAVAILABLE' });
  });
});

describe('mountLocation', () => {
  const requestPath = '/api/gatewaze/supabase/storage/v1/object/media/a.png';
  it.each([
    ['/rest/v1/x', '/api/gatewaze/supabase/rest/v1/x'],
    ['moved?page=2', '/api/gatewaze/supabase/storage/v1/object/media/moved?page=2'],
    ['../b.png', '/api/gatewaze/supabase/storage/v1/object/b.png'],
    ['https://elsewhere.example/x', 'https://elsewhere.example/x'],
    ['//elsewhere.example/x', null],
    ['../../../../../../settings', null],
    ['../../../../../x', null],
    ['/../../../logout', null],
    ['/%2e%2e/%2e%2e/%2e%2e/logout', null],
    ['/rest/v1/../../storage/v1/object/a', '/api/gatewaze/supabase/storage/v1/object/a'],
  ])('maps %s', (location, expected) => {
    expect(mountLocation(location, '/api/gatewaze/supabase', requestPath)).toBe(expected);
  });
});
