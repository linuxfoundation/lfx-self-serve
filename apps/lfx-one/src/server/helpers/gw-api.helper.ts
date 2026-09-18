// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';

import { Request, Response } from 'express';

import { GW_DRAIN_TIMEOUT_MS } from '@lfx-one/shared/constants';

import { MicroserviceError } from '../errors';

/**
 * Lets a rejected caller finish sending, by reading and discarding whatever it still has.
 *
 * Node only pulls from the socket while something is reading the request stream. Every rejection
 * on the `/api/gw/*` route decides BEFORE the body is touched — the flag/bearer 404 is the first
 * thing the controller does, the authorization 403 runs ahead of any read by design, and the
 * fail-closed 5xx fires when the access lookup throws. `apiErrorHandler` then answers without
 * touching the request stream, so a client mid-upload is left unable to complete its write and
 * the connection hangs until keep-alive expires.
 *
 * Shared by the controller and the middleware because the hazard is the route's, not either
 * file's: any pre-stream rejection on a path that accepts uploads needs this.
 *
 * AWAITED, and that is the whole point — an earlier version called `req.resume()` and returned
 * immediately, which does not actually drain. The controller's 413 path already documents why:
 * "once the response emits `finish`, Node stops feeding the socket into `req`, which severs the
 * drain a few milliseconds after it starts." Responding first and draining second is therefore the
 * same hang, with an extra step. So callers must `await` this BEFORE handing the error on.
 *
 * Bounded rather than open-ended, because these are rejection paths and some of them are rejecting
 * an unauthorized caller: without a cap, a client that trickles bytes could hold a handler for as
 * long as it liked. The cap means a caller still sending at that point gets its connection finished
 * with anyway — the response is already decided and the bytes are discarded as they arrive.
 */
export function drainRequestBody(req: Request, timeoutMs: number = GW_DRAIN_TIMEOUT_MS): Promise<void> {
  // `destroyed` matters as much as `readableEnded`, and leaving it out was a real cost rather than
  // a tidiness point. For a caller that aborted mid-upload, `readableEnded` is still false, but
  // 'end'/'close'/'error' have ALREADY fired — so none of the three listeners below can fire again,
  // `resume()` is a no-op, and only the cap resolves. Every rejection path now awaits this, so each
  // aborted upload pinned an Express handler for the full five seconds.
  if (
    req.readableEnded ||
    req.destroyed ||
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    typeof req.resume !== 'function' ||
    typeof req.once !== 'function'
  ) {
    return Promise.resolve();
  }

  req.resume();

  return new Promise<void>((resolve) => {
    // Bounded, so one caller cannot pin a handler by trickling bytes. Whichever comes first wins:
    // the request ending, the socket closing or erroring, or the cap.
    const timer = setTimeout(resolve, timeoutMs);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    req.once('end', settle);
    req.once('close', settle);
    req.once('error', settle);
  });
}

/**
 * Resolves the upstream Gatewaze admin service base URL from the `GW_API_URL` env var.
 *
 * Mirrors `getApiGatewayBaseUrl`'s lazy-validate-on-first-use pattern: nothing reads or checks
 * this at module load, so a misconfigured deployment fails the first proxied request with a
 * clear 503 rather than crashing at startup or building a malformed upstream URL.
 *
 * Validation, beyond "is it set":
 * - Trailing slashes are rejected (not stripped). The controller resolves the caller's path
 *   against this value rather than concatenating onto it, building the base as `new URL(`${base}/`)`
 *   — so a value that already ends in `/` would make `base.pathname` end in `//` and skew the
 *   "does the resolved path stay inside the base" check that keeps a request from escaping it.
 * - Outside `NODE_ENV` values of `development`/`local`/`test`, the URL must be `https:` — this
 *   proxy forwards `Authorization` and (for non-GET/HEAD requests) the full request body
 *   upstream, so an accidental `http://` target in a real environment would leak both in transit.
 *
 * @param operation - Logical operation name for error metadata (e.g. `gw_proxy_request`).
 */
