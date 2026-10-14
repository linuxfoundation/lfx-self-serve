// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';

import {
  anonCredentials,
  carriesPlaceholder,
  csrfDecision,
  isAdminCheckPending,
  isPublicRead,
  type ProxyCredentials,
  proxyRequest,
  retryAfterSeconds,
  SESSION_EXPIRED,
  SESSION_HEADER,
  type Upstream,
  upstreamUrl,
  UpstreamPathError,
} from '@gatewaze/host-session';
import {
  GW_HOST_SESSION_PROXY_API_MOUNT,
  GW_HOST_SESSION_PROXY_OPERATION as OPERATION,
  GW_HOST_SESSION_PROXY_RESPONSE_HEADERS,
  GW_HOST_SESSION_PROXY_STRIPPED_REQUEST_HEADERS,
  GW_HOST_SESSION_PROXY_SUPABASE_MOUNT,
  GW_HOST_SESSION_PROXY_UPSTREAM_TIMED_OUT,
} from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, isBaseApiError, MicroserviceError } from '../errors';
import { authorizeGatewazeModule, gatewazeModuleForPath } from '../helpers/gatewaze-module.helper';
import { drainRequestBody, ensureGwRequestId, getGwApiBaseUrl } from '../helpers/gw-api.helper';
import { getGwProxyMaxBodyBytes, getGwProxyTimeoutMs } from '../helpers/gw-proxy-limits.helper';
import { gatewazeHostSessionNotFound } from '../middleware/require-gatewaze-host-session.middleware';
import { getGatewazeSessionService, hostSessionCoreLogger, resolveGatewazeHostSessionConfig } from '../services/gatewaze-session.service';
import { logger } from '../services/logger.service';

/**
 * Maps a `Location` the package has already filtered (`rewriteLocation`) onto this proxy's mount, or
 * returns null to drop it. The package has already dropped backslashes, control characters and
 * schemes other than `https:` (and `http:` to localhost).
 *
 * - An absolute URL passes unchanged, e.g. an edge function sending the browser to an OAuth provider.
 * - A root-relative value gets the mount prefixed. The package makes a redirect to the upstream's own
 *   origin root-relative, as if it were served at the site root, and here it is served under `mount`.
 * - A path-relative value is resolved against `requestPath`, the browser's path for this request.
 *
 * Either relative form is then normalised, and kept only while it stays under the mount, so dot
 * segments (`..`, `%2e%2e`) cannot walk the browser off it. A protocol-relative `//host` is dropped.
 */
