// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  PLATFORM_ID,
  signal,
  TransferState,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  GW_EMBED_CAPABILITY_MISSING_CODE,
  GW_EMBED_ENABLED_FEATURES,
  GW_EMBED_ENABLED_MODULE_IDS,
  GW_EMBED_FIRST_PAINT_CAPABILITY,
  GW_EMBED_FIRST_PAINT_TIMEOUT_MS,
  GW_EMBED_HOST_SESSION_LOGOUT_URL,
  GW_EMBED_HOST_SESSION_ME_URL,
  GW_EMBED_LOGIN_PATH,
  GW_EMBED_NOTIFICATION_DEFAULT_LIFE_MS,
  GW_EMBED_LOADING_INDICATOR_CLASS,
  GW_EMBED_NOTIFICATION_SEVERITY,
  GW_EMBED_PAINTED_CONTENT_SELECTOR,
  GW_EMBED_STYLESHEET_ROUTE,
  GW_HOST_SESSION_PROXY_API_MOUNT,
  GW_HOST_SESSION_PROXY_SUPABASE_MOUNT,
  lfxColors,
} from '@lfx-one/shared/constants';
import { resolveGwEmbedRoutePrefix } from '@lfx-one/shared/utils';
import { GwEmbedFatalError, GwEmbedMountHandle, GwEmbedNotification, GwHostContext } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';

import { GwEmbedWarmupService } from '../../../shared/services/gw-embed-warmup.service';
import { UserService } from '../../../shared/services/user.service';

import { getRuntimeConfig } from '../../../shared/providers/runtime-config.provider';

/**
 * Native (no-iframe) host for the embedded Gatewaze admin pilot.
 *
 * Mounted twice — once per lens, at `/foundation/gw` and `/project/gw` (`GW_EMBED_ROUTE_PREFIXES`).
 * One component serves both: it resolves its own basename from `window.location.pathname`, so the
 * embed's router builds links under whichever prefix the user arrived on.
 *
 * Mirrors `rich-editor.component.ts`'s SSR-safe lazy-mount pattern: on the server this renders two
 * empty mount points and nothing else; in the browser, `afterNextRender` dynamically imports
 * `@gatewaze/admin-embed` and hands it a `GwHostContext` to mount itself into `#embedRoot`.
 *
 * The embed runs only in host-session mode: LFX One holds the Gatewaze session on the server and
 * proxies Supabase and the Gatewaze API under `/api/gatewaze` (`gw-host-session.md`). When the
 * server reports that mode is off or incomplete (`RuntimeConfig.gwHostSession`), the outlet shows
 * its not-configured panel and never mounts.
 *
 * `@gatewaze/admin-embed` is a small loader, published from the separate `gatewaze` repo. The
 * admin bundle itself is served by the Gatewaze deployment at `GW_EMBED_URL` (a `manifest.json`
 * naming the current content-hashed entry and stylesheet); the loader reads the manifest, checks
 * the host contract, injects the stylesheet and imports the entry. Admin changes therefore reach
 * this page on the next load with no LFX release. The dependency is bumped only for a loader
 * contract change, or to use a capability the loader checks for (`host-session` in 1.1.0;
 * `first-paint` and `host-loading-indicator` in 1.2.0). The
 * dynamic import of the loader is
 * still wrapped, because a runtime failure from the embed — a bad chunk, a render crash on mount —
 * is handled the same way: caught, logged, and surfaced via `mountError` for the inline fallback.
 */
