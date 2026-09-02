// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FetchBackend, HttpBackend, HttpEvent, HttpRequest } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Server-only `HttpBackend` override. Rewrites relative `/api/*` and `/public/api/*` URLs to
 * `http://127.0.0.1:$PORT` so the Node process talks to the in-process Express server directly
 * instead of routing through the public load balancer, then delegates to `FetchBackend`.
 *
 * Replaces the old `ssrBaseUrlInterceptor`: an `HttpInterceptorFn` runs before Angular's
 * `transferCacheInterceptorFn` (an `HTTP_ROOT_INTERCEPTOR_FNS`), so the transfer-cache stored the
 * rewritten absolute URL as its cache key while the browser looked up the original relative path —
 * guaranteeing a cache miss and a duplicate fetch on every hydration. Overriding `HttpBackend`
 * instead rewrites the URL after the transfer-cache has already recorded it under the original
 * relative path, so the browser's cache lookup matches.
 */
@Injectable()
export class SsrBaseUrlBackend implements HttpBackend {
  private readonly fetchBackend = inject(FetchBackend);

  public handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/public/api/')) {
      return this.fetchBackend.handle(req);
    }

    const port = process.env['PORT'] || '4000';
    const internalBase = `http://127.0.0.1:${port}`;
    return this.fetchBackend.handle(req.clone({ url: `${internalBase}${req.url}` }));
  }
}