export function mountLocation(location: string, mount: string, requestPath: string): string | null {
  if (location.startsWith('//')) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(location)) {
    return location;
  }
  const base = 'https://mount.invalid';
  let resolved: URL;
  try {
    resolved = location.startsWith('/') ? new URL(`${base}${mount}${location}`) : new URL(location, `${base}${requestPath}`);
  } catch {
    return null;
  }
  if (resolved.origin !== base || !resolved.pathname.startsWith(`${mount}/`)) {
    return null;
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * Cookie-authenticated proxies for the embedded Gatewaze admin in host-session mode: Supabase
 * (PostgREST, Storage, Functions) under `/api/gatewaze/supabase` and the Gatewaze API under
 * `/api/gatewaze/api`. The browser sends the placeholder token `host-session`. This controller
 * follows the `@gatewaze/host-session` host contract (steps 2 to 6): CSRF decision, session lookup,
 * the real access token attached only for an admin, and the forward with `proxyRequest`. The router
 * runs the LFX gates first. See `docs/architecture/backend/gw-host-session.md`.
 */
export class GatewazeProxyController {
  /**
   * @param maxBodyBytesOverride Explicit upload ceiling, so a test can exercise the 413 against a
   *   real socket without sending 100MB. Production passes nothing and reads `GW_PROXY_MAX_BODY_BYTES`
   *   per request.
   */
  public constructor(private readonly maxBodyBytesOverride?: number) {}

  /** `ALL /api/gatewaze/supabase/{rest,storage,functions}/v1/*` */
  public async proxySupabase(req: Request, res: Response, next: NextFunction): Promise<void> {
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      // The router's gate already checked this; the environment is read per call, so answer the same.
      await drainRequestBody(req);
      next(gatewazeHostSessionNotFound(req));
      return;
    }
    // The route matched `/supabase/<service>/v1`, so the prefix is that service's. Lower-cased, so an
    // upper-cased path fails the prefix check with a 400 instead of reaching Supabase as written.
    const service = String(req.params[0]).toLowerCase();
    const upstream: Upstream = { url: config.supabaseUrl, prefix: `/${service}/v1`, supabase: true };
    await this.forward(req, res, next, upstream, req.url.slice('/supabase'.length), GW_HOST_SESSION_PROXY_SUPABASE_MOUNT, config.anonKey);
  }

  /** `ALL /api/gatewaze/api/*`, forwarded to `GW_API_URL` with the `/api` path kept. */
  public async proxyApi(req: Request, res: Response, next: NextFunction): Promise<void> {
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      await drainRequestBody(req);
      next(gatewazeHostSessionNotFound(req));
      return;
    }
    let apiOrigin: string;
    try {
      apiOrigin = resolveGwApiOrigin();
    } catch (error) {
      await drainRequestBody(req);
      next(error);
      return;
    }
    await this.forward(req, res, next, { url: apiOrigin, prefix: '/api', supabase: false }, req.url, GW_HOST_SESSION_PROXY_API_MOUNT, config.anonKey);
  }

  private get maxBodyBytes(): number {
    return this.maxBodyBytesOverride ?? getGwProxyMaxBodyBytes();
  }

  private async forward(
    req: Request,
    res: Response,
    next: NextFunction,
    upstream: Upstream,
    pathAndQuery: string,
    mount: string,
    anonKey: string
  ): Promise<void> {
    const requestId = ensureGwRequestId(res);
    const kind = upstream.supabase ? 'supabase' : 'api';
    const startTime = logger.startOperation(req, OPERATION, { method: req.method, path: req.path, upstream: kind, gw_request_id: requestId });

    // Path containment first, before any session is loaded: `..`, `%2e%2e` or a backslash that
    // normalises out of the matched prefix (for example to GoTrue's `/auth/v1`) is a 400.
    let target: URL;
    try {
      target = upstreamUrl(upstream, pathAndQuery);
    } catch (error) {
      await drainRequestBody(req);
      next(
        error instanceof UpstreamPathError
          ? new MicroserviceError('Proxied path leaves the upstream prefix', 400, 'GW_BAD_PATH', { operation: OPERATION, service: 'gw', path: req.path })
          : error
      );
      return;
    }

    const siteOrigin = resolveSiteOrigin();
    const decision = siteOrigin
      ? csrfDecision({
          method: req.method,
          origin: req.get('origin'),
          apikey: req.get('apikey'),
          authorization: req.get('authorization'),
          secFetchSite: req.get('sec-fetch-site'),
          siteOrigin,
          anonKey,
        })
      : 'reject';
    if (decision === 'reject') {
      // DEBUG, not WARN: any cross-site page can send this, so it must not flood the logs.
      logger.debug(req, OPERATION, 'Refusing a cross-site proxied write', { has_origin: !!req.get('origin'), site_origin_set: !!siteOrigin });
      await this.answer(req, res, startTime, 403, { error: 'cross_site' });
      return;
    }

    try {
      const moduleId = gatewazeModuleForPath(upstream, target.pathname);
      if (moduleId !== null && !(await authorizeGatewazeModule(req, moduleId))) {
        await drainRequestBody(req);
        next(
          new AuthorizationError('Access to this Gatewaze module is not granted', {
            operation: OPERATION,
            service: 'authorization',
            path: req.path,
            code: 'GW_MODULE_ACCESS_REQUIRED',
          })
        );
        return;
      }
    } catch (error) {
      await drainRequestBody(req);
      next(error);
      return;
    }

    // Without the session, Supabase gets the anon key as signed-out supabase-js would send it, and
    // the API gets nothing. A cross-site GET (decision 'anon') never loads the session.
    let creds: ProxyCredentials = anonCredentials(anonKey, upstream.supabase);
    let privateResponse = false;
    if (decision === 'session') {
      const result = await getGatewazeSessionService().getGatewazeSession(req);
      switch (result.outcome) {
        case 'ok': {
          const session = result.session;
          if (session.is_admin) {
            creds = { bearer: session.access_token, apikey: upstream.supabase ? anonKey : null };
            privateResponse = true;
          } else if (!isPublicRead(req.method, target.pathname)) {
            if (isAdminCheckPending(session)) {
              res.setHeader('Retry-After', String(retryAfterSeconds(session)));
              await this.answer(req, res, startTime, 503, { error: 'admin_check_pending' });
              return;
            }
            await this.answer(req, res, startTime, 403, { error: 'not_admin' });
            return;
          }
          // A non-admin's public read goes as anon.
          break;
        }
        case 'ended':
          await this.answerExpired(req, res, startTime);
          return;
        case 'host_session_unavailable':
          // No store-backed LFX session id. A request carrying the placeholder comes from embed code
          // that only runs after sign-in, so its session is gone; anything else goes as anon.
          if (carriesPlaceholder(req.get('authorization'), pathAndQuery)) {
            await this.answerExpired(req, res, startTime);
            return;
          }
          break;
        default:
          // `refused` and `unavailable`: a fault, never a sign-out. The service already logged it.
          await this.answer(req, res, startTime, 503, { error: 'session_unavailable' });
          return;
      }
    }

    for (const name of GW_HOST_SESSION_PROXY_STRIPPED_REQUEST_HEADERS) {
      delete req.headers[name];
    }

    // Set by the body limiter when it rejects an upload, and awaited before the 413.
    let bodyDrained: Promise<void> | null = null;
    const timeoutMs = getGwProxyTimeoutMs();
    let upstreamBody: IncomingMessage | null = null;
    try {
      const limiter = createByteLimiter(this.maxBodyBytes);
      limiter.on('error', () => {
        // Never destroy `req`: that tears down the socket and the 413 never reaches the caller.
        req.unpipe(limiter);
        bodyDrained = drainRequestBody(req);
      });
      const upstreamRes = await proxyRequest(req, upstream, pathAndQuery, {
        creds,
        // Only the client address LFX resolved itself (`trust proxy` counts the ingress hop). The
        // browser's own X-Forwarded-For chain is not forwarded.
        xff: req.ip ?? '',
        // An idle bound on the upstream socket, so a hung upstream is cut off while a slow upload
        // or a long download that keeps moving is not.
        timeoutMs,
        downstream: res,
        privateResponse,
        body: req.pipe(limiter),
        log: hostSessionCoreLogger(OPERATION, req),
      });

      upstreamBody = upstreamRes.body;
      res.status(upstreamRes.status);
      // The upstream's own Cache-Control, copied below, replaces the router's no-store default. With
      // none, no-store stays. A response made with the session always has one: the package sets
      // `private` on it.
      if (upstreamRes.headers['cache-control'] !== undefined) {
        res.removeHeader('Cache-Control');
      }
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!GW_HOST_SESSION_PROXY_RESPONSE_HEADERS.has(name.toLowerCase())) {
          continue;
        }
        if (name.toLowerCase() === 'location' && typeof value === 'string') {
          const location = mountLocation(value, mount, req.originalUrl.split('?')[0]);
          if (location === null) {
            logger.warning(req, OPERATION, 'Dropped an upstream redirect that leaves the proxy mount', { upstream_status: upstreamRes.status });
          } else {
            res.setHeader(name, location);
          }
          continue;
        }
        res.setHeader(name, value);
      }
      // After the loop, so the upstream cannot override them. Storage objects are user uploads served
      // from the LFX origin, and these keep a top-level navigation to one from running script here.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");

      await streamBody(upstreamRes.body, res);
      logger.success(req, OPERATION, startTime, { method: req.method, path: req.path, upstream: kind, upstream_status: upstreamRes.status });
    } catch (error) {
      upstreamBody?.destroy();
      if (error instanceof BrowserClosedError) {
        // A closed tab or a cancelled fetch: ordinary, and nobody is left to answer.
        logger.debug(req, OPERATION, 'The browser closed the response before it finished', { path: req.path, upstream: kind });
        return;
      }
      const reported = toProxyError(req, error, timeoutMs);
      if (res.headersSent) {
        // The response is on the wire, so apiErrorHandler cannot answer. Destroyed, so the browser
        // sees a broken body, never a short one that looks complete.
        logger.error(req, OPERATION, startTime, reported, { method: req.method, path: req.path, upstream: kind, stage: 'streaming' });
        res.destroy();
        return;
      }
      // Nothing reached the browser yet, so it gets a clean error. The upstream headers copied above
      // must not travel with it: a `Content-Encoding: gzip` on a JSON error would fail to decode, and
      // the upstream's caching headers would apply to the failure.
      for (const name of res.getHeaderNames()) {
        if (GW_HOST_SESSION_PROXY_RESPONSE_HEADERS.has(name)) {
          res.removeHeader(name);
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      await (bodyDrained ?? drainRequestBody(req));
      next(reported);
    }
  }

  /** A contract answer the embed's shim reads. Drained first, so a caller mid-upload can finish writing. */
  private async answer(req: Request, res: Response, startTime: number, status: number, body: Record<string, string>): Promise<void> {
    await drainRequestBody(req);
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(body);
    // Closes the operation with the answer, so a user's "not an admin" or sign-out can be found by
    // its X-Request-Id. Not an error: the shim reads these as contract answers.
    logger.success(req, OPERATION, startTime, { method: req.method, path: req.path, status_code: status, answer: body['error'] });
  }

  /** The one answer that tells the shim its session is gone (host contract step 4). */
  private async answerExpired(req: Request, res: Response, startTime: number): Promise<void> {
    res.setHeader(SESSION_HEADER, SESSION_EXPIRED);
    await this.answer(req, res, startTime, 401, { error: 'not_signed_in' });
  }
}