@Component({
  selector: 'lfx-gw-module-outlet',
  imports: [SkeletonModule],
  templateUrl: './gw-module-outlet.component.html',
})
export class GwModuleOutletComponent {
  // 1. Private injections
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly transferState = inject(TransferState);
  private readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);
  private readonly warmup = inject(GwEmbedWarmupService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  // viewChild mount points — both are unconditional siblings in the template so they exist in the
  // DOM (and are stable references) before the embed ever mounts.
  protected readonly embedRoot = viewChild.required<ElementRef<HTMLDivElement>>('embedRoot');
  protected readonly embedPortals = viewChild.required<ElementRef<HTMLDivElement>>('embedPortals');

  // 5. WritableSignals
  protected readonly mountError = signal<string | null>(null);

  /**
   * True from the first BROWSER render until the embed has painted something or failed — never
   * during SSR.
   *
   * `mountEmbed` runs from `afterNextRender` and returns early off-browser, so the server-rendered
   * HTML carries the mount points and no skeleton.
   *
   * Template-bound: it shows the skeleton and keeps `#gw-embed-root` at `visibility: hidden`. The
   * loader's `ready` resolves once the bundle is mounted, which is before React has drawn anything,
   * so clearing this on `ready` left a blank pane until the embed's own first paint. It is cleared
   * when the embed has painted instead: `waitForRendered` for a bundle with the `first-paint`
   * capability, `waitForFirstPaint` for any other.
   */
  protected readonly mounting = signal(false);

  /**
   * True while the host is showing its error panel instead of the embed.
   *
   * Drives collapsing the mount points: an embed sitting at a dead end still occupies full height
   * while rendering nothing, which pushed the host's panel off-screen entirely.
   */
  protected readonly hostPanelShowing = computed(() => this.mountError() !== null);

  // Plain (non-signal) mount bookkeeping — not template-bound, so no need for reactivity here.
  private destroyed = false;
  private mountHandle: GwEmbedMountHandle | null = null;
  /** The latest host navigation's id and trigger — see watchHostNavigation. */
  private pendingNavigation: Pick<NavigationStart, 'id' | 'navigationTrigger'> | null = null;
  /** Which mount path this instance is serving; see resolveGwEmbedRoutePrefix. */
  private routePrefix: string = resolveGwEmbedRoutePrefix('');
  /** Ends a `waitForRendered` or `waitForFirstPaint` in progress; null when none is. */
  private endPaintWait: (() => void) | null = null;

  // 7. Constructor
  public constructor() {
    // Runs during SSR too, so a page rendered on this route carries the hint in its <head> and the
    // browser opens the connection to GW_EMBED_URL while it is still parsing the HTML.
    this.warmup.preconnect();
    afterNextRender(() => {
      void this.mountEmbed();
    });
    // A terminal error during the paint wait (a non-recoverable fatal, or the sign-in bounce after a
    // 401 from /session/me) raises the error panel; the skeleton must go with it rather than sit
    // above the panel until the wait times out.
    effect(() => {
      if (this.hostPanelShowing()) {
        this.endPaintWait?.();
      }
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

    // Refuse to mount while impersonating. The `/api/gatewaze` routes answer 403 then
    // (`requireGwEmbedAccess`), because nothing mints a Gatewaze session for an impersonation
    // target: that would let support staff act as a user inside a system with its own identity
    // model. Mounting would only show an embed whose every call fails, so the outlet explains it.
    if (this.userService.impersonating()) {
      this.mountError.set('The newsletters module is unavailable while impersonating another user.');
      return;
    }

    // The embed itself is documented to guard against being mounted twice into the same node, but
    // we still guard here so a second `afterNextRender` firing (or any future re-entrant caller)
    // can't kick off a redundant import + mount while one is already in flight or done.
    if (this.mounting() || this.mountHandle) {
      return;
    }
    this.mounting.set(true);
    // Start the session mint now rather than when the embed asks for it, after the manifest and the
    // bundle have loaded. Fire and forget: the embed's own /session/me waits on the same mint.
    this.warmup.warmSession();

    try {
      const runtimeConfig = getRuntimeConfig(this.transferState);

      // Fail at the boundary rather than inside the embed. Host-session mode is the only mode, so
      // with it off or incomplete on the server every `/api/gatewaze` call would answer the uniform
      // 404: fail closed with the not-configured panel instead. The remaining values default to ''
      // when their env vars are unset, and an empty one produces an opaque failure several layers
      // down — this is also the behaviour RuntimeConfig's own doc comment promises.
      if (!runtimeConfig.gwHostSession) {
        this.mountError.set('The embedded admin module is not configured (Gatewaze host-session mode is off or incomplete on the server).');
        return;
      }
      if (!runtimeConfig.gwSupabaseUrl || !runtimeConfig.gwSupabaseAnonKey || !runtimeConfig.gwEmbedUrl) {
        this.mountError.set('The embedded admin module is not configured (GW_SUPABASE_URL / GW_SUPABASE_ANON_KEY / GW_EMBED_URL are unset).');
        return;
      }
      // Resolved rather than fixed: the embed is mounted from both the Foundation Lens and the
      // Project Lens, and the basename must match the path the user actually arrived on.
      this.routePrefix = resolveGwEmbedRoutePrefix(window.location.pathname);

      const ctx: GwHostContext = {
        basename: this.routePrefix,
        // LFX One holds the Gatewaze session on the server, keyed off the LFX session cookie, and
        // proxies Supabase (`gatewaze-proxy.controller.ts` for REST, Storage and Functions,
        // `gatewaze-realtime.service.ts` for the Realtime socket) and the Gatewaze API. The embed
        // sends a placeholder token there, so no Gatewaze token reaches this page.
        supabase: {
          // The Supabase proxy, absolute on this origin as the embed requires.
          url: `${window.location.origin}${GW_HOST_SESSION_PROXY_SUPABASE_MOUNT}`,
          // The publishable key; the proxy's CSRF check compares it on writes.
          anonKey: runtimeConfig.gwSupabaseAnonKey,
          // The real project URL, so saved image URLs never point at LFX. The embed accepts it only
          // as https, or http on localhost, 127.0.0.1 or `*.localhost`.
          publicUrl: runtimeConfig.gwSupabaseUrl,
        },
        // The embed calls `${apiBaseUrl}/api/...`, which lands on the API proxy.
        apiBaseUrl: GW_HOST_SESSION_PROXY_API_MOUNT,
        // When a proxied call reports the session expired, the embed reloads the page (at most twice
        // in 30 seconds), and LFX's own auth guard handles a dead LFX session from there.
        session: {
          mode: 'host',
          meUrl: GW_EMBED_HOST_SESSION_ME_URL,
          logoutUrl: GW_EMBED_HOST_SESSION_LOGOUT_URL,
        },
        enabled: {
          // The embed intersects these with Gatewaze's own DB-backed enablement — the overlay only
          // ever narrows. Empty arrays would disable every module and feature, so the pilot set is
          // listed explicitly; see the constants for what's in it and how to narrow further.
          moduleIds: [...GW_EMBED_ENABLED_MODULE_IDS],
          features: [...GW_EMBED_ENABLED_FEATURES],
        },
        source: {
          baseUrl: runtimeConfig.gwEmbedUrl,
          // The bundle's stylesheet is unscoped; the server scopes and caches it by hashed name
          // (gw-embed-stylesheet.service.ts), so only the file name crosses over.
          // The server's key for its own share of the output (theme and transform) goes in the path,
          // so the URL is content-addressed and can be cached as immutable.
          resolveStylesheetUrl: (url) => buildGwEmbedStylesheetUrl(resolveGwEmbedStylesheetName(url), runtimeConfig.gwEmbedStylesheetKey),
        },
        portalContainer: this.embedPortals().nativeElement,
        notify: (notification) => this.showHostToast(notification),
        onFatal: (err) => this.onFatal(err),
        navigateHost: (path) => this.handleHostNavigation(path),
        // LFX's own CSS spinner ring in place of the embed's, so its loading states match the rest
        // of the app. The loader passes this only to a bundle with the `host-loading-indicator` capability.
        loadingIndicator: () => createGwEmbedLoadingIndicator(document),
      };

      const mod = await this.loadEmbedLoader();

      // The component may have been torn down while the import was in flight (fast navigation away
      // away from the embed) — don't mount into a host node that's about to be removed.
      if (this.destroyed) {
        return;
      }

      // Returns at once; the loader fetches the manifest, stylesheet and bundle, then mounts.
      // Failures on that path come back through `onFatal` (and `ready` resolves null), and an
      // `unmount()` before `ready` cancels the mount, so teardown needs no extra bookkeeping.
      // Held in a local: teardown nulls `this.mountHandle` while the awaits below are pending.
      const handle = mod.mount(this.embedRoot().nativeElement, ctx);
      this.mountHandle = handle;
      this.watchHostNavigation();
      // Keep the skeleton up until the embed has painted: `mounting` is cleared in the finally
      // below. Clearing it on the synchronous return would leave the outlet blank while the loader
      // is still fetching, and clearing it on `ready` leaves it blank until React's first render.
      const manifest = await handle.ready;
      if (manifest) {
        console.info(`[GwModuleOutlet] Gatewaze embed ${manifest.version} mounted (contract ${manifest.contract})`);
        // A bundle that signals its own first paint makes `rendered` exact; any other resolves it
        // with `ready`, before anything is drawn, so the outlet watches the root itself instead.
        await (manifest.capabilities?.includes(GW_EMBED_FIRST_PAINT_CAPABILITY)
          ? this.waitForRendered(handle.rendered)
          : this.waitForFirstPaint(this.embedRoot().nativeElement));
      } else if (!this.destroyed && !this.hostPanelShowing()) {
        // Nothing mounted. The loader has already said why through `onFatal`, but it marks a
        // manifest or bundle fetch failure as recoverable (a retry may work), which `onFatal`
        // surfaces as a toast and nothing else — and a toast over an empty outlet reads as a
        // hang. Unless teardown cancelled the mount or a panel is already up, this is terminal.
        this.mountError.set('The embedded admin module could not be loaded. Reload the page to try again.');
      }
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
      this.mounting.set(false);
      // Swap the skeleton for the embed in the same frame the embed painted in. The paint is seen
      // from an observer callback, and this runs in the microtasks that follow it, before the
      // browser renders; the scheduled change detection could land a frame later and show both
      // the hidden embed's space and no skeleton, the blank frame this exists to avoid.
      if (!this.destroyed) {
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  /**
   * Resolves once `root` holds painted content (see `gwEmbedHasPaintedContent`). The first thing
   * the embed draws may be its own loading spinner; that counts, so the skeleton hands over to it
   * directly. Also resolves on teardown, as soon as the error panel is up, and after
   * `GW_EMBED_FIRST_PAINT_TIMEOUT_MS` so a render that never produces height cannot leave the
   * skeleton up forever.
   *
   * The root keeps laying out while hidden (`visibility`, not `display`), which is what lets the
   * observers measure it.
   *
   * The fallback for a bundle without the `first-paint` capability; see `waitForRendered`.
   */
  private waitForFirstPaint(root: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed || this.hostPanelShowing() || this.embedHasPainted(root)) {
        resolve();
        return;
      }
      const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => check());
      const mutationObserver = new MutationObserver(() => check());
      const timer = setTimeout(() => {
        console.warn(`[GwModuleOutlet] The embed painted nothing within ${GW_EMBED_FIRST_PAINT_TIMEOUT_MS} ms of mounting; showing it anyway`);
        finish();
      }, GW_EMBED_FIRST_PAINT_TIMEOUT_MS);
      const unregisterDestroy = this.destroyRef.onDestroy(() => finish());
      const finish = (): void => {
        clearTimeout(timer);
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        unregisterDestroy();
        this.endPaintWait = null;
        resolve();
      };
      const check = (): void => {
        if (this.hostPanelShowing() || this.embedHasPainted(root)) {
          finish();
        }
      };
      this.endPaintWait = finish;
      // The root itself resizes when content arrives; content appearing inside a wrapper that already
      // has height (Radix's root Theme) does not resize it, so mutations are watched too.
      resizeObserver?.observe(root);
      mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  /**
   * Resolves when the loader's `rendered` does, for a bundle with the `first-paint` capability: the
   * embed signals once its first route content or spinner has committed. The loader bounds that
   * wait itself, and resolves `rendered` on a fatal error and on `unmount()` too. The error panel
   * ends the wait at once, as it does for `waitForFirstPaint`.
   */
  private waitForRendered(rendered: Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed || this.hostPanelShowing()) {
        resolve();
        return;
      }
      const finish = (): void => {
        this.endPaintWait = null;
        resolve();
      };
      this.endPaintWait = finish;
      void rendered.then(finish);
    });
  }

  /** The paint test, as a property so the spec can stand it in: the test DOM does no layout. */
  private embedHasPainted = (root: HTMLElement): boolean => gwEmbedHasPaintedContent(root);

  /**
   * Keeps the embed's router in step with host-initiated navigation.
   *
   * Both mounts are `**` wildcards, so moving between two embed URLs — going back to an index from
   * a detail page, say — does not recreate this component. Angular updates the URL with
   * `history.pushState`, which fires no `popstate`, and `popstate` is the only thing the embed's
   * router listens to. Without a nudge the address bar moves while the embed carries on rendering
   * the previous page, and only a reload resolves it.
   *
   * So every host navigation started by a `routerLink` or `router.navigate` (trigger
   * `'imperative'`) re-dispatches `popstate`, which tells the embed's router to re-read the URL.
   * That includes a navigation to a URL the embed was already told about: the embed pushes its own
   * URLs with `pushState`, which Angular never observes, so the host cannot know whether the embed
   * is still showing that URL. The sidebar's Newsletters link followed from inside an edition is
   * exactly that case. Angular still runs it, because the address bar no longer matches its own
   * URL, and it must redraw the list.
   *
   * Navigations triggered by `popstate` are skipped. A real Back or Forward already reached the
   * embed's router through the same event. The synthetic `popstate` dispatched here can only start
   * `popstate`-triggered navigations in Angular, so it can never feed back into another dispatch.
   */
  private watchHostNavigation(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationStart | NavigationEnd => event instanceof NavigationStart || event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          // One slot is enough: a newer navigation cancels the older one, so only the latest start
          // can be followed by a NavigationEnd.
          this.pendingNavigation = { id: event.id, navigationTrigger: event.navigationTrigger };
          return;
        }
        const pending = this.pendingNavigation;
        this.pendingNavigation = null;
        if (pending?.id === event.id && pending.navigationTrigger === 'imperative') {
          this.syncEmbedToHostUrl();
        }
      });
  }

  private syncEmbedToHostUrl(): void {
    if (!this.mountHandle) {
      return;
    }

    const path = window.location.pathname;
    // Leaving the embed's subtree destroys this component, so the router there needs no telling.
    // Anchored on a segment boundary: a bare startsWith would also match a future
    // `/foundation/gwidgets`, whose navigation would then be swallowed here instead of reaching
    // the router. `isGwProxyPath` guards the `/api/gatewaze` mount the same way.
    if (path !== this.routePrefix && !path.startsWith(`${this.routePrefix}/`)) {
      return;
    }

    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }

  /**
   * Handles a path the embed hands back through `navigateHost`.
   *
   * The embed's router registers a catch-all that forwards any path it can't match to the host —
   * but the Angular route for this outlet is itself a `<prefix>/**` wildcard (both mounts), so handing such
   * a path straight to `navigateByUrl` re-enters this component, re-mounts the embed, fails to
   * match again, and ping-pongs forever. The embed compiles in module routes only, with no `/login`
   * among them, so an unauthenticated render hits exactly that loop: `FeatureGuard` renders
   * `<Navigate to="/login">`, which resolves against the basename to `<prefix>/login`.
   *
   * So paths inside the prefix are never forwarded to the router, and each is surfaced as an error
   * rather than silently looping. Paths outside the prefix are genuine host navigation.
   */
  private handleHostNavigation(path: string): void {
    // Anchored on a segment boundary — see resolveGwEmbedRoutePrefix. A bare startsWith would
    // swallow a future `/foundation/gwidgets` here instead of handing it to the router.
    const pathOnly = path.split('?')[0];
    if (pathOnly !== this.routePrefix && !pathOnly.startsWith(`${this.routePrefix}/`)) {
      void this.router.navigateByUrl(path);
      return;
    }

    const remainder = pathOnly.slice(this.routePrefix.length).replace(/\/$/, '');
    if (remainder === GW_EMBED_LOGIN_PATH) {
      // The server holds the Gatewaze session, so there is no sign-in for the host to start. A 401
      // from /session/me, or a session still lost after the embed's own bounded reloads, ends here.
      // A dead LFX session is LFX's own auth guard's job, so arriving here is a fault to show.
      console.warn('[GwModuleOutlet] The embed asked for sign-in, but the Gatewaze session is held by the server');
      this.mountError.set('Your Gatewaze session could not be started. Reload the page to try again.');
      return;
    }

    this.mountError.set(`The embedded admin module asked to open "${path}", which has no route.`);
  }

  /**
   * Renders an embed notification as an LFX toast.
   *
   * The embed's modules call sonner's `toast()`; the embed build routes those here rather than
   * mounting a second toast stack in a different corner of the screen. This is the whole reason
   * the host passes `notify` — see the embed's sonner bridge.
   *
   * `id` is carried by the contract for in-place replacement, which PrimeNG's MessageService has
   * no API for. A "loading" toast followed by its result therefore shows as two toasts rather than
   * one that mutates; the durations keep the first out of the way.
   */
  private showHostToast(notification: GwEmbedNotification): void {
    const mapped = GW_EMBED_NOTIFICATION_SEVERITY[notification.level] ?? GW_EMBED_NOTIFICATION_SEVERITY.info;

    this.messageService.add({
      severity: mapped.severity,
      summary: mapped.summary,
      detail: notification.description ? `${notification.message} — ${notification.description}` : notification.message,
      life: notification.durationMs ?? GW_EMBED_NOTIFICATION_DEFAULT_LIFE_MS,
    });
  }

  /**
   * The dynamic import of the loader, as a property so the spec can stand it in: the unit-test
   * builder bundles the dependency, so `vi.mock('@gatewaze/admin-embed')` cannot intercept it.
   */
  private loadEmbedLoader = (): Promise<typeof import('@gatewaze/admin-embed')> => import('@gatewaze/admin-embed');

  private onFatal(err: GwEmbedFatalError): void {
    // A Gatewaze deployment whose bundle predates host-session mode. The loader has already refused
    // to mount, because that bundle would ignore `session` and keep its own token in localStorage.
    // Checked before `recoverable` so this always fails closed, and logged as an error because only
    // a Gatewaze deployment fixes it.
    if (err.code === GW_EMBED_CAPABILITY_MISSING_CODE) {
      console.error('[GwModuleOutlet] The Gatewaze deployment does not support host-session mode; refusing to mount', err);
      this.mountError.set('The embedded admin module needs a newer Gatewaze deployment before it can load here.');
      return;
    }

    // A recoverable fatal is one the embed handled and kept running through, so blanking it behind
    // an error panel would hide a live, working module. `hostPanelShowing` sets `display: none` on
    // the mount points, so treating every fatal as terminal made `recoverable` dead weight that
    // invited exactly that bug. Surface it as a toast and leave the embed on screen.
    if (err.recoverable) {
      this.showHostToast({
        // The embed's own notifications carry ids from its mount; this one originates here, so it
        // gets a host-side id built from the error code rather than a fabricated embed id.
        id: `gw-host-fatal-${err.code}`,
        level: 'error',
        message: err.message || 'The embedded admin module reported a problem.',
      });
      return;
    }

    // Terminal.
    this.mountError.set(err.message || 'The embedded admin module failed to load.');
  }
}

