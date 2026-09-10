// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, TransferState, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  GW_EMBED_DEFAULT_API_BASE_URL,
  GW_EMBED_ENABLED_FEATURES,
  GW_EMBED_ENABLED_MODULE_IDS,
  GW_EMBED_LOGIN_PATH,
  GW_EMBED_ROUTE_PREFIX,
  GW_EMBED_STYLESHEET_PATH,
} from '@lfx-one/shared/constants';
import { GwEmbedFatalError, GwHostContext, GwRuntimeConfig } from '@lfx-one/shared/interfaces';

import { getRuntimeConfig } from '../../../shared/providers/runtime-config.provider';

/**
 * Handle returned by `@gatewaze/admin-embed`'s `mount()`. Kept local (not in the shared interface
 * file) since it's purely an implementation detail of this component's own cleanup, not part of
 * the host-context contract the embed reads.
 */
interface GwEmbedMountHandle {
  unmount: () => void;
}

/**
 * Writes the embed's runtime-config global. Kept as a narrow function so the one `globalThis` cast
 * in this file lives in a single place rather than inline at the call site.
 */
function setGwRuntimeConfig(config: GwRuntimeConfig): void {
  (globalThis as unknown as { __GATEWAZE_CONFIG__?: GwRuntimeConfig }).__GATEWAZE_CONFIG__ = config;
}

/**
 * Native (no-iframe) host for the embedded Gatewaze admin pilot at `/foundation/gw`.
 *
 * Mirrors `rich-editor.component.ts`'s SSR-safe lazy-mount pattern: on the server this renders two
 * empty mount points and nothing else; in the browser, `afterNextRender` dynamically imports
 * `@gatewaze/admin-embed` and hands it a `GwHostContext` to mount itself into `#embedRoot`.
 *
 * `@gatewaze/admin-embed` is built in the separate `gatewaze` repo (`packages/admin`'s
 * `build:embed` script, emitting `dist-embed/admin-embed.{js,css}`) and is not published to a
 * registry yet, so it has to be resolved locally. Until it is a real dependency the dynamic import
 * below fails — handled the same way a genuine runtime failure from the embed would be: caught,
 * logged, and surfaced via `mountError` for the inline fallback.
 */
@Component({
  selector: 'lfx-gw-module-outlet',
  imports: [],
  templateUrl: './gw-module-outlet.component.html',
})
export class GwModuleOutletComponent {
  // 1. Private injections
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly transferState = inject(TransferState);

  // viewChild mount points — both are unconditional siblings in the template so they exist in the
  // DOM (and are stable references) before the embed ever mounts.
  protected readonly embedRoot = viewChild.required<ElementRef<HTMLDivElement>>('embedRoot');
  protected readonly embedPortals = viewChild.required<ElementRef<HTMLDivElement>>('embedPortals');

  // 5. WritableSignals
  protected readonly mountError = signal<string | null>(null);
  protected readonly signInRequired = signal(false);

  // Plain (non-signal) mount bookkeeping — not template-bound, so no need for reactivity here.
  private destroyed = false;
  private mounting = false;
  private mountHandle: GwEmbedMountHandle | null = null;

