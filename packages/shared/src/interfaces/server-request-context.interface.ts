// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { StaticProvider } from '@angular/core';

import { AuthContext } from './auth.interface';
import { RuntimeConfig } from './runtime-config.interface';

/**
 * Per-request context threaded from the Express SSR handler into the Angular app
 * via Angular's `REQUEST_CONTEXT` injection token (see `server.ts`). The same object
 * reference is shared, so a component can mutate `notFound` during SSR to signal the
 * server to emit an HTTP 404 for the originally-requested path.
 */
export interface ServerRequestContext {
  /** Resolved authentication context for the request. */
  auth?: AuthContext;

  /** Client-side runtime configuration passed through to TransferState. */
  runtimeConfig?: RuntimeConfig;

  /**
   * Set to `true` during SSR by a not-found view (global catch-all or public profile)
   * so `server.ts` rewrites the response status to 404 without changing the URL.
   */
  notFound?: boolean;

  /**
   * Static providers threaded into the Angular render (base href, `REQUEST`). Present only
   * on the server-side producer in `server.ts`; typing it here binds that literal to this
   * contract so a field rename fails the build instead of silently reading `undefined`.
   */
  providers?: StaticProvider[];
}