/**
 * The hashed file name from the manifest's stylesheet URL — the only part the server route takes.
 * Exported for the spec; the loader guarantees the URL is absolute and on `GW_EMBED_URL`'s origin.
 */
export function resolveGwEmbedStylesheetName(url: string): string {
  return new URL(url).pathname.split('/').pop() ?? '';
}

/**
 * Whether the embed root holds something a user would see: the root has height, and somewhere in
 * it there is non-whitespace text (outside `style`, `script` and `template`) or an element matching
 * `GW_EMBED_PAINTED_CONTENT_SELECTOR`, such as the embed's spinner.
 *
 * A child with height is not enough. The embed renders its providers first, and Radix's root `Theme`
 * among them has `min-height: 100vh` while the route below it still renders nothing, so that test
 * dropped the skeleton onto a blank pane. Exported for the spec.
 */
export function gwEmbedHasPaintedContent(root: HTMLElement): boolean {
  if (root.getBoundingClientRect().height <= 0) {
    return false;
  }
  if (root.querySelector(GW_EMBED_PAINTED_CONTENT_SELECTOR)) {
    return true;
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (node.nodeValue?.trim() && !parent?.closest('style, script, template')) {
      return true;
    }
  }
  return false;
}

/**
 * LFX's CSS spinner ring, as `GwHostContext.loadingIndicator` hands it to the embed: a new element
 * on every call, decorative, since the embed wraps it in its own `role="status"` box with a
 * screen-reader label. The border colours are inline because the embed's own `border-blue-200`
 * rule (Tailwind's blue) wins over LFX's class inside the embed root. Exported for the spec.
 */
export function createGwEmbedLoadingIndicator(doc: Document): HTMLElement {
  const ring = doc.createElement('div');
  ring.className = GW_EMBED_LOADING_INDICATOR_CLASS;
  ring.style.borderColor = lfxColors.blue[200];
  ring.style.borderTopColor = lfxColors.blue[500];
  ring.setAttribute('aria-hidden', 'true');
  return ring;
}

/**
 * The scoped stylesheet's same-origin URL. With the server's key the path is content-addressed
 * (upstream hash in the name, LFX's theme and transform in the key) and served as immutable;
 * without one it falls back to the short-lived, revalidated form. Exported for the spec.
 */
export function buildGwEmbedStylesheetUrl(name: string, key: string): string {
  return key ? `${GW_EMBED_STYLESHEET_ROUTE}/${encodeURIComponent(key)}/${name}` : `${GW_EMBED_STYLESHEET_ROUTE}/${name}`;
}