/** The browser closed the response before it finished. */
class BrowserClosedError extends Error {}

/**
 * Pipes the upstream body to the browser and settles when the response finishes. Unlike
 * `stream.pipeline`, it does not destroy `res` on an upstream error, so a body that fails before the
 * first byte (headers not yet sent) can still be answered with a clean 502 by the caller.
 */
function streamBody(body: IncomingMessage, res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // An upstream that dies mid-body raises `error` ("aborted") on the response.
    body.once('error', reject);
    res.once('finish', resolve);
    res.once('close', () => {
      if (!res.writableFinished) {
        reject(new BrowserClosedError('the browser closed the response'));
      }
    });
    body.pipe(res);
  });
}

/** Counts the bytes forwarded and fails the stream with a 413 once they pass `maxBytes`. A chunked upload has no content-length to check first. */
function createByteLimiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new MicroserviceError('Request body too large', 413, 'gw_body_too_large', { operation: OPERATION }));
        return;
      }
      callback(null, chunk);
    },
  });
}

/** Maps a forward failure to the error apiErrorHandler answers with. */
function toProxyError(req: Request, error: unknown, timeoutMs: number): unknown {
  if (isBaseApiError(error)) {
    // The body limiter's 413.
    return error;
  }
  if (error instanceof UpstreamPathError) {
    return new MicroserviceError('Proxied path leaves the upstream prefix', 400, 'GW_BAD_PATH', { operation: OPERATION, service: 'gw', path: req.path });
  }
  if (error instanceof Error && error.message === GW_HOST_SESSION_PROXY_UPSTREAM_TIMED_OUT) {
    return new MicroserviceError(`Request timeout after ${timeoutMs}ms`, 408, 'TIMEOUT', {
      operation: OPERATION,
      service: 'gw',
      path: req.path,
      transportFailure: true,
      originalError: error,
    });
  }
  return new MicroserviceError('Gatewaze upstream unavailable', 502, 'GW_UPSTREAM_UNAVAILABLE', {
    operation: OPERATION,
    service: 'gw',
    path: req.path,
    transportFailure: true,
    originalError: error instanceof Error ? error : undefined,
  });
}

/** LFX One's own origin, from `PCC_BASE_URL`, or null when it is missing or invalid (the proxy then refuses every request that needs CSRF proof). */
function resolveSiteOrigin(): string | null {
  try {
    return new URL(process.env['PCC_BASE_URL'] || '').origin;
  } catch {
    return null;
  }
}

/**
 * `GW_API_URL` as an origin. The package resolves every path against the upstream's origin, so a
 * base path on `GW_API_URL` would be dropped silently; it is refused as a misconfiguration instead.
 */
function resolveGwApiOrigin(): string {
  const base = new URL(getGwApiBaseUrl(OPERATION));
  if (base.pathname !== '/') {
    throw new MicroserviceError('GW_API_URL must be an origin for host-session mode', 503, 'GW_API_URL_MISCONFIGURED', {
      operation: OPERATION,
      service: 'gw_proxy',
    });
  }
  return base.origin;
}
