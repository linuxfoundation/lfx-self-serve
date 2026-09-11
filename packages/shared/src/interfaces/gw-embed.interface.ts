// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Host context passed to `@gatewaze/admin-embed`'s `mount()` when the Gatewaze admin pilot is
 * mounted natively (no iframe) inside LFX One at `/foundation/gw` (`GwModuleOutletComponent`).
 *
 * The embed package itself lives in the `gatewaze` repo (`packages/admin`) and is out of scope
 * here — this interface is the LFX-side half of that contract, kept in sync with the embed's
 * expectations by convention rather than a shared type package.
 */
export interface GwHostContext {
  /** Router basename the embed should mount under, e.g. `/foundation/gw`. */
  basename: string;
  supabase: {
    url: string;
    anonKey: string;
  };
  /** Empty string defaults to `/api/gw` inside the embed. */
  apiBaseUrl: string;
  enabled: {
    moduleIds: string[];
    features: string[];
  };
  signIn: {
    lfidStartUrl: string;
    returnUrl: string;
  };
  storageKeySuffix?: string;
  portalContainer?: HTMLElement;
  /**
   * Host notification sink. With it set, `toast()` calls inside the embed render through the
   * host's own notification system instead of the embed's toaster, so they look and stack like
   * every other notification in LFX. Only string-content toasts cross the boundary; anything
   * richer stays with the embed's own toaster.
   */
  notify?: (notification: GwEmbedNotification) => void;
  onFatal?: (err: GwEmbedFatalError) => void;
  navigateHost?: (path: string) => void;
  telemetry?: (event: { name: string; [key: string]: unknown }) => void;
}

/** Fatal error shape reported by `@gatewaze/admin-embed` via `GwHostContext.onFatal`. */
export interface GwEmbedFatalError {
  error_type: 'config_invalid' | 'import_failed' | 'mount_aborted' | 'render_crash';
  code: string;
  message: string;
  field?: string;
  recoverable: boolean;
}

/**
 * Shape of `globalThis.__GATEWAZE_CONFIG__`, the embed's runtime-config global.
 *
 * The embed's Vite build rewrites every `import.meta.env.VITE_X` reference in its source to a bare
 * `globalThis.__GATEWAZE_CONFIG__.X` — esbuild's `define` only accepts literals or identifier
 * paths, so the rewrite cannot include an optional chain or a fallback. That makes the global a
 * hard requirement rather than an optimization: it must be an object before the embed chunk
 * evaluates, or module-level reads throw.
 *
 * These three are the keys the embed's own `mount()` writes. Its source references far more
 * `VITE_*` names than this; the rest read as `undefined` both here and after `mount()`, so the
 * host deliberately does not invent values for them.
 */
export interface GwRuntimeConfig {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_API_URL: string;
}

/** Severity of a notification the embed hands to the host, mapped from its own toast levels. */
export type GwEmbedNotificationLevel = 'success' | 'error' | 'warning' | 'info';

/** One notification passed to `GwHostContext.notify`. */
export interface GwEmbedNotification {
  level: GwEmbedNotificationLevel;
  /** Plain text; the host renders it with its own components. */
  message: string;
  /** Optional secondary line. */
  description?: string;
  /** Stable id for this notification, unique within the mount. */
  id: string;
  /** Lifetime the embed asked for, in ms. Advisory — the host may use its own. */
  durationMs?: number;
}
