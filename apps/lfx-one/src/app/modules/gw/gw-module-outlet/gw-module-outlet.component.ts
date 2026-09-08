// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, TransferState, viewChild } from '@angular/core';
import { Router } from '@angular/router';
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
 * `@gatewaze/admin-embed` is published from the separate `gatewaze` repo and is out of scope for
 * this change — until it exists as a resolvable workspace/npm dependency, the dynamic import below
 * will fail. That failure is expected and is handled the same way a genuine runtime failure from
 * the embed would be: caught, logged, and surfaced via `mountError` for the inline fallback.
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
          // ASSUMPTION (spec truncated before describing per-cohort module/feature enablement):
          // ship everything the embed exposes for now rather than a curated allowlist. Revisit
          // once the cohort-membership/enablement mechanism is specified.
          moduleIds: [],
          features: [],
        },
        signIn: {
          lfidStartUrl: runtimeConfig.gwLfidStartUrl,
          returnUrl: window.location.href,
        },
        portalContainer: this.embedPortals().nativeElement,
        onFatal: (err) => this.onFatal(err),
        navigateHost: (path) => void this.router.navigateByUrl(path),
      };

      // ASSUMPTION (spec truncated before confirming the exact handshake): the embed is documented
      // to read its host context off this global ahead of / during `mount()`. Setting it here,
      // immediately before the dynamic import resolves, is the safest ordering we can guarantee
      // without the real package to verify against.
      (globalThis as unknown as { __GATEWAZE_CONFIG__?: GwHostContext }).__GATEWAZE_CONFIG__ = ctx;

      // NOTE: @gatewaze/admin-embed is published from the separate `gatewaze` repo (out of scope
      // here) and does not exist as an installable package yet. This import is expected to fail to
      // resolve until that package ships and is added as a dependency of apps/lfx-one — see the
      // final report for details. The catch block below is what handles that (and any genuine
      // future runtime failure) identically.
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
}
