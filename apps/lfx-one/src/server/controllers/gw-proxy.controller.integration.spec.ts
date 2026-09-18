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

import { GW_DRAIN_TIMEOUT_MS } from '@lfx-one/shared/constants';

import { attachGwDrainGuard, drainRequestBody, hasGwDrainBeenAttempted } from '../helpers/gw-api.helper';
import { GwProxyController } from './gw-proxy.controller';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../helpers/server-feature-flag.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/server-feature-flag.helper')>('../helpers/server-feature-flag.helper');
  return { ...actual, isServerFeatureEnabled: () => true };
});
vi.mock('../helpers/gw-api.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/gw-api.helper')>('../helpers/gw-api.helper');
  return { ...actual, getGwApiBaseUrl: () => 'https://gw.example.test' };
});

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

/** Multi-megabyte socket tests need more than the default. Applied to every upload test here. */
const SOCKET_TEST_TIMEOUT_MS = 20_000;

describe('GwProxyController over a real socket', () => {
  let server: Server;
  let baseUrl: string;
  /** Marker state at the moment the error path asks to respond — the guard's decision point. */
  let markerAtResponse: boolean | null = null;

  beforeEach(async () => {
    markerAtResponse = null;
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
        markerAtResponse = hasGwDrainBeenAttempted(expressish);
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

      // Mirrors server.ts's mount order: the drain guard wraps the response BEFORE the controller
      // runs, exactly as it does in production. Without this the harness could not observe the
      // interaction between the guard and the controller's own drain at all — which is what let the
      // 413 double-drain regression sit untested.
      attachGwDrainGuard(expressish, expressishRes);

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

  it(
    'answers 413 rather than resetting the connection',
    async () => {
      // Regression: destroying the request tore down the socket before the 413 could be written, so
      // the caller saw ECONNRESET while the log recorded a 413 that never left the process.
      const result = await upload(UPLOAD_BYTES);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(413);
      expect(result.body).toContain('gw_body_too_large');

      // Asserted on the same run rather than a third 4MB upload of its own: this path must drain
      // through `drainRequestBody` rather than a private copy of the protocol, because only the
      // shared helper marks the request for `attachGwDrainGuard`. Reverting to the old hand-rolled
      // inline promise leaves the marker unset and fails here.
      //
      // Read inside the error handler, the moment `patchedEnd` would decide. It proves the marker
      // is SET, not that the guard consults it — by now `readableEnded` is true, so the guard
      // short-circuits before the marker clause. `attachGwDrainGuard over a real socket` covers
      // that branch with a client still sending.
      expect(markerAtResponse).toBe(true);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'lets the client finish sending before the connection is done with',
    async () => {
      // Regression: ending the response stops Node feeding the socket into `req`, which severs the
      // drain. The client was then left permanently unable to finish writing.
      const result = await upload(UPLOAD_BYTES);

      expect(result.clientFinishedWriting).toBe(true);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'passes a request under the ceiling straight through',
    async () => {
      const result = await upload(LIMIT_BYTES / 2);

      expect(result.status).toBe(200);
      expect(result.clientFinishedWriting).toBe(true);
    },
    SOCKET_TEST_TIMEOUT_MS
  );
});

/**
 * The pre-router rejection path, on a real socket.
 *
 * This is the case the controller never sees: `authMiddleware` (401) and `apiRateLimiter` (429)
 * answer before `/api/gw` reaches the proxy, and the body parsers are excluded, so nothing has
 * consumed the upload. Without a drain the connection cannot be finished with.
 *
 * It needs a real socket because the defect is invisible in isolation — an earlier fix hooked
 * `res.once('close', …)`, which looks like a drain, passes any unit-level assertion about the
 * listener being attached, and drains nothing at all because it runs after `finish`.
 */
describe('attachGwDrainGuard over a real socket', () => {
  let server: Server | undefined;
  let baseUrl: string;

  /** Answers 401 without reading the body, standing in for authMiddleware. */
  const start = async (withGuard: boolean): Promise<void> => {
    const created = createServer((req, res) => {
      if (withGuard) {
        attachGwDrainGuard(req as unknown as Request, res as unknown as Response);
      }
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 'UNAUTHORIZED' }));
    });
    server = created;
    await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(created.address() as AddressInfo).port}`;
  };

  const post = (bytes: number): Promise<{ status?: number; clientFinishedWriting: boolean; written: number }> =>
    new Promise((resolve) => {
      const url = new URL(`${baseUrl}/media`);
      let finished = false;
      let written = 0;
      const req = httpRequest(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-length': String(bytes) } },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode, clientFinishedWriting: finished, written }));
        }
      );
      req.on('error', () => resolve({ status: undefined, clientFinishedWriting: finished, written }));

      const chunk = Buffer.alloc(64 * 1024);
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

  afterEach(async () => {
    // Guarded: the cap-returned-drain test manages its own local server and never assigns this
    // one, so running it alone (`-t`/`.only`) reaches here with `server` still undefined — and an
    // afterEach that throws masks the real test result. Captured into a const so the narrowing
    // survives into the callback.
    const running = server;
    if (!running) {
      return;
    }
    await new Promise<void>((resolve) => {
      running.closeAllConnections?.();
      running.close(() => resolve());
    });
  });

  it(
    'lets the client finish its upload after an early rejection',
    async () => {
      await start(true);

      const result = await post(8 * 1024 * 1024);

      expect(result.status).toBe(401);
      expect(result.clientFinishedWriting).toBe(true);
      expect(result.written).toBe(8 * 1024 * 1024);
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'does not start a second drain when the first one returned on its cap',
    async () => {
      // Additive rather than gap-filling: `patchedEnd`'s marker clause is already covered
      // discriminatingly at the unit level below. What this adds is the real-socket consequence of
      // getting it wrong — the clause only matters while `readableEnded` is false, a client still
      // sending when the response is decided, which is what happens when a drain returns on its cap
      // rather than on 'end', and the cost of missing it is latency a unit test cannot show.
      //
      // Constructed rather than hoped for: the handler drains with a 5ms cap against a client that
      // sends a little and then stalls, so the drain returns with the request still open. With the
      // marker honoured the response goes out immediately; without it the guard starts a second
      // drain and the client waits the full GW_DRAIN_TIMEOUT_MS. Asserting on elapsed time is what
      // discriminates, so the threshold sits far below that cap and far above a healthy path.
      const stallServer = createServer((req, res) => {
        const expressish = req as unknown as Request;
        attachGwDrainGuard(expressish, res as unknown as Response);
        void drainRequestBody(expressish, 5).then(() => {
          res.statusCode = 403;
          res.end('denied');
        });
      });
      await new Promise<void>((resolve) => stallServer.listen(0, '127.0.0.1', resolve));

      try {
        const port = (stallServer.address() as AddressInfo).port;
        const started = Date.now();
        const status = await new Promise<number | undefined>((resolve) => {
          const req = httpRequest(
            { hostname: '127.0.0.1', port, path: '/media', method: 'POST', headers: { 'content-length': String(8 * 1024 * 1024) } },
            (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode));
            }
          );
          req.on('error', () => resolve(undefined));
          // Send a little, then stall — never call end(), so the body stays open.
          req.write(Buffer.alloc(1024));
        });

        expect(status).toBe(403);
        expect(Date.now() - started).toBeLessThan(GW_DRAIN_TIMEOUT_MS / 2);
      } finally {
        stallServer.closeAllConnections?.();
        await new Promise<void>((resolve) => stallServer.close(() => resolve()));
      }
    },
    SOCKET_TEST_TIMEOUT_MS
  );

  it(
    'without the guard, the client never finishes writing — the defect this exists to prevent',
    async () => {
      // The control. An assertion that only checks the guarded case passes just as happily against a
      // guard that drains nothing, which is exactly what shipped once already.
      await start(false);

      const result = await post(8 * 1024 * 1024);

      expect(result.clientFinishedWriting).toBe(false);
      expect(result.written).toBeLessThan(8 * 1024 * 1024);
    },
    SOCKET_TEST_TIMEOUT_MS
  );
});

/**
 * The guard's cheap paths, which do not need a socket.
 *
 * Its docblock claims two things that were previously backed by prose only: that an
 * already-consumed request sees no delay, and that a request someone has already drained is not
 * drained a second time. The second is what stops this doubling rejection latency against a slow
 * client, so it is the one most worth pinning.
 */
describe('attachGwDrainGuard fast paths', () => {
  const fakeRes = (): { res: Response; ended: string[] } => {
    const ended: string[] = [];
    const res = { end: (...args: unknown[]) => ended.push(String(args[0] ?? '')) } as unknown as Response;
    return { res, ended };
  };

  it('writes straight through when the body is already consumed', () => {
    const req = { readableEnded: true, destroyed: false, method: 'POST' } as unknown as Request;
    const { res, ended } = fakeRes();
    attachGwDrainGuard(req, res);

    res.end('body');

    // Synchronous: no drain was started, so nothing was deferred.
    expect(ended).toEqual(['body']);
  });

  it('writes straight through on a destroyed request', () => {
    const req = { readableEnded: false, destroyed: true, method: 'POST' } as unknown as Request;
    const { res, ended } = fakeRes();
    attachGwDrainGuard(req, res);

    res.end('body');

    expect(ended).toEqual(['body']);
  });

  it('does not drain a second time when a caller already drained', async () => {
    // The latency finding. `requireGwEmbedAccess` and the controller both await a drain before
    // responding, and against a slow client that returns on its cap with readableEnded still false
    // — so without the marker this would start another full-cap wait behind a caller that already
    // waited once, doubling worst-case rejection latency.
    const req = { readableEnded: false, destroyed: false, method: 'POST', resume: () => undefined, once: () => undefined } as unknown as Request;
    await drainRequestBody(req, 1);
    const { res, ended } = fakeRes();
    attachGwDrainGuard(req, res);

    res.end('body');

    expect(hasGwDrainBeenAttempted(req)).toBe(true);
    expect(ended).toEqual(['body']);
  });

  it('swallows a throw from the deferred write instead of crashing the process', async () => {
    // Without the .catch this is an unhandled rejection, and nothing installs an
    // unhandledRejection handler — so the default is a process exit, strictly worse than the
    // connection hang the guard exists to prevent. Untested, a refactor that drops the .catch
    // would keep the suite green, which is exactly the regression this round fixed.
    const listeners: Record<string, () => void> = {};
    const req = {
      readableEnded: false,
      destroyed: false,
      method: 'POST',
      resume: () => undefined,
      once: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
    } as unknown as Request;
    const res = {
      end: () => {
        throw new Error('socket closed');
      },
    } as unknown as Response;
    attachGwDrainGuard(req, res);

    res.end('body');
    listeners['end']?.();

    // Settles without rejecting. A leaked rejection fails the run via vitest's own handler.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(true).toBe(true);
  });

  it('ignores a second end() while a drain is still pending', () => {
    // Calling res.end() twice is ordinary in Express error paths. Without the re-entrancy guard the
    // second call queues a second deferred write, replaying end() on a response the first replay
    // has already finished — which throws asynchronously, with no handler to catch it.
    const listeners: Record<string, () => void> = {};
    const req = {
      readableEnded: false,
      destroyed: false,
      method: 'POST',
      resume: () => undefined,
      once: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
    } as unknown as Request;
    const { res, ended } = fakeRes();
    attachGwDrainGuard(req, res);

    res.end('first');
    res.end('second');

    // Neither has been written yet — the drain has not settled.
    expect(ended).toEqual([]);
    listeners['end']?.();
    return Promise.resolve().then(() => {
      expect(ended).toEqual(['first']);
    });
  });
});
