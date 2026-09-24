// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// `apiErrorHandler` → `../errors` transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import express, { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: loggerError,
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const { installAsyncRouteErrorBridge, installUnhandledRejectionLogger } = await import('./async-route-errors');
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;
const errorHandlerSaw = vi.fn();

beforeAll(async () => {
  installAsyncRouteErrorBridge();
  // Idempotent: a second install must not wrap the already-patched layer again.
  installAsyncRouteErrorBridge();

  const app = express();
  app.use(express.json());

  const router = express.Router();

  // The linuxfoundation/lfx-self-serve-ops#48 shape: the body is dereferenced before the handler's
  // own `try`, so a `{}` body throws inside the async method and rejects the returned promise.
  router.post('/registrants', async (req: Request, res: Response, next: NextFunction) => {
    const registrants = (req.body as unknown[] | undefined)?.map((registrant) => registrant);
    try {
      res.json({ count: registrants?.length ?? 0 });
    } catch (error) {
      next(error);
    }
  });

  router.use('/async-middleware', async () => {
    throw new Error('async middleware failed');
  });
  router.get('/async-middleware', (_req, res) => {
    res.json({ reached: true });
  });

  router.get('/rejects-with-route', () => Promise.reject('route'));
  router.get('/rejects-with-route', (_req, res) => {
    res.json({ skippedToNextRoute: true });
  });

  router.get('/sync-throw', () => {
    throw new Error('sync failure');
  });

  router.get('/async-ok', async (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/async-error-handler', (_req, _res, next) => next(new Error('first failure')));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only treats a four-parameter function as an error handler
  router.use('/async-error-handler', async (_error: unknown, _req: Request, _res: Response, _next: NextFunction) => {
    throw new Error('error handler failed');
  });

  app.use('/api', router);
  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    errorHandlerSaw(error);
    apiErrorHandler(error, req, res, next);
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  errorHandlerSaw.mockClear();
  loggerError.mockClear();
});

describe('installAsyncRouteErrorBridge', () => {
  it.each([
    ['an object body', '{}'],
    ['an object whose map key is not a function', '{"map":1}'],
  ])('answers a pre-try throw from %s with an error response instead of crashing', async (_label, body) => {
    const response = await fetch(`${baseUrl}/registrants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    expect(response.status).toBe(500);
    expect(errorHandlerSaw).toHaveBeenCalledWith(expect.any(TypeError));
  });

  it('keeps serving other requests after a handler rejects', async () => {
    await fetch(`${baseUrl}/registrants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

    const response = await fetch(`${baseUrl}/async-ok`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('leaves well-formed requests on async handlers untouched', async () => {
    const response = await fetch(`${baseUrl}/registrants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[{"email":"a@example.com"}]',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });
    expect(errorHandlerSaw).not.toHaveBeenCalled();
  });

  it('forwards a rejection from async middleware and stops the chain', async () => {
    const response = await fetch(`${baseUrl}/async-middleware`);

    expect(response.status).toBe(500);
    expect(errorHandlerSaw).toHaveBeenCalledWith(expect.objectContaining({ message: 'async middleware failed' }));
  });

  it('wraps a non-Error rejection so a string reason is not read as a routing instruction', async () => {
    const response = await fetch(`${baseUrl}/rejects-with-route`);

    expect(response.status).toBe(500);
    const [forwarded] = errorHandlerSaw.mock.calls[0] as [Error];
    expect(forwarded).toBeInstanceOf(Error);
    expect(forwarded.cause).toBe('route');
  });

  it('still converts a synchronous throw, as Express 4 did', async () => {
    const response = await fetch(`${baseUrl}/sync-throw`);

    expect(response.status).toBe(500);
    expect(errorHandlerSaw).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync failure' }));
  });

  it('forwards a rejection from an async error-handling middleware', async () => {
    const response = await fetch(`${baseUrl}/async-error-handler`);

    expect(response.status).toBe(500);
    expect(errorHandlerSaw).toHaveBeenCalledWith(expect.objectContaining({ message: 'error handler failed' }));
  });
});

describe('installUnhandledRejectionLogger', () => {
  it('registers one listener that logs the rejection instead of letting the process exit', () => {
    // The listener is captured rather than registered: vitest keeps its own `unhandledRejection`
    // listener, and a real registration would outlive this test.
    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    installUnhandledRejectionLogger();
    installUnhandledRejectionLogger();

    const registrations = onSpy.mock.calls.filter(([event]) => event === 'unhandledRejection');
    onSpy.mockRestore();

    expect(registrations).toHaveLength(1);

    const listener = registrations[0][1] as (reason: unknown) => void;
    const reason = new TypeError('req.body?.map is not a function');
    listener(reason);

    expect(loggerError).toHaveBeenCalledWith(undefined, 'unhandled_rejection', expect.any(Number), reason);
  });
});