  // 7. Constructor
  public constructor() {
    afterNextRender(() => {
      void this.mountEmbed();
    });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.mountHandle?.unmount();
      this.mountHandle = null;
    });
  }

  /**
   * Starts the LFID flow, returning to whatever `/foundation/gw` page the user is on.
   *
   * Deliberately user-initiated rather than automatic: the embed asks the host to navigate to
   * `/login` on every unauthenticated render, so auto-redirecting here would spin the user through
   * Auth0 in a loop whenever sign-in doesn't stick.
   */
  protected startSignIn(): void {
    const lfidStartUrl = getRuntimeConfig(this.transferState).gwLfidStartUrl;
    if (!lfidStartUrl) {
      this.mountError.set('Gatewaze sign-in is not configured (GW_LFID_START_URL is unset).');
      return;
    }

    const separator = lfidStartUrl.includes('?') ? '&' : '?';
    window.location.assign(`${lfidStartUrl}${separator}return_url=${encodeURIComponent(window.location.href)}`);
  }

  // 10. Private initializer
  private async mountEmbed(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // The embed itself is documented to guard against being mounted twice into the same node, but
    // we still guard here so a second `afterNextRender` firing (or any future re-entrant caller)
    // can't kick off a redundant import + mount while one is already in flight or done.
    if (this.mounting || this.mountHandle) {
      return;
    }
    this.mounting = true;

    try {
      const runtimeConfig = getRuntimeConfig(this.transferState);

      const ctx: GwHostContext = {
        basename: GW_EMBED_ROUTE_PREFIX,
        supabase: {
          url: runtimeConfig.gwSupabaseUrl,
          anonKey: runtimeConfig.gwSupabaseAnonKey,
        },
        // Empty string tells the embed to default to same-origin `/api/gw` (see gw-embed.interface.ts).
        apiBaseUrl: '',
        enabled: {
          // The embed intersects these with Gatewaze's own DB-backed enablement — the overlay only
          // ever narrows. Empty arrays would disable every module and feature, so the pilot set is
          // listed explicitly; see the constants for what's in it and how to narrow further.
          moduleIds: [...GW_EMBED_ENABLED_MODULE_IDS],
          features: [...GW_EMBED_ENABLED_FEATURES],
        },
        signIn: {
          lfidStartUrl: runtimeConfig.gwLfidStartUrl,
          returnUrl: window.location.href,
        },
        portalContainer: this.embedPortals().nativeElement,
        onFatal: (err) => this.onFatal(err),
        navigateHost: (path) => this.handleHostNavigation(path),
      };

      // The embed's stylesheet is emitted as a separate file by its library build
      // (`cssCodeSplit: false`), so importing the JS chunk pulls in no styles — the host has to
      // load the CSS itself. Injected before the import so the styles are in flight alongside the
      // (much larger) chunk rather than after it.
      this.ensureStylesheet();

      // The global has to exist BEFORE the chunk evaluates, not just before `mount()` runs.
      //
      // The embed's build rewrites every `import.meta.env.VITE_X` to a bare
      // `globalThis.__GATEWAZE_CONFIG__.X` — no optional chaining, because esbuild's `define`
      // only accepts literals or identifier paths. So any module-level read during import
      // evaluation throws `Cannot read properties of undefined` if the global is unset, and
      // `mount()` setting it is already too late by then.
      //
      // Set it in the VITE_-prefixed shape the rewrite expects (NOT `GwHostContext`), with the
      // same three values and the same `apiBaseUrl` defaulting `mount()` itself applies, so this
      // pre-set and the one inside `mount()` are identical and re-setting is a no-op. The embed's
      // other VITE_ references stay undefined here exactly as they do after `mount()`.
      setGwRuntimeConfig({
        VITE_SUPABASE_URL: ctx.supabase.url,
        VITE_SUPABASE_ANON_KEY: ctx.supabase.anonKey,
        VITE_API_URL: ctx.apiBaseUrl === '' ? GW_EMBED_DEFAULT_API_BASE_URL : ctx.apiBaseUrl,
      });

      const mod = await import('@gatewaze/admin-embed');

      // The component may have been torn down while the import was in flight (fast navigation away
      // from /foundation/gw) — don't mount into a host node that's about to be removed.
      if (this.destroyed) {
        return;
      }

      this.mountHandle = mod.mount(this.embedRoot().nativeElement, ctx);
    } catch (error) {
      // No client-side error-reporting service exists yet; console.error is the established
      // fallback used throughout apps/lfx-one/src/app/shared (no-console isn't a lint rule here).
      console.error('[GwModuleOutlet] Failed to load or mount @gatewaze/admin-embed', error);
      this.onFatal({
        error_type: 'import_failed',
        code: 'GW_EMBED_IMPORT_FAILED',
        message: error instanceof Error ? error.message : 'Failed to load the embedded admin module.',
        recoverable: false,
      });
    } finally {
      this.mounting = false;
    }
  }

  /**
   * Handles a path the embed hands back through `navigateHost`.
   *
   * The embed's router registers a catch-all that forwards any path it can't match to the host —
   * but the Angular route for this outlet is itself a `/foundation/gw/**` wildcard, so handing such
   * a path straight to `navigateByUrl` re-enters this component, re-mounts the embed, fails to
   * match again, and ping-pongs forever. The embed compiles in module routes only, with no `/login`
   * among them, so an unauthenticated render hits exactly that loop: `FeatureGuard` renders
   * `<Navigate to="/login">`, which resolves against the basename to `/foundation/gw/login`.
   *
   * So paths inside the prefix are never forwarded to the router. `/login` is answered with the
   * sign-in prompt the embed has no UI for; any other unmatched in-prefix path is surfaced as an
   * error rather than silently looping. Paths outside the prefix are genuine host navigation.
   */
  private handleHostNavigation(path: string): void {
    if (!path.startsWith(GW_EMBED_ROUTE_PREFIX)) {
      void this.router.navigateByUrl(path);
      return;
    }

    const remainder = path.slice(GW_EMBED_ROUTE_PREFIX.length).split('?')[0].replace(/\/$/, '');
    if (remainder === GW_EMBED_LOGIN_PATH) {
      this.signInRequired.set(true);
      return;
    }

    this.mountError.set(`The embedded admin module asked to open "${path}", which has no route.`);
  }

  // 10. Private initializer
  private onFatal(err: GwEmbedFatalError): void {
    this.mountError.set(err.message || 'The embedded admin module failed to load.');
  }

  /**
   * Adds the embed's stylesheet to `<head>` once per document.
   *
   * It stays there after unmount: the sheet is only reachable through the embed's own scoping
   * selectors, re-fetching it on every visit to `/foundation/gw` would be wasteful, and removing it
   * mid-teardown risks unstyled portal content during React's cleanup pass.
   */
  private ensureStylesheet(): void {
    if (document.querySelector(`link[href="${GW_EMBED_STYLESHEET_PATH}"]`)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GW_EMBED_STYLESHEET_PATH;
    document.head.appendChild(link);
  }
}
