// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, TransferState, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { GW_EMBED_ENABLED_FEATURES, GW_EMBED_ENABLED_MODULE_IDS, GW_EMBED_STYLESHEET_PATH } from '@lfx-one/shared/constants';
import { GwEmbedFatalError, GwHostContext } from '@lfx-one/shared/interfaces';

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
        basename: '/foundation/gw',
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
        navigateHost: (path) => void this.router.navigateByUrl(path),
      };

      // The embed's stylesheet is emitted as a separate file by its library build
      // (`cssCodeSplit: false`), so importing the JS chunk pulls in no styles — the host has to
      // load the CSS itself. Injected before the import so the styles are in flight alongside the
      // (much larger) chunk rather than after it.
      this.ensureStylesheet();

      // `mount()` sets `globalThis.__GATEWAZE_CONFIG__` itself, in the VITE_-prefixed shape its
      // build-time `define` rewrite expects (`VITE_SUPABASE_URL` and friends) — not this
      // `GwHostContext`. The host must not pre-set it: the shapes differ, and doing so would only
      // put a value the embed never reads in a global it overwrites a moment later.
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
