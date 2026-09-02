// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PlatformLocation } from '@angular/common';
import { FetchBackend, HttpEvent, HttpRequest } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Server-only `HttpBackend` override. Rewrites relative `/api/*` and `/public/api/*` URLs to
 * `http://127.0.0.1:$PORT` so the Node process talks to the in-process Express server directly
 * instead of routing through the public load balancer, then delegates to `FetchBackend` via
 * `super.handle(...)`.
 *
 * Replaces the old `ssrBaseUrlInterceptor`: an `HttpInterceptorFn` runs before Angular's
 * `transferCacheInterceptorFn` (an `HTTP_ROOT_INTERCEPTOR_FNS`), so the transfer-cache stored the
 * rewritten absolute URL as its cache key while the browser looked up the original relative path —
 * guaranteeing a cache miss and a duplicate fetch on every hydration. Overriding `HttpBackend`
 * instead rewrites the URL after the transfer-cache has already recorded it under the original
 * relative path, so the browser's cache lookup matches.
 *
 * `provideServerRendering`'s `relativeUrlsTransformerInterceptorFn` is also an
 * `HTTP_ROOT_INTERCEPTOR_FNS`, registered after the transfer cache, so by the time a request
 * reaches this backend on the server it has already been absolutized to the public origin — hence
 * matching on the parsed pathname below rather than assuming `req.url` is still relative. A URL
 * that was already absolute to a *different* origin (a third-party API called directly by app
 * code) must be left alone rather than pattern-matched on path alone.
 *
 * Extends `FetchBackend` (rather than implementing `HttpBackend` and delegating to an injected
 * `FetchBackend` instance) so the `HttpBackend` DI token this class is bound to in
 * `app.config.server.ts` still passes Angular's `instanceof FetchBackend` check — otherwise
 * `HttpInterceptorHandler` logs a spurious `NOT_USING_FETCH_BACKEND_IN_SSR` dev-mode warning on
 * every SSR boot even though `withFetch()` is enabled.
 */
@Injectable()
export class SsrBaseUrlBackend extends FetchBackend {
  private readonly platformLocation = inject(PlatformLocation);

  public override handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    // `relativeUrlsTransformerInterceptorFn` (an HTTP_ROOT_INTERCEPTOR_FNS registered by
    // provideServerRendering) already absolutizes the request to the public origin before it
    // reaches this backend, so `req.url` is no longer guaranteed to be relative — match on the
    // parsed pathname instead of a raw string prefix.
    const parsed = new URL(req.url, 'resolve://');
    const wasRelative = parsed.protocol === 'resolve:';
    if (!wasRelative && parsed.origin !== this.getOwnOrigin()) {
      return super.handle(req);
    }

    const { pathname, search } = parsed;
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/public/api/')) {
      return super.handle(req);
    }

    const port = process.env['PORT'] || '4000';
    const internalBase = `http://127.0.0.1:${port}`;
    return super.handle(req.clone({ url: `${internalBase}${pathname}${search}` }));
  }

  // Mirrors the `urlPrefix` Angular's own `relativeUrlsTransformerInterceptorFn` builds from
  // `PlatformLocation` to absolutize relative requests, so an already-absolute request is only
  // treated as "ours" when it targets that same origin.
  private getOwnOrigin(): string {
    const { protocol, hostname, port } = this.platformLocation;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
  }
}
