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
