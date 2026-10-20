// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Real-socket tests for the `/api/gatewaze` proxy's body cap, drain, timeout and mid-stream failure.
 * These are about the client half of the connection: whether a rejected caller can finish writing and gets its answer, which only a genuine
 * `http.Server` and client socket show. The upstream is a real local server too, because
 * `proxyRequest` speaks `node:http` to it.
 */
import { createServer, IncomingMessage, request as httpRequest, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachGwDrainGuard, hasGwDrainBeenAttempted } from '../helpers/gw-api.helper';

const ANON_KEY = 'sb_publishable_synthetic';
const SITE = 'https://app.example.test';

const { config } = vi.hoisted(() => ({ config: { supabaseUrl: '' } }));

vi.mock('../services/gatewaze-session.service', () => ({
  getGatewazeSessionService: () => ({
    getGatewazeSession: async () => ({
      outcome: 'ok',
      session: { access_token: 'gw-access-synthetic', is_admin: true, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }),
  }),
  resolveGatewazeHostSessionConfig: () => ({ supabaseUrl: config.supabaseUrl, anonKey: ANON_KEY, valkeyUrl: 'redis://synthetic', authSecret: 'synthetic' }),
  isGatewazeHostSessionEnabled: () => true,
  hostSessionCoreLogger: () => ({ warn: vi.fn() }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { GatewazeProxyController } = await import('./gatewaze-proxy.controller');
const { logger } = await import('../services/logger.service');

/** Small enough to reject quickly; the behaviour under test does not depend on the value. */
const LIMIT_BYTES = 64 * 1024;
const UPLOAD_BYTES = 4 * 1024 * 1024;
const SOCKET_TEST_TIMEOUT_MS = 20_000;

interface Result {
  status?: number;
  body: string;
  clientFinishedWriting: boolean;
  error?: string;
}

let upstream: Server;
let upstreamBytes: number;
let respond: (req: IncomingMessage, res: ServerResponse) => void;
let app: Server;
let appPort: number;
/** Whether a drain had been attempted when the error path asked to respond. */
let drainedAtResponse: boolean | null;

beforeAll(async () => {
  upstream = createServer((req, res) => respond(req, res));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  config.supabaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const controller = new GatewazeProxyController(LIMIT_BYTES);
  const expressApp = express();
  // Stands in for apiRateLimiter, which covers /api/ in server.ts; high enough never to trip here.
  expressApp.use(rateLimit({ windowMs: 60_000, limit: 10_000 }));
  // Mirrors server.ts: the drain guard wraps the response before the router runs.
  expressApp.use((req, res, next) => {
    attachGwDrainGuard(req, res);
    next();
  });
  expressApp.all(/^\/api\/gatewaze\/supabase\/(rest|storage|functions)\/v1(?:\/.*)?$/i, (req, res, next) => {
    // The router's mount strips `/api/gatewaze`; this harness has no mount, so strip it here.
    req.url = req.url.slice('/api/gatewaze'.length);
    void controller.proxySupabase(req, res, next);
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only treats a four-parameter function as an error handler
  expressApp.use((error: { statusCode?: number; code?: string }, req: Request, res: Response, _next: NextFunction) => {
    drainedAtResponse = hasGwDrainBeenAttempted(req);
    res.status(error.statusCode ?? 500).json({ code: error.code ?? 'unknown' });
  });
  await new Promise<void>((resolve) => {
    app = expressApp.listen(0, '127.0.0.1', resolve);
  });
  appPort = (app.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const server of [app, upstream]) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  upstreamBytes = 0;
  drainedAtResponse = null;
  vi.stubEnv('PCC_BASE_URL', SITE);
  // Read the whole body, then answer, as Storage does for an upload.
  respond = (req, res) => {
    req.on('data', (chunk: Buffer) => (upstreamBytes += chunk.length));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end('{"Key":"media/a.bin"}');
    });
  };
});

afterEach(() => vi.unstubAllEnvs());

const headers = { authorization: 'Bearer host-session', apikey: ANON_KEY, origin: SITE, 'content-type': 'application/octet-stream' };

/** Streams `bytes` in 64 KiB chunks as a chunked upload, so no content-length tells the server the size up front. */
function upload(bytes: number): Promise<Result> {
  return new Promise((resolve) => {
    let finished = false;
    const req = httpRequest(
      { hostname: '127.0.0.1', port: appPort, path: '/api/gatewaze/supabase/storage/v1/object/media/a.bin', method: 'POST', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, clientFinishedWriting: finished }));
        res.on('error', (err) => resolve({ status: res.statusCode, body, clientFinishedWriting: finished, error: err.message }));
      }
    );
    req.on('error', (err) => resolve({ status: undefined, body: '', clientFinishedWriting: finished, error: err.message }));
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let sent = 0;
    const pump = (): void => {
      while (sent < bytes) {
        const part = chunk.subarray(0, Math.min(chunk.length, bytes - sent));
        sent += part.length;
        if (!req.write(part)) {
          req.once('drain', pump);
          return;
        }
      }
      req.end(() => (finished = true));
    };
    pump();
  });
}

describe('GatewazeProxyController over a real socket', () => {
  it(
    'forwards an upload under the cap byte for byte',
    async () => {
      const result = await upload(LIMIT_BYTES / 2);

      expect(result.status).toBe(200);
      expect(upstreamBytes).toBe(LIMIT_BYTES / 2);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'answers an upload over the cap with 413, after letting the client finish writing',
    async () => {
      const result = await upload(UPLOAD_BYTES);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(413);
      expect(JSON.parse(result.body)).toEqual({ code: 'gw_body_too_large' });
      expect(result.clientFinishedWriting).toBe(true);
      expect(drainedAtResponse).toBe(true);
      // The cap stopped the forward: the upstream saw no more than the limit plus one chunk.
      expect(upstreamBytes).toBeLessThanOrEqual(LIMIT_BYTES + 64 * 1024);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'answers 408 when the upstream socket goes idle past the timeout',
    async () => {
      vi.stubEnv('GW_PROXY_TIMEOUT_MS', '200');
      // Reads the body and never answers.
      respond = (req) => {
        req.resume();
      };

      const result = await upload(1024);

      expect(result.status).toBe(408);
      expect(JSON.parse(result.body)).toEqual({ code: 'TIMEOUT' });
      expect(result.clientFinishedWriting).toBe(true);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'answers a clean 502 without the upstream headers when the upstream dies before the first body byte',
    async () => {
      respond = (req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
            etag: '"x"',
            'cache-control': 'public, max-age=60',
            'content-length': '1000',
          });
          res.flushHeaders();
          setTimeout(() => res.socket?.destroy(), 20);
        });
      };

      const result = await new Promise<{ status?: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
        const req = httpRequest({ hostname: '127.0.0.1', port: appPort, path: '/api/gatewaze/supabase/rest/v1/x', headers }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
      });

      expect(result.status).toBe(502);
      expect(JSON.parse(result.body)).toEqual({ code: 'GW_UPSTREAM_UNAVAILABLE' });
      expect(result.headers['content-encoding']).toBeUndefined();
      // Express sets its own weak ETag on the JSON error; the upstream's is gone.
      expect(result.headers['etag']).not.toBe('"x"');
      expect(result.headers['cache-control']).toBe('no-store');
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'treats a browser that closes mid-download as ordinary, not as an upstream failure',
    async () => {
      vi.mocked(logger.error).mockClear();
      vi.mocked(logger.debug).mockClear();
      let upstreamClosed!: () => void;
      const upstreamGone = new Promise<void>((resolve) => (upstreamClosed = resolve));
      respond = (req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.write(Buffer.alloc(1024));
          // Never ends: only the browser closing finishes this response.
          res.on('close', () => upstreamClosed());
        });
      };

      await new Promise<void>((resolve) => {
        const req = httpRequest({ hostname: '127.0.0.1', port: appPort, path: '/api/gatewaze/supabase/storage/v1/object/media/a.bin', headers }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => undefined);
        req.end();
      });
      // The proxy tears down the upstream request once the browser has gone.
      await upstreamGone;

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.anything(),
        'gatewaze_proxy_request',
        'The browser closed the response before it finished',
        expect.anything()
      );
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'breaks the connection, rather than ending cleanly, when the upstream dies mid-body',
    async () => {
      respond = (req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000' });
          res.write(Buffer.alloc(100));
          setTimeout(() => res.socket?.destroy(), 20);
        });
      };

      const result = await upload(1024);

      // The headers were already out, so the only honest answer left is a broken connection.
      expect(result.status).toBe(200);
      expect(result.error).toBe('aborted');
      expect(result.body.length).toBeLessThan(1000);
    },
    SOCKET_TEST_TIMEOUT_MS
  );
});
