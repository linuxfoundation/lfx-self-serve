// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Host context passed to `@gatewaze/admin-embed`'s `mount()` when the Gatewaze admin pilot is
 * mounted natively (no iframe) inside LFX One under `GW_EMBED_ROUTE_PREFIXES`
 * (`GwModuleOutletComponent`).
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
  /**
   * Where LFID sign-in starts, and where it should come back to.
   *
   * Informational. The HOST owns the sign-in round trip, and an embed-initiated one built from
   * these two values cannot complete: adoption is bound to a single-use nonce that only the host
   * mints, `returnUrl` deliberately carries none, and a return leg without it has its tokens
   * discarded rather than adopted. The embed asks for sign-in by calling `navigateHost('/login')`,
   * which the host answers by minting a nonce and starting the flow itself.
   *
   * The nonce is not simply added here: this value is built while the mount context is assembled,
   * which happens BEFORE the host consumes a nonce arriving from a completed sign-in. Minting one
   * at that point would overwrite the pending nonce and break every host-initiated return.
   */
  signIn: {
    /** The host's own sign-in entry point (LFID here). The embed never implements sign-in itself. */
    startUrl: string;
    returnUrl: string;
  };
  /** Where the loader fetches the embed from (`GW_EMBED_URL`) and how its stylesheet reaches the page. */
  source: GwEmbedSource;
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

/**
 * The hosted embed's location, passed to the loader as `GwHostContext.source`.
 *
 * `@gatewaze/admin-embed` is a loader: the admin bundle itself is served by the Gatewaze
 * deployment under `<baseUrl>/` (a `manifest.json` naming the current content-hashed entry and
 * stylesheet, plus the files). The host picks up admin changes on the next page load with no
 * release of its own; only a change to the loader's host contract needs the package bumped.
 */
export interface GwEmbedSource {
  /** Absolute URL of the deployment's embed directory, e.g. `https://admin.example.org/embed`. */
  baseUrl: string;
  /**
   * Swaps the manifest's stylesheet URL for the one to fetch. LFX One points this at its own
   * `GW_EMBED_STYLESHEET_ROUTE`, which fetches the hashed file, scopes it to the host chrome and
   * caches it, so the scoping runs once per build on the server rather than in every browser.
   */
  resolveStylesheetUrl?: (url: string) => string;
}

/** Fatal error shape reported by `@gatewaze/admin-embed` via `GwHostContext.onFatal`. */
export interface GwEmbedFatalError {
  error_type: 'config_invalid' | 'import_failed' | 'mount_aborted' | 'render_crash';
  code: string;
  message: string;
  field?: string;
  recoverable: boolean;
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

/**
 * Handle returned by the embed's `mount()`.
 *
 * The other half of the mount contract that `GwHostContext` describes — the host holds this to
 * tear the embed down on destroy.
 */
export interface GwEmbedMountHandle {
  unmount: () => void;
  /**
   * Resolves once the embed is mounted (with the deployment's manifest), or with `null` when
   * loading failed — reported through `onFatal` — or `unmount()` was called first. Never rejects.
   */
  ready: Promise<GwEmbedManifest | null>;
}

/** The deployment's `<baseUrl>/manifest.json`, as the loader hands it back. */
export interface GwEmbedManifest {
  /** Host contract version the bundle implements; the loader refuses one it was not built for. */
  contract: number;
  /** Release the bundle was built from (the Gatewaze image tag). */
  version: string;
  entry: string;
  stylesheet: string;
  modules: string[];
  builtAt: string;
}

/**
 * `RequestInit` plus undici's streaming-body option.
 *
 * `duplex: 'half'` is required by undici whenever `body` is a stream, but it is not in
 * `lib.dom.d.ts`'s `RequestInit`, so the server's proxy cannot type the call without this.
 */
export interface FetchRequestInit extends RequestInit {
  duplex?: 'half';
}
