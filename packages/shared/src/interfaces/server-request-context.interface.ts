// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// `import type`, deliberately. StaticProvider is used only as a type annotation, but a VALUE
// import makes `@angular/core` a RUNTIME dependency of this module -- and the interfaces barrel
// re-exports it, so a server module reaching `@lfx-one/shared/interfaces` (or `/constants`, which
// re-exports from `../interfaces`) pulls Angular into a plain-Node vitest run. A type-only import
// is erased at compile time, so the annotation survives and the runtime edge disappears.
import type { StaticProvider } from '@angular/core';

import { AuthContext } from './auth.interface';
import { RuntimeConfig } from './runtime-config.interface';

/** A LaunchDarkly user context built from the same claims the browser's `FeatureFlagService` uses. */
export interface ServerFlagUserContext {
  key: string;
  name?: string;
  email?: string;
}

/** Flags the server evaluated for this render, so SSR and hydration pick the same page. */
export interface ServerRequestFlags {
  /** `MEETINGS_REDESIGN_FLAG` for the viewer; set only on `/meetings/:id` for a signed-in viewer. */
  meetingsRedesign?: boolean;
}

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

  /** SSR emits 503 so a transient failure is never cached or indexed as missing. */
  unavailable?: boolean;

  /** Server-evaluated feature flags; see `ServerRequestFlags`. */
  flags?: ServerRequestFlags;

  /**
   * Static providers threaded into the Angular render (base href, `REQUEST`). Present only
   * on the server-side producer in `server.ts`; typing it here binds that literal to this
   * contract so a field rename fails the build instead of silently reading `undefined`.
   */
  providers?: StaticProvider[];
}
