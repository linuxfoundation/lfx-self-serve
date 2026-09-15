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
 * Discard rather than a timed drain: the response goes out either way and the bytes are thrown
 * away as they arrive, so the caller decides how long it keeps sending — we are not holding the
 * connection open on its behalf. The controller's 413 path is the exception and keeps its own
 * bounded protocol, because there the limiter has already errored mid-stream.
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
  if (req.readableEnded || req.method === 'GET' || req.method === 'HEAD' || typeof req.resume !== 'function' || typeof req.once !== 'function') {
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
