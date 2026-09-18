// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { NextFunction, Request, Response } from 'express';

import { GW_EMBED_DEFAULT_API_BASE_URL } from '@lfx-one/shared/constants';
import { FetchRequestInit } from '@lfx-one/shared/interfaces';

import { isBaseApiError, MicroserviceError } from '../errors';
import { drainRequestBody, ensureGwRequestId, getGwApiBaseUrl } from '../helpers/gw-api.helper';
import { getGwProxyMaxBodyBytes, getGwProxyTimeoutMs } from '../helpers/gw-proxy-limits.helper';
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

// Both proxy limits are per-environment deployment variables (`GW_PROXY_TIMEOUT_MS`,
// `GW_PROXY_MAX_BODY_BYTES`), read through gw-proxy-limits.helper.ts. They were compiled-in
// constants, so neither could be tuned for a slow upstream or a larger media ceiling without a
// code change — which #2263 asks for explicitly. The defaults live in the shared package.
//
// Why each bound exists: the timeout is generous rather than tight, because `host-media` uploads
// are legitimately slow and what it bounds is a hung socket, not a slow one. The body ceiling
// exists because `/api/gw` is excluded from express.json()/urlencoded() so the raw stream can be
// forwarded byte-for-byte, which also means it inherits none of their 15mb limit — without it the
// route is an unbounded upload path. `apiRateLimiter` caps request COUNT, not bytes.

/**
 * Maps an upstream `Location` back onto this proxy's own mount, or returns null to drop it.
 *
 * Validating the origin and forwarding the value unchanged is not enough, and gets both shapes
 * wrong. A RELATIVE `Location` (`/orgs/123/moved`) is resolved by the browser against the LFX
 * origin, not the upstream base, so it lands outside `/api/gw` entirely. An ABSOLUTE same-origin
 * one sends the browser straight at `GW_API_URL`, which is cluster-internal — unreachable from a
 * browser, and it leaks the internal address on the way.
 *
 * So the value is resolved against the base, checked to still sit inside it (same origin AND
 * inside the base path, matching the request-side rule), and rewritten to the equivalent path
 * under `/api/gw`. Anything that escapes is dropped, leaving the caller a bare 3xx it cannot
 * silently follow.
 */
function rewriteUpstreamLocation(value: string, base: URL, requestUrl: URL): string | null {
  let resolved: URL;
  try {
    // Resolved against the REQUEST url, not the configured base — RFC 3986 §5 says a relative
    // reference resolves against the URL of the request that produced it, and the two differ for
    // every path below the base. `Location: moved` answering a request to `<base>/orgs/123` means
    // `<base>/orgs/moved`; resolving against the base gave `<base>/moved`, a different resource.
    // `Location: ?page=2` was worse — it dropped the path entirely and pointed at the base itself.
    resolved = new URL(value, requestUrl);
  } catch {
    // Unparseable even against the request URL — not something to hand a browser.
    return null;
  }

  // Containment is still judged against the CONFIGURED base: the request URL is already known to
  // sit inside it, so this keeps the guarantee that a redirect cannot leave the upstream we chose,
  // while the line above only decides which resource a relative reference names.

  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    return null;
  }

  // `base.pathname` always ends in `/` (the base is built with a trailing slash), so the remainder
  // never carries a leading slash and the join below cannot produce `//`.
  const remainder = resolved.pathname.slice(base.pathname.length);
  return `${GW_EMBED_DEFAULT_API_BASE_URL}/${remainder}${resolved.search}${resolved.hash}`;
}

/**
 * BFF proxy in front of the embedded Gatewaze admin pilot's own backend (`GW_API_URL`), mounted
 * at `/api/gw/*` — see `gw-proxy.route.ts` for the mount and `server.ts` for why this path is
 * excluded from the global body-parsing/compression middleware.
 *
 * Every response, success or failure, carries an `X-Request-Id`, echoed into this route's log
 * metadata as `gw_request_id` so a caller quoting the header can be found in the logs. One id per
 * request, shared with `requireGwEmbedAccess` rather than minted separately by each. Scoped to this
 * route only; it does NOT touch the global pino-http request-id configuration, whose `request_id`
 * remains a per-process counter.
 */
export class GwProxyController {
  /**
   * @param maxBodyBytesOverride Explicit upload ceiling, so a test can exercise the rejection path
   *   against a real socket without streaming 100MB. Production passes nothing, and the cap is then
   *   read from the environment per request — see the `maxBodyBytes` getter. An earlier docblock
   *   here said production "uses the default", which stopped being true once `GW_PROXY_MAX_BODY_BYTES`
   *   became a deployment variable.
   */
  public constructor(private readonly maxBodyBytesOverride?: number) {}

  /** The body ceiling for this request. See the constructor for why it is not captured once. */
  private get maxBodyBytes(): number {
    return this.maxBodyBytesOverride ?? getGwProxyMaxBodyBytes();
  }

  public async proxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Reused, not minted: requireGwEmbedAccess may already have set one for this request.
    const requestId = ensureGwRequestId(res);

