// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express, { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';

type LayerHandle = (...args: unknown[]) => unknown;

interface ExpressLayer {
  handle: LayerHandle;
  handle_request(req: Request, res: Response, next: NextFunction): void;
  handle_error(error: unknown, req: Request, res: Response, next: NextFunction): void;
}

let bridgeInstalled = false;
let rejectionLoggerInstalled = false;

/**
 * Forwards a rejected promise returned by any route handler or middleware to `next(err)`.
 *
 * Express 4 discards the value a handler returns, so an `async` handler that throws outside its own
 * `try` becomes an unhandled rejection that never reaches `apiErrorHandler` — and, with no
 * `unhandledRejection` listener, Node exits the process. This gives every layer Express 5's
 * semantics. Remove it when the server moves to Express 5, which does this natively.
 */
export function installAsyncRouteErrorBridge(): void {
  if (bridgeInstalled) {
    return;
  }

  const layerPrototype = resolveLayerPrototype();

  // Same arity rules as Express 4.21's own implementations; only the returned value is new.
  layerPrototype.handle_request = function handleRequest(this: ExpressLayer, req: Request, res: Response, next: NextFunction): void {
    const fn = this.handle;
    if (fn.length > 3) {
      next();
      return;
    }

    try {
      forwardRejection(fn(req, res, next), next);
    } catch (error) {
      next(error);
    }
  };

  layerPrototype.handle_error = function handleError(this: ExpressLayer, error: unknown, req: Request, res: Response, next: NextFunction): void {
    const fn = this.handle;
    if (fn.length !== 4) {
      next(error);
      return;
    }

    try {
      forwardRejection(fn(error, req, res, next), next);
    } catch (thrown) {
      next(thrown);
    }
  };

  bridgeInstalled = true;
}

/**
 * Logs a promise rejection nothing handled, instead of letting Node's default `throw` mode exit the
 * process. One stray rejection must not take down every in-flight request and SSR render on the pod.
 * Uncaught synchronous exceptions keep Node's default behaviour.
 */
export function installUnhandledRejectionLogger(): void {
  if (rejectionLoggerInstalled) {
    return;
  }

  process.on('unhandledRejection', (reason) => {
    logger.error(undefined, 'unhandled_rejection', Date.now(), reason);
  });

  rejectionLoggerInstalled = true;
}

// Taken from a live router built with the imported `express` rather than from
// `express/lib/router/layer`: the server bundle inlines Express, so a deep import could resolve a
// second copy and patch a prototype no request ever uses.
function resolveLayerPrototype(): ExpressLayer {
  const probe = express.Router();
  probe.get('/', () => undefined);

  const [layer] = (probe as unknown as { stack: ExpressLayer[] }).stack;
  const prototype = layer ? (Object.getPrototypeOf(layer) as ExpressLayer) : undefined;

  if (!prototype || typeof prototype.handle_request !== 'function' || typeof prototype.handle_error !== 'function') {
    throw new Error('Express router Layer no longer exposes handle_request/handle_error; remove installAsyncRouteErrorBridge if on Express 5');
  }

  return prototype;
}

function forwardRejection(result: unknown, next: NextFunction): void {
  if (!isThenable(result)) {
    return;
  }

  // A non-Error reason is wrapped: a rejection with the string 'route' or 'router' would otherwise
  // be read by `next` as a routing instruction instead of an error.
  result.then(undefined, (reason: unknown) => {
    next(reason instanceof Error ? reason : new Error('Route handler rejected with a non-Error value', { cause: reason }));
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}
