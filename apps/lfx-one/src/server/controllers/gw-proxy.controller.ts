// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { NextFunction, Request, Response } from 'express';

import { getGwApiBaseUrl } from '../helpers/gw-api.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';

/** Extends the DOM `RequestInit` typings with undici's streaming-body option (not declared in lib.dom.d.ts). */
type FetchRequestInit = RequestInit & { duplex?: 'half' };

/** Request headers that must never reach the upstream Gatewaze service. */
const STRIPPED_REQUEST_HEADERS = new Set(['cookie', 'host', 'content-length', 'connection', 'authorization']);

/**
 * BFF proxy in front of the embedded Gatewaze admin pilot's own backend (`GW_API_URL`), mounted
 * at `/api/gw/*` — see `gw-proxy.route.ts` for the mount and `server.ts` for why this path is
 * excluded from the global body-parsing/compression middleware.
 *
 * Every response, success or failure, carries a fresh `X-Request-Id` (`crypto.randomUUID()`) so a
 * caller and this service's logs can be correlated. This is scoped to this route only and does
 * NOT touch the global pino-http request-id configuration.
 */
export class GwProxyController {
  public async proxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const startTime = logger.startOperation(req, 'gw_proxy_request', {
      method: req.method,
      path: req.path,
    });

    // Flag-off and "not authenticated" are answered with the exact same status, body shape and
    // code path so a caller cannot distinguish "the pilot isn't enabled here" from "you're not
    // signed in" from "no such route" — see GatewazeEmbedEnabled's doc comment for why.
    //
    // ASSUMPTION (spec truncated before detailing the auth check): `req.bearerToken` — set by
    // auth.middleware.ts once a session/token has been validated — is the "authenticated" signal
    // checked here. Worth flagging: in this app's CURRENT global configuration every `/api/*`
    // path already requires a bearer token before a request reaches this controller at all (see
    // auth.middleware.ts's `DEFAULT_ROUTE_CONFIG`), so an actually-unauthenticated caller is
    // today turned away with a generic 401 upstream of this code, not this 404. This check is
    // kept anyway, per the spec's explicit instruction, as defense-in-depth / correctness
    // insurance should that global classification ever change for this path.
    if (!isServerFeatureEnabled(ServerFeatureFlag.GatewazeEmbedEnabled) || !req.bearerToken) {
      res.status(404).json({ error: 'gw_flag_disabled', requestId });
      return;
    }

    try {
      const baseUrl = getGwApiBaseUrl('gw_proxy_request');
      // `req.url` inside a router mounted at `/api/gw` is already relative to that mount point
      // (Express strips the matched prefix), and still carries the original query string — so
      // this single concatenation forwards both the remaining path and the query.
      const upstreamUrl = `${baseUrl}${req.url}`;

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
          continue;
        }
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      // Guaranteed present: the gate above already returned 404 when it was absent.
      headers.set('Authorization', `Bearer ${req.bearerToken}`);

      const hasRequestBody = req.method !== 'GET' && req.method !== 'HEAD';

      const requestInit: FetchRequestInit = {
        method: req.method,
        headers,
        // Never follow upstream redirects — pass 3xx through untouched so whatever is on the
        // other end of this proxy (the embed, or its own client) decides what to do with a
        // Location header, rather than this BFF silently chasing it.
        redirect: 'manual',
      };

      if (hasRequestBody) {
        // `/api/gw` is excluded from express.json()/express.urlencoded() (see server.ts) so `req`
        // is still an unconsumed raw stream here — forwarding it directly (rather than buffering
        // and re-serializing) proxies the body byte-for-byte regardless of content type.
        requestInit.body = req as unknown as ReadableStream<Uint8Array>;
        requestInit.duplex = 'half';
      }

      const upstream = await fetch(upstreamUrl, requestInit);

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const location = upstream.headers.get('location');
      if (location) {
        res.setHeader('Location', location);
      }

      if (upstream.body) {
        // pipeline() propagates stream errors to the catch block instead of hanging.
        await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res);
      } else {
        res.end();
      }

      logger.success(req, 'gw_proxy_request', startTime, {
        method: req.method,
        path: req.path,
        upstream_status: upstream.status,
      });
    } catch (error) {
      // Headers already committed — can only end the stream. This is the one place a controller
      // in this codebase calls logger.error() directly, because next(error) can no longer produce
      // a clean response once streaming has begun.
      if (res.headersSent) {
        logger.error(req, 'gw_proxy_request', startTime, error, {
          method: req.method,
          path: req.path,
          stage: 'streaming',
        });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      next(error);
    }
  }
}