    const startTime = logger.startOperation(req, 'gw_proxy_request', {
      method: req.method,
      path: req.path,
      // Echoed so the header a caller quotes back can actually be found in the logs. pino's own
      // request_id is a per-process counter and does not identify a request across restarts.
      gw_request_id: requestId,
    });

    // Flag-off and "not authenticated" are answered identically — same status, same envelope,
    // same code — so a caller cannot tell which of the two it hit, and the response names no
    // feature. See GatewazeEmbedEnabled's doc comment for why that matters.
    //
    // Scoped deliberately to that pair. An earlier version of this comment claimed the response
    // was also indistinguishable from "no such route", which is NOT true: there is no JSON 404
    // terminator for unmatched /api/* paths — they fall through to the SSR catch-all and render
    // HTML — so a prober can still tell this route exists from the envelope alone. Closing that
    // would mean adding an /api/* JSON not-found terminator app-wide, which is a bigger change
    // than this route should make on its own. The code is `NOT_FOUND`, matching ResourceNotFoundError
    // and every other 404 the app emits, so at least nothing here is uniquely identifying.
    //
    // The actual reason is recorded server-side in the log line below, where operators need it and
    // callers cannot see it.
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
      logger.debug(req, 'gw_proxy_request', 'Answering the uniform 404 for the embed proxy', {
        path: req.path,
        reason: isServerFeatureEnabled(ServerFeatureFlag.GatewazeEmbedEnabled) ? 'no_bearer_token' : 'flag_disabled',
      });
      // This 404 is the first thing the route does — decided before a single byte of the body is
      // read — so a caller mid-upload when the flag flips would hang here without the drain, the
      // same failure the 403 and 413 paths each handle in their own way.
      await drainRequestBody(req);
      next(
        new MicroserviceError('Not found', 404, 'NOT_FOUND', {
          operation: 'gw_proxy_request',
          service: 'gw',
          path: req.path,
        })
      );
      return;
    }

    // Set by the body limiter when it rejects an upload; awaited before the error response so the
    // client has stopped sending by the time the connection is finished with.
    let bodyDrained: Promise<void> | null = null;

    const timeoutController = new AbortController();
    const timeoutMs = getGwProxyTimeoutMs();
    const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);

    try {
      const baseUrl = getGwApiBaseUrl('gw_proxy_request');
      // `req.url` inside a router mounted at `/api/gw` is already relative to that mount point
      // (Express strips the matched prefix), and still carries the original query string — so
      // resolving it against the base forwards both the remaining path and the query.
      //
      // Resolved rather than concatenated, because Express does NOT normalize the path it hands
      // over: a request to `/api/gw/../../secret` arrives here as `/../../secret`, and the URL
      // parser inside fetch resolves those dot segments. Concatenating would then send
      // `https://host/api/v1/../../secret` upstream as `https://host/secret` — outside the base
      // path GW_API_URL names, which may legitimately carry one. Verified against Express: the
      // dot segments survive the mount strip verbatim.
      //
      // The upstream HOST cannot be moved this way — Express only matches the mount on a segment
      // boundary, so `req.url` always begins with `/` and authority injection (`//evil.com`,
      // `@evil.com`) is unreachable. The exposure is escaping the base PATH, which the check below
      // closes. The trailing slash on the base keeps relative resolution underneath it.
      const base = new URL(`${baseUrl}/`);
      // `./` prefix is load-bearing, not decoration. Without it a first path segment containing a
      // colon parses as a URL SCHEME — `messages:send` becomes scheme `messages:`, origin `null` —
      // and the check below rejects it, making any Google-style custom method on the upstream
      // unreachable behind an opaque 400. `./` forces a relative reference. Escape is unaffected:
      // `./../../secret` still resolves out of the base and is still rejected.
      const resolved = new URL(`./${req.url.replace(/^\/+/, '')}`, base);

      if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
        // This function has no `finally` — the timer is cleared at each exit — so clear it here too.
        clearTimeout(timeoutTimer);
        // Drained like every other pre-stream rejection on this route. This one was missed when the
        // 404, 403, fail-closed 5xx and catch were done, and it is the same hazard: the check runs
        // before anything reads the body, so a POST still uploading when its path is rejected can
        // never finish writing and sits until keep-alive.
        await drainRequestBody(req);
        next(
          new MicroserviceError('Resolved upstream path escapes the configured GW_API_URL base', 400, 'gw_path_escapes_base', {
            operation: 'gw_proxy_request',
            service: 'gw_proxy',
            path: req.path,
          })
        );
        return;
      }

      const upstreamUrl = resolved.toString();

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
        const maxBodyBytes = this.maxBodyBytes;
        let forwardedBytes = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            forwardedBytes += chunk.length;
            if (forwardedBytes > maxBodyBytes) {
              callback(new MicroserviceError('Request body too large', 413, 'gw_body_too_large', { operation: 'gw_proxy_request' }));
              return;
            }
            callback(null, chunk);
          },
        });

        // Rejecting an oversized upload takes three things, and the first two are not enough on
        // their own — each was shipped alone and each was wrong.
        //
        // 1. Do NOT destroy the request. On an http.IncomingMessage that tears down the socket,
        //    and the limiter errors while the body is still flowing, long before the rejection
        //    reaches the catch below — so the 413 would be written to a dead socket and the caller
        //    would see ECONNRESET, with the log still recording a clean 413 that never left.
        //    stream.pipeline() is avoided for the same reason: it destroys the source on error.
        //    (It also returns a promise that floats unless awaited.)
        // 2. Drain what the client is still sending, the way body-parser does.
        // 3. Wait for that drain before finishing the response — the half that is easy to miss.
        //    Once the response emits `finish`, Node stops feeding the socket into `req`, which
        //    severs the drain a few milliseconds after it starts. The client then never finishes
        //    writing and the connection sits blocked until the keep-alive timeout kills it
        //    mid-upload. That is what `bodyDrained`, awaited in the catch, exists for.
        limiter.on('error', () => {
          req.unpipe(limiter);
          // `drainRequestBody` rather than the same protocol hand-rolled here, which is what this
          // was. Two copies of one drain were free to diverge — and had: only the shared helper
          // marks the request as drained, so `attachGwDrainGuard` could not tell that this path had
          // already paid for a full-cap drain and started a second one behind it. On the 413 path,
          // which is by definition a large upload from a client still sending, that doubled the
          // worst-case rejection latency.
          bodyDrained = drainRequestBody(req);
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
        if (!value) {
          continue;
        }

        // `location` is the one forwarded header that can send a browser somewhere. Forwarded
        // verbatim it is an upstream-controlled open redirect wearing the LFX origin: a 3xx
        // naming another host would move a top-level navigation off LFX entirely. Only forward it
        // when it stays on the upstream we configured; anything else is dropped, leaving the
        // caller a bare 3xx it cannot silently follow.
        if (name === 'location') {
          const rewritten = rewriteUpstreamLocation(value, base, resolved);
          if (!rewritten) {
            logger.warning(req, 'gw_proxy_request', 'Dropped an upstream Location that does not resolve inside the configured GW_API_URL base', {
              path: req.path,
              upstream_status: upstream.status,
            });
            continue;
          }
          res.setHeader(name, rewritten);
          continue;
        }

        res.setHeader(name, value);
      }

      // Set AFTER the forwarding loop so upstream can never override them.
      //
      // This route is not JSON-only: `host-media` is in the enabled module set, so user-uploaded
      // bytes are served from the LFX origin under whatever `content-type` the upstream reports.
      // Without these, a top-level navigation to an uploaded .html or .svg executes script in the
      // LFX origin, with reach over the session cookie, localStorage (the embed's stored Supabase
      // session included) and every /api/* route — stored XSS against the whole app, reachable by
      // anyone who can upload media.
      //
      // `sandbox` without `allow-same-origin` drops the response into an opaque origin, so even an
      // HTML payload cannot touch LFX state. fetch/XHR consumers — which is how the embed actually
      // reads this route — are unaffected, because the sandbox applies to documents, not to
      // responses read as data.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");

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

      // An upstream timeout rejects with a DOMException named AbortError, which is not a
      // BaseApiError — so without this it reaches apiErrorHandler's fallback branch and the caller
      // gets a generic 500 logged as `unhandled`, indistinguishable from a real bug in here.
      // Mapped the way api-client.service.ts maps its own timeouts: 408 with transportFailure, so
      // the response carries `transport: true` and a consumer need not special-case this route.
      const isTimeout = unwrapped instanceof Error && (unwrapped.name === 'AbortError' || unwrapped.name === 'TimeoutError');
      const reported = isTimeout
        ? new MicroserviceError(`Request timeout after ${timeoutMs}ms`, 408, 'TIMEOUT', {
            operation: 'gw_proxy_request',
            service: 'gw',
            path: req.path,
            transportFailure: true,
            originalError: unwrapped,
          })
        : unwrapped;
      // Headers already committed — can only end the stream. `bodyDrained` is deliberately not
      // awaited here: unpipe/resume has already started the drain, and waiting cannot change
      // anything once the response is on the wire. This is the one place a controller
      // in this codebase calls logger.error() directly, because next(error) can no longer produce
      // a clean response once streaming has begun.
      if (res.headersSent) {
        logger.error(req, 'gw_proxy_request', startTime, reported, {
          method: req.method,
          path: req.path,
          stage: 'streaming',
        });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      // `bodyDrained` is set ONLY by the body limiter's error handler, i.e. only on the 413 path.
      // Any other pre-response failure while the caller is still uploading — ECONNREFUSED, DNS
      // failure, an upstream socket reset — tears the pipe down without it, so `req` stops being
      // read and the client cannot finish writing: the exact hang the rest of this file works to
      // avoid, reached through the one door nobody had closed.
      //
      // `drainRequestBody` decides for itself whether there is anything to drain (GET/HEAD, already
      // ended, destroyed), so calling it unconditionally here is correct and cheaper than tracking
      // a second flag. The abort/timeout path self-drains and lands in the already-ended branch.
      if (bodyDrained) {
        await bodyDrained;
      } else {
        await drainRequestBody(req);
      }
      next(reported);
    }
  }
}
