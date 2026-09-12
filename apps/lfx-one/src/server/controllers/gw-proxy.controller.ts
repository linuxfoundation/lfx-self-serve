// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { NextFunction, Request, Response } from 'express';

import { FetchRequestInit } from '@lfx-one/shared/interfaces';

import { MicroserviceError } from '../errors';
import { getGwApiBaseUrl } from '../helpers/gw-api.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';

/** Request headers that must never reach the upstream Gatewaze service. */
/**
 * Request headers this proxy never forwards upstream.
 *
 * `Authorization` is deliberately NOT in here. It carries the embed's Supabase access token, which
 * is the only credential the Gatewaze API accepts — stripping it makes every proxied call fail with
 * `{"error":{"code":"invalid_token","message":"JWT verification failed"}}`. The proxy treats the
 * value as opaque; it is never the LFX/Authelia token, because the embed's fetch layer only attaches
 * Authorization to `apiBaseUrl`-relative requests.
 *
 * `Cookie` is stripped so LFX session cookies can never reach the Gatewaze API (which authenticates
 * on the bearer alone, so there is no CSRF surface). `Origin` is stripped so the upstream cannot
 * vary behaviour on a browser-supplied origin through this path, and `Forwarded`/`X-Forwarded-*`
 * because this proxy does not vouch for them. The rest are hop-by-hop headers, which by definition
 * must not be forwarded.
 *
 * KNOWN LIMITATION: this is a denylist, so any other client-supplied header reaches the upstream.
 * An allowlist would be safer, but the embed sends vendor headers through this path and inverting
 * it blind risks breaking them — it needs to be done against a captured list of what the embed
 * actually sends, not guessed at. Tracked as follow-up; the upstream authenticates on the bearer
 * alone, so no header here is load-bearing for authorization today.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'cookie',
  'host',
  'origin',
  'content-length',
  // `accept-encoding` is stripped so the upstream answers uncompressed.
  //
  // Not a preference — a correctness requirement. `fetch` transparently DECODES a compressed
  // response body but leaves `content-length` at its on-the-wire (compressed) value, and the
  // decoded stream is what gets piped below. Copying that header onto the response makes Node
  // truncate the write to the compressed length, so every response big enough to be gzipped
  // reached the embed cut off mid-document — as a JSON parse error, not a visible failure.
  // Responses leave this BFF uncompressed anyway: server.ts disables its `compression` middleware
  // for this path.
  'accept-encoding',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-server',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'via',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

/**
 * Upstream response headers forwarded back to the caller.
 *
 * An allowlist, because the alternative leaks whatever the upstream chooses to set. Hop-by-hop
 * headers and `Set-Cookie` are excluded by construction — the Gatewaze API authenticates on the
 * bearer alone, so it has no business setting cookies in an LFX response.
 *
 * `cache-control` matters: without it an upstream `no-store` on an authenticated JSON payload is
 * lost and the browser may heuristically cache it. The range/disposition headers matter because
 * `host-media` is in the enabled module set, so file transfer through this proxy is an intended
 * path and breaks without them.
 */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'location',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'vary',
  'content-disposition',
  'accept-ranges',
  'content-range',
  'retry-after',
  'www-authenticate',
] as const;

/**
 * How long to wait on the Gatewaze API before giving up.
 *
 * Generous rather than tight: `host-media` uploads through this proxy are legitimately slow, and
 * the failure this bounds is a hung socket, not a slow one.
 */
const GW_PROXY_TIMEOUT_MS = 60_000;

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
      // Routed through the shared error pipeline rather than a hand-rolled res.status().json() so
      // the body matches every other /api/* error — and so this branch closes the operation opened
      // above instead of leaving it dangling in the logs. The uniform 404 is preserved: both
      // causes produce the identical status and code.
      next(
        new MicroserviceError('Not found', 404, 'gw_flag_disabled', {
          operation: 'gw_proxy_request',
          service: 'gw',
          path: req.path,
        })
      );
      logger.error(req, 'gw_proxy_request', startTime, new Error('gw_flag_disabled'), {
        method: req.method,
        path: req.path,
        stage: 'gate',
      });
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
      // The caller's own Authorization rides through untouched (see STRIPPED_REQUEST_HEADERS).
      //
      // Do NOT substitute `req.bearerToken` here. That is the LFX/Authelia token, and the Gatewaze
      // API only accepts Supabase-issued JWTs — sending it produces
      // `{"error":{"code":"invalid_token","message":"JWT verification failed"}}` on every call.
      // It would also hand an LFX credential to a service that has no business holding one.
      // `req.bearerToken` gates access to this route above; it is not what authenticates upstream.
      //
      // A request without Authorization is forwarded without it: some Gatewaze endpoints are
      // public, and this proxy never synthesizes credentials or a 401 of its own.

      const hasRequestBody = req.method !== 'GET' && req.method !== 'HEAD';

      const requestInit: FetchRequestInit = {
        method: req.method,
        headers,
        // Never follow upstream redirects — pass 3xx through untouched so whatever is on the
        // other end of this proxy (the embed, or its own client) decides what to do with a
        // Location header, rather than this BFF silently chasing it.
        redirect: 'manual',
        // Without this a hung upstream holds the Express socket open indefinitely — `pipeline`
        // will not time out a stalled-but-open body either. The abort surfaces as an error and
        // goes through next(error) like any other upstream failure.
        signal: AbortSignal.timeout(GW_PROXY_TIMEOUT_MS),
      };

      if (hasRequestBody) {
        // `/api/gw` is excluded from express.json()/express.urlencoded() (see server.ts) so `req`
        // is still an unconsumed raw stream here — forwarding it directly (rather than buffering
        // and re-serializing) proxies the body byte-for-byte regardless of content type.
        requestInit.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
        requestInit.duplex = 'half';
      }

      const upstream = await fetch(upstreamUrl, requestInit);

      res.status(upstream.status);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) {
          res.setHeader(name, value);
        }
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
