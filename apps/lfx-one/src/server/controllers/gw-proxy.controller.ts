// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { NextFunction, Request, Response } from 'express';

import { FetchRequestInit } from '@lfx-one/shared/interfaces';

import { isBaseApiError, MicroserviceError } from '../errors';
import { getGwApiBaseUrl } from '../helpers/gw-api.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';

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
  // `accept-encoding` is stripped so the CALLER's negotiation is not forwarded — the embed and
  // the upstream never end up agreeing an encoding this proxy did not ask for.
  //
  // It does NOT stop the upstream compressing: undici supplies its own `accept-encoding:
  // gzip, deflate` whenever the header is absent, so a compressed response is still the normal
  // case. The protection against truncation is the `content-encoding` check on the response path
  // below, not this entry.
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
 * Ceiling on a proxied request body.
 *
 * `/api/gw` is excluded from express.json()/urlencoded() so the raw stream can be forwarded
 * byte-for-byte, which also means it inherits none of their 15mb limit — without this the route is
 * an unbounded upload path into the Gatewaze API. Set well above the 15mb the rest of the app
 * allows because `host-media` uploads legitimately through here; the point is a bound, not a tight
 * one. `apiRateLimiter` caps request COUNT, not bytes, so it does not cover this.
 */
const GW_PROXY_MAX_BODY_BYTES = 100 * 1024 * 1024;

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
      return;
    }

    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => timeoutController.abort(), GW_PROXY_TIMEOUT_MS);

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
        // Bounds everything up to the response headers — which, for a request carrying a body,
        // includes the upload, since the upstream does not answer until it has read it. It does
        // NOT bound the download: the timer is cleared the moment headers arrive, so a slow
        // host-media response cannot be aborted mid-stream. Deliberately not
        // `AbortSignal.timeout`, which stays live through body streaming and would do exactly
        // that.
        signal: timeoutController.signal,
      };

      if (hasRequestBody) {
        // `/api/gw` is excluded from express.json()/express.urlencoded() (see server.ts) so `req`
        // is still an unconsumed raw stream here — forwarding it directly (rather than buffering
        // and re-serializing) proxies the body byte-for-byte regardless of content type.
        // Counted rather than trusted: a chunked upload carries no content-length to precheck, so
        // the bound has to be enforced on the bytes actually seen. Erroring the stream rejects the
        // fetch, which lands in the catch below like any other upstream failure.
        let forwardedBytes = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            forwardedBytes += chunk.length;
            if (forwardedBytes > GW_PROXY_MAX_BODY_BYTES) {
              callback(new MicroserviceError('Request body too large', 413, 'gw_body_too_large', { operation: 'gw_proxy_request' }));
              return;
            }
            callback(null, chunk);
          },
        });

        // Drain the rest of the upload rather than destroying it — the same thing body-parser does
        // when it rejects an oversized body.
        //
        // `req.destroy()` is the obvious move and it is wrong here: on an http.IncomingMessage it
        // tears down the socket, and the limiter errors while the body is still flowing, long
        // before the rejection reaches the catch below. The 413 would then be written to a dead
        // socket and the caller would see ECONNRESET instead — with the log still recording a
        // clean 413 that never left the process.
        //
        // stream.pipeline() is avoided for the same reason: it destroys the source on error. (It
        // also returns a promise that floats unless caught.)
        limiter.on('error', () => {
          req.unpipe(limiter);
          req.resume();
        });
        requestInit.body = Readable.toWeb(req.pipe(limiter)) as ReadableStream<Uint8Array>;
        requestInit.duplex = 'half';
      }

      const upstream = await fetch(upstreamUrl, requestInit);
      // Headers are in: the connection is alive, so stop the clock before streaming the body.
      clearTimeout(timeoutTimer);

      res.status(upstream.status);
      // THE anti-truncation guarantee, not a backstop. `fetch` decodes a compressed response body
      // but leaves content-length at the compressed value, and the decoded stream is what gets
      // piped below — copying that header makes Node truncate the write, delivering valid-looking
      // JSON cut off mid-document. undici negotiates gzip on its own regardless of what we strip
      // from the caller's headers, so this path is the common case, not the edge case. Dropping
      // the header lets Node fall back to chunked encoding, which is always correct.
      const upstreamDecodedBody = Boolean(upstream.headers.get('content-encoding'));
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        if (name === 'content-length' && upstreamDecodedBody) {
          continue;
        }
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
      clearTimeout(timeoutTimer);
      // undici wraps ANY request-body stream failure in `TypeError: fetch failed` and hangs the
      // original off `.cause`. Without unwrapping, the 413 the body limiter raises reaches
      // apiErrorHandler as a bare TypeError and the caller gets a generic 500.
      const unwrapped = error instanceof TypeError && isBaseApiError((error as { cause?: unknown }).cause) ? (error as { cause: unknown }).cause : error;
      // Headers already committed — can only end the stream. This is the one place a controller
      // in this codebase calls logger.error() directly, because next(error) can no longer produce
      // a clean response once streaming has begun.
      if (res.headersSent) {
        logger.error(req, 'gw_proxy_request', startTime, unwrapped, {
          method: req.method,
          path: req.path,
          stage: 'streaming',
        });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      next(unwrapped);
    }
  }
}
