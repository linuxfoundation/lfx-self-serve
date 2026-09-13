// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Real-socket tests for the proxy's oversized-upload rejection.
 *
 * These exist because the unit spec cannot see this code path. It substitutes `Readable.from()`
 * for the request, and that has no socket behind it — so `req.destroy()` is a no-op there, and a
 * drain that never completes looks identical to one that does. Two consecutive defects shipped
 * through a green unit suite that way: first the 413 was written to a socket already destroyed
 * (the client got ECONNRESET), then the drain was severed by `res.end()` (the client's upload
 * never finished and the connection hung until keep-alive timed out).
 *
 * Everything here runs against a genuine `http.Server` and a genuine client socket. The upstream
 * is still stubbed — it is the client half of the connection that these assertions are about.
 */
import { createServer, request as httpRequest, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GwProxyController } from './gw-proxy.controller';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../helpers/server-feature-flag.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/server-feature-flag.helper')>('../helpers/server-feature-flag.helper');
  return { ...actual, isServerFeatureEnabled: () => true };
});
vi.mock('../helpers/gw-api.helper', () => ({ getGwApiBaseUrl: () => 'https://gw.example.test' }));

/** Small enough to reject quickly; the behaviour under test does not depend on the value. */
const LIMIT_BYTES = 64 * 1024;
const UPLOAD_BYTES = 4 * 1024 * 1024;

interface UploadResult {
  status?: number;
  body: string;
  /** Whether the client got to finish writing its request body — the thing a severed drain breaks. */
  clientFinishedWriting: boolean;
  error?: string;
}

describe('GwProxyController over a real socket', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    // Stand in for undici: drain whatever the controller forwards, and wrap a stream failure the
    // way it does, so the controller's unwrap logic is exercised rather than bypassed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body?: ReadableStream }) => {
        if (init?.body) {
          const reader = init.body.getReader();
          try {
            for (;;) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch (err) {
            throw new TypeError('fetch failed', { cause: err });
          }
        }
        return { status: 200, headers: new Headers(), body: null };
      })
    );

    const controller = new GwProxyController(LIMIT_BYTES);

    server = createServer((req, res) => {
      const expressish = Object.assign(req, { bearerToken: 'token-1', path: '/api/gw/media' }) as unknown as Request;
      const next: NextFunction = ((error: unknown) => {
        // Stands in for apiErrorHandler.
        const status = (error as { statusCode?: number })?.statusCode ?? 500;
        const code = (error as { code?: string })?.code ?? 'unknown';
        if (!res.headersSent) {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
        }
        res.end(JSON.stringify({ code }));
      }) as NextFunction;

      // A raw ServerResponse has no Express `status()`; the controller only needs that one method
      // on the success path, so shim it rather than pulling Express into the harness.
      const expressishRes = Object.assign(res, {
        status(code: number) {
          res.statusCode = code;
          return this;
        },
      }) as unknown as Response;

      void controller.proxy(expressish, expressishRes, next);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });

  const upload = (bytes: number): Promise<UploadResult> =>
    new Promise((resolve) => {
      const url = new URL(`${baseUrl}/media`);
      const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, clientFinishedWriting: finished }));
      });

      let finished = false;
      req.on('error', (err) => resolve({ status: undefined, body: '', clientFinishedWriting: finished, error: err.message }));

      // Write in chunks so the limiter trips partway through, leaving a real backlog to drain.
      const chunk = Buffer.alloc(64 * 1024);
      let written = 0;
      const pump = (): void => {
        while (written < bytes) {
          written += chunk.length;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end(() => (finished = true));
      };
      pump();
    });

  it('answers 413 rather than resetting the connection', async () => {
    // Regression: destroying the request tore down the socket before the 413 could be written, so
    // the caller saw ECONNRESET while the log recorded a 413 that never left the process.
    const result = await upload(UPLOAD_BYTES);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(413);
    expect(result.body).toContain('gw_body_too_large');
  }, 20000);

  it('lets the client finish sending before the connection is done with', async () => {
    // Regression: ending the response stops Node feeding the socket into `req`, which severs the
    // drain. The client was then left permanently unable to finish writing.
    const result = await upload(UPLOAD_BYTES);

    expect(result.clientFinishedWriting).toBe(true);
  }, 20000);

  it('passes a request under the ceiling straight through', async () => {
    const result = await upload(LIMIT_BYTES / 2);

    expect(result.status).toBe(200);
    expect(result.clientFinishedWriting).toBe(true);
  }, 20000);
});
