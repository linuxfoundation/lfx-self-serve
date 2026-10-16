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
  /**
   * `url` is LFX One's own Supabase proxy (`<origin>/api/gatewaze/supabase`), which must be absolute
   * and on the page's origin. `publicUrl` is the real Supabase project URL, used for saved public
   * storage URLs. `anonKey` is the publishable key.
   */
  supabase: {
    url: string;
    anonKey: string;
    publicUrl: string;
  };
  /**
   * The Gatewaze API proxy's mount. The embed calls `${apiBaseUrl}/api/...`, so LFX One passes
   * `/api/gatewaze` and the calls land on `/api/gatewaze/api/...`.
   */
  apiBaseUrl: string;
  enabled: {
    moduleIds: string[];
    features: string[];
  };
  /**
   * Host-session mode, the only mode LFX One uses: LFX One holds the Gatewaze session on the server,
   * and the browser sees only a placeholder token, so no Gatewaze token reaches page scripts,
   * `localStorage` or the URL. Both routes are same-origin. The loader refuses to mount a bundle whose
   * manifest does not advertise the `host-session` capability (`gw_embed_capability_missing`).
   */
  session: GwEmbedHostSession;
  /** Where the loader fetches the embed from (`GW_EMBED_URL`) and how its stylesheet reaches the page. */
  source: GwEmbedSource;
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

/** `GwHostContext.session`: the routes LFX One serves for host-session mode (`gatewaze.route.ts`). */
export interface GwEmbedHostSession {
  mode: 'host';
  /** `GET`: the signed-in Gatewaze user, or the reason there is none (see `gw-host-session.md`). */
  meUrl: string;
  /** `POST`: ends the Gatewaze session. The LFX session is left alone. */
  logoutUrl: string;
}

/**
 * The hosted embed's location, passed to the loader as `GwHostContext.source`.
 *
 * `@gatewaze/admin-embed` is a loader: the admin bundle itself is served by the Gatewaze
 * deployment under `<baseUrl>/` (a `manifest.json` naming the current content-hashed entry and
 * stylesheet, plus the files). The host picks up admin changes on the next page load with no
 * release of its own. The package is bumped only for a change to the loader's host contract, or to
 * use a capability the loader checks for, such as `host-session`.
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

/**
 * One scoped embed stylesheet as the server caches and serves it (`GwEmbedStylesheetService`):
 * the contained Gatewaze CSS with the LFX theme layer appended, the ETag derived from it, and the
 * body compressed once per encoding so no request pays for compressing several megabytes.
 */
export interface GwEmbedScopedStylesheet {
  css: string;
  etag: string;
  /** The UTF-8 body as sent uncompressed, encoded once rather than per request. */
  identity: Uint8Array;
  /**
   * The UTF-8 body, compressed with gzip. `Uint8Array` (which `Buffer` satisfies) so this
   * browser-consumed package does not couple its types to Node's `Buffer` global.
   */
  gzip: Uint8Array;
  /** The UTF-8 body, compressed with Brotli. */
  br: Uint8Array;
}

/** One encoding of a scoped embed stylesheet, as picked for a request. */
export interface GwEmbedStylesheetVariant {
  encoding: 'br' | 'gzip' | 'identity';
  body: Uint8Array;
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
  /**
   * Optional features the bundle supports, e.g. `host-session`. Absent on bundles built before the
   * field existed, which support none.
   */
  capabilities?: string[];
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