/**
 * Whether a request path belongs to the Gatewaze proxy router mounted at `/api/gw`.
 *
 * Matches the mount exactly rather than by prefix. `startsWith('/api/gw')` would also swallow a
 * future `/api/gwidgets`, silently stripping its body parsing and compression — a failure that
 * shows up as an empty `req.body` rather than an error.
 *
 * Lives here rather than in `server.ts` so it is reachable by a spec. It had no test while it
 * guarded three carve-outs, and one of them was silently inert: the `compression` filter asked it
 * about `req.path`, which Express has already trimmed by the time that deferred filter runs.
 * Inverting the segment-boundary check failed nothing in the suite.
 *
 * **Callers must pass an UNTRIMMED path.** This answers a question about the mount, so a path that
 * Express has already stripped the mount prefix from can never match. Top-level `app.use` handlers
 * may pass `req.path`; anything that runs after routing has entered the mount — a deferred filter,
 * a response hook — must pass `req.originalUrl` with any query string removed.
 */
export function isGwProxyPath(path: string): boolean {
  // Lower-cased first: `app.use('/api/gw', …)` is case-INSENSITIVE by default, so `/API/GW/x`
  // reaches the proxy. Comparing case-sensitively here meant such a request skipped none of the
  // exclusions — its body was consumed by express.json() and its streamed response re-compressed,
  // and the controller then forwarded an already-ended stream as an empty body with the caller's
  // original content-type. Silent data loss, no error.
  const normalized = path.toLowerCase();
  return normalized === '/api/gw' || normalized.startsWith('/api/gw/');
}

export function getGwApiBaseUrl(operation: string): string {
  const gwApiUrl = process.env['GW_API_URL'];

  if (!gwApiUrl || !gwApiUrl.trim()) {
    throw new MicroserviceError('GW_API_URL environment variable is not configured', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  const trimmed = gwApiUrl.trim();

  if (trimmed.endsWith('/')) {
    throw new MicroserviceError('GW_API_URL must not have a trailing slash', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  // Parsed, not string-matched. `startsWith('https://')` accepts `https://` with no host: the
  // prefix check passes here, and `new URL()` in the controller then throws a bare TypeError that
  // surfaces as a generic 500 — losing the 503 GW_API_URL_MISCONFIGURED this function exists to
  // produce. A dev/local value like `notaurl` failed the same way, with no scheme check to catch
  // it at all. Parsing once here means every malformed value is reported as a misconfiguration.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MicroserviceError('GW_API_URL is not a valid URL', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  // A query string or fragment breaks the same containment invariant the trailing-slash rule
  // protects, and slips through it. `https://host/api/v1?x` does not end in `/` and parses fine,
  // but the controller then builds `new URL('https://host/api/v1?x' + '/')`, whose pathname is
  // `/api/v1` with NO trailing slash — so every proxied path resolves outside the base and the
  // route answers 400 `gw_path_escapes_base` on every request. A total outage for the feature,
  // reported as a path-escape attempt rather than as the misconfiguration it actually is.
  if (parsed.search || parsed.hash) {
    throw new MicroserviceError('GW_API_URL must not carry a query string or fragment', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  const nodeEnv = (process.env['NODE_ENV'] || '').toLowerCase();
  const isDevLocal = nodeEnv === 'development' || nodeEnv === 'local' || nodeEnv === 'test';

  // Checked on the PARSED protocol rather than the raw string. This is not a defence against a
  // hostile value — GW_API_URL is operator-set configuration, not user input — it just makes the
  // check mean what it says: `https:` regardless of spelling, and a positive rejection of schemes
  // a prefix test never considered (file:, data:) instead of an accidental pass.
  if (!isDevLocal && parsed.protocol !== 'https:') {
    throw new MicroserviceError('GW_API_URL must use https:// outside local development', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  if (isDevLocal && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MicroserviceError('GW_API_URL must use http:// or https://', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  return trimmed;
}

/**
 * Returns this response's `X-Request-Id`, setting one if it has none.
 *
 * Both the authorization middleware and the controller answer on this route, and both need the
 * header — so minting independently produced two different ids for one request, with whichever ran
 * last winning. This makes the first caller's id the request's id.
 *
 * The value is echoed into log metadata as `gw_request_id` by the controller. That is what makes
 * the header useful: pino's own `request_id` is a per-process counter, so without the echo a caller
 * quoting this header back could not be found in the logs at all.
 */
export function ensureGwRequestId(res: Response): string {
  const existing = res.getHeader('X-Request-Id');
  if (typeof existing === 'string' && existing) {
    return existing;
  }
  const id = randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
