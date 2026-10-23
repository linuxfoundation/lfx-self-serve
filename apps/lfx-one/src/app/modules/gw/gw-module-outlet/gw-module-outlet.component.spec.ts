// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { Component, PLATFORM_ID, signal, TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, provideRouter, Router, Event as RouterEvent } from '@angular/router';
import {
  GW_EMBED_CAPABILITY_MISSING_CODE,
  GW_EMBED_FIRST_PAINT_CAPABILITY,
  GW_EMBED_FIRST_PAINT_TIMEOUT_MS,
  GW_EMBED_LOADING_INDICATOR_CLASS,
  lfxColors,
  GW_EMBED_HOST_SESSION_LOGOUT_URL,
  GW_EMBED_HOST_SESSION_ME_URL,
  GW_EMBED_STYLESHEET_ROUTE,
} from '@lfx-one/shared/constants';
import { GwEmbedManifest, GwHostContext, RuntimeConfig } from '@lfx-one/shared/interfaces';
import { EMPTY, filter, Subject } from 'rxjs';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from '../../../shared/services/user.service';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '../../../shared/providers/runtime-config.provider';
import { GwEmbedWarmupService } from '../../../shared/services/gw-embed-warmup.service';
import { buildGwEmbedStylesheetUrl, gwEmbedHasPaintedContent, GwModuleOutletComponent, resolveGwEmbedStylesheetName } from './gw-module-outlet.component';

// The loader is a real npm dependency that the unit-test builder bundles, so it cannot be mocked
// at the module level; the mount path below stands it in through the component's loadEmbedLoader
// seam, with a `ready` promise each test controls.
const loaderMount = vi.fn();

/** Route target for the real-router cases; the outlet under test is created on its own. */
@Component({ selector: 'lfx-gw-empty-route', template: '' })
class EmptyRouteComponent {}

/**
 * These cover the host-side decisions the embed can't make for itself: the host-session context,
 * failing closed when that mode is off, the /login loop-breaker, and the notification bridge. Most
 * cases create the component under a server PLATFORM_ID so `afterNextRender` never fires and no
 * attempt is made to import the embed bundle; the mount cases switch to a browser platform.
 */
describe('GwModuleOutletComponent', () => {
  let fixture: ComponentFixture<GwModuleOutletComponent>;
  let component: GwModuleOutletComponent;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let routerEvents: Subject<RouterEvent>;

  /** Private by design — these are internal decisions, not API, but they're where the risk lives. */
  const callPrivate = <T>(name: string, ...args: unknown[]): T => (component as unknown as Record<string, (...a: unknown[]) => T>)[name](...args);

  beforeEach(() => {
    navigateByUrl = vi.fn();
    add = vi.fn();
    routerEvents = new Subject<RouterEvent>();

    TestBed.configureTestingModule({
      imports: [GwModuleOutletComponent],
      providers: [
        { provide: Router, useValue: { navigateByUrl, events: routerEvents } },
        { provide: MessageService, useValue: { add } },
        // Stubbed rather than real: UserService pulls in HttpClient and a chain of app providers,
        // and all this component asks it for is whether the user is impersonating.
        { provide: UserService, useValue: { user: signal(null), impersonating: signal(false) } },
        // Server platform keeps afterNextRender (and therefore the embed import) out of the test.
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    fixture = TestBed.createComponent(GwModuleOutletComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleHostNavigation', () => {
    it('forwards a path outside the embed prefix to the host router', () => {
      callPrivate('handleHostNavigation', '/project/meetings');

      expect(navigateByUrl).toHaveBeenCalledWith('/project/meetings');
    });

    it('never forwards an in-prefix path to the router, which would re-enter this component', () => {
      callPrivate('handleHostNavigation', '/foundation/gw/nope');

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('surfaces an unmatched in-prefix path as an error instead of looping', () => {
      callPrivate('handleHostNavigation', '/foundation/gw/nope');

      expect(component['mountError']()).toContain('/foundation/gw/nope');
    });

    it('answers a /login bounce with the error panel, since the server holds the session', () => {
      // There is no sign-in for the host to start, so a round trip here could not fix anything.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      callPrivate('handleHostNavigation', '/foundation/gw/login');

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(component['mountError']()).toContain('Reload the page');
      expect(warn).toHaveBeenCalled();
    });

    it('ignores a query string and a trailing slash when matching the login path', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      callPrivate('handleHostNavigation', '/foundation/gw/login/?returnTo=%2Ffoundation%2Fgw');

      expect(component['mountError']()).toContain('Reload the page');
    });
  });

  describe('mount bail-outs while impersonating', () => {
    // Needs a BROWSER platform: the rest of this file runs under a server PLATFORM_ID so the embed
    // import never fires, but that guard is the first thing mountEmbed checks, so these paths are
    // unreachable from it. Safe to do here because the impersonation refusal returns before the
    // dynamic import — nothing tries to resolve @gatewaze/admin-embed.
    let browserComponent: GwModuleOutletComponent;
    let impersonating: ReturnType<typeof signal<boolean>>;

    beforeEach(() => {
      impersonating = signal(true);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [GwModuleOutletComponent],
        providers: [
          { provide: Router, useValue: { navigateByUrl: vi.fn(), events: EMPTY } },
          { provide: MessageService, useValue: { add: vi.fn() } },
          { provide: UserService, useValue: { user: signal(null), impersonating } },
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      browserComponent = TestBed.createComponent(GwModuleOutletComponent).componentInstance;
    });

    const mount = async (): Promise<void> => (browserComponent as unknown as { mountEmbed: () => Promise<void> }).mountEmbed();

    it('refuses to mount, and says why', async () => {
      // The server-side 403 in requireGwEmbedAccess is the real boundary; this avoids a pointless
      // mount and explains it.
      await mount();

      expect(browserComponent['mountError']()).toContain('impersonating');
      expect(browserComponent['mounting']()).toBe(false);
    });
  });

  describe('loading through @gatewaze/admin-embed', () => {
    // Browser platform, like the impersonation block above: this is the one path that reaches the
    // loader. The stand-in's `ready` is a deferred promise so the skeleton can be observed in
    // flight, resolved with a manifest, or resolved with null (the loader's "nothing mounted").
    let browserComponent: GwModuleOutletComponent;
    let browserFixture: ComponentFixture<GwModuleOutletComponent>;
    let warmSession: ReturnType<typeof vi.spyOn>;
    let resolveReady: (manifest: GwEmbedManifest | null) => void;
    let resolveRendered: () => void;
    let innerUnmount: ReturnType<typeof vi.fn>;

    const EMBED_URL = 'https://admin.example.test/embed';
    const MANIFEST: GwEmbedManifest = {
      contract: 1,
      version: '1.3.146',
      entry: 'admin-embed-abc.js',
      stylesheet: 'admin-embed-def.css',
      modules: ['newsletters'],
      builtAt: '',
    };

    const configure = (runtimeConfig: Partial<RuntimeConfig>): void => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [GwModuleOutletComponent],
        providers: [
          { provide: Router, useValue: { navigateByUrl: vi.fn(), events: EMPTY } },
          { provide: MessageService, useValue: { add: vi.fn() } },
          { provide: UserService, useValue: { user: signal(null), impersonating: signal(false) } },
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, {
        ...DEFAULT_RUNTIME_CONFIG,
        gwSupabaseUrl: 'https://data.example.test',
        gwSupabaseAnonKey: 'anon',
        gwEmbedUrl: EMBED_URL,
        gwHostSession: true,
        ...runtimeConfig,
      });
      warmSession = vi.spyOn(TestBed.inject(GwEmbedWarmupService), 'warmSession').mockImplementation(() => undefined);
      browserFixture = TestBed.createComponent(GwModuleOutletComponent);
      browserComponent = browserFixture.componentInstance;
      (browserComponent as unknown as { loadEmbedLoader: () => Promise<unknown> }).loadEmbedLoader = async () => ({ mount: loaderMount });
      // The test DOM does no layout, so nothing ever has height: by default the embed counts as
      // painted at once, and the paint cases below swap in a child-count test of their own.
      setPaintTest(() => true);
    };
    const setPaintTest = (test: (root: HTMLElement) => boolean): void => {
      (browserComponent as unknown as { embedHasPainted: (root: HTMLElement) => boolean }).embedHasPainted = test;
    };
    const embedRootEl = (): HTMLElement => browserFixture.nativeElement.querySelector('#gw-embed-root');

    beforeEach(() => {
      innerUnmount = vi.fn();
      loaderMount.mockReset().mockImplementation(() => ({
        unmount: innerUnmount,
        ready: new Promise<GwEmbedManifest | null>((resolve) => {
          resolveReady = resolve;
        }),
        rendered: new Promise<void>((resolve) => {
          resolveRendered = resolve;
        }),
      }));
      configure({});
    });

    const mount = (): Promise<void> => (browserComponent as unknown as { mountEmbed: () => Promise<void> }).mountEmbed();
    // The loader is reached after the dynamic import, so wait for the call rather than counting
    // microtask ticks.
    const settle = (): Promise<void> => vi.waitFor(() => expect(loaderMount).toHaveBeenCalledTimes(1));

    it('fails closed with the not-configured panel when host-session mode is off, before touching the loader', async () => {
      // Host-session mode is the only mode. With it off every /api/gatewaze call answers 404, so
      // mounting would only show an embed that cannot load anything.
      configure({ gwHostSession: false });
      await mount();
      expect(loaderMount).not.toHaveBeenCalled();
      expect(browserComponent['mountError']()).toContain('not configured');
      expect(browserComponent['mountError']()).toContain('host-session');
      expect(browserComponent['mounting']()).toBe(false);
    });

    it.each([['gwSupabaseUrl'], ['gwSupabaseAnonKey']])('refuses to mount when %s is empty, before touching the loader', async (field) => {
      configure({ [field]: '' });
      await mount();
      expect(loaderMount).not.toHaveBeenCalled();
      expect(browserComponent['mountError']()).toContain('not configured');
    });

    it('refuses to mount when GW_EMBED_URL is unset, before touching the loader', async () => {
      configure({ gwEmbedUrl: '' });
      await mount();
      expect(loaderMount).not.toHaveBeenCalled();
      expect(browserComponent['mountError']()).toContain('GW_EMBED_URL');
    });

    it('hands the loader the embed source and routes the stylesheet through the scoped endpoint', async () => {
      const pending = mount();
      await settle();
      expect(loaderMount).toHaveBeenCalledTimes(1);
      const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
      expect(ctx.source.baseUrl).toBe(EMBED_URL);
      expect(ctx.source.resolveStylesheetUrl?.(`${EMBED_URL}/admin-embed-def.css`)).toBe(`${GW_EMBED_STYLESHEET_ROUTE}/admin-embed-def.css`);
      resolveReady(MANIFEST);
      await pending;
    });

    it("puts the server's stylesheet key in the path, so the URL is content-addressed", async () => {
      configure({ gwEmbedStylesheetKey: 'ownKey0123456789' });
      const pending = mount();
      await settle();
      const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
      expect(ctx.source.resolveStylesheetUrl?.(`${EMBED_URL}/admin-embed-def.css`)).toBe(`${GW_EMBED_STYLESHEET_ROUTE}/ownKey0123456789/admin-embed-def.css`);
      resolveReady(MANIFEST);
      await pending;
    });

    it('starts warming the Gatewaze session as soon as it starts mounting, before the loader', async () => {
      const pending = mount();
      expect(warmSession).toHaveBeenCalledTimes(1);
      expect(loaderMount).not.toHaveBeenCalled();
      await settle();
      resolveReady(MANIFEST);
      await pending;
    });

    it('keeps the skeleton up past the loader reporting the embed mounted, until the embed paints', async () => {
      setPaintTest((root) => root.childElementCount > 0);
      // Rendered for real, so the template bindings can be checked: afterNextRender starts the mount.
      await browserFixture.whenStable();
      await settle();
      // The loader has returned, but nothing is on screen yet.
      expect(browserComponent['mounting']()).toBe(true);
      expect(browserComponent['mountError']()).toBeNull();

      // Mounted, but React has drawn nothing yet: this is the gap that used to show a blank pane.
      resolveReady(MANIFEST);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(browserComponent['mounting']()).toBe(true);
      expect(embedRootEl().style.visibility).toBe('hidden');

      // The embed's first paint may be its own spinner; that is enough to hand over to.
      const spinner = document.createElement('div');
      spinner.className = 'gw-spinner';
      embedRootEl().appendChild(spinner);
      // Microtasks only, no timer: the browser renders no frame in between, so the swap below is
      // already in the DOM for the frame the spinner first paints in. Waiting on Angular's own
      // scheduled change detection would need a timer here, and could show a blank frame.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      expect(browserComponent['mounting']()).toBe(false);
      expect(browserComponent['mountError']()).toBeNull();
      expect(browserFixture.nativeElement.querySelector('[data-testid="gw-embed-loading"]')).toBeNull();
      expect(embedRootEl().style.visibility).toBe('');
    });

    it('shows the embed anyway once the first-paint wait runs out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        setPaintTest(() => false);
        const pending = mount();
        await vi.waitFor(() => expect(loaderMount).toHaveBeenCalledTimes(1));
        resolveReady(MANIFEST);
        await vi.advanceTimersByTimeAsync(GW_EMBED_FIRST_PAINT_TIMEOUT_MS - 1);
        expect(browserComponent['mounting']()).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(browserComponent['mounting']()).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('painted nothing'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops the skeleton at once when a terminal error arrives while waiting for the first paint', async () => {
      setPaintTest(() => false);
      await browserFixture.whenStable();
      await settle();
      resolveReady(MANIFEST);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(browserComponent['mounting']()).toBe(true);

      const onFatal = (loaderMount.mock.calls[0][1] as GwHostContext).onFatal;
      onFatal?.({ error_type: 'render_crash', code: 'GW_RENDER_CRASH', message: 'The embed crashed.', recoverable: false });
      await browserFixture.whenStable();

      // Well inside the 10s paint cap: the error panel ended the wait, not the timeout.
      await vi.waitFor(() => expect(browserComponent['mounting']()).toBe(false), { timeout: 1000 });
      expect(browserFixture.nativeElement.querySelector('[data-testid="gw-embed-loading"]')).toBeNull();
      expect(browserFixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('The embed crashed.');
    });

    describe("a bundle with the 'first-paint' capability", () => {
      const FIRST_PAINT_MANIFEST: GwEmbedManifest = { ...MANIFEST, capabilities: ['host-session', GW_EMBED_FIRST_PAINT_CAPABILITY] };

      it("keeps the skeleton up until the loader's rendered resolves, not the outlet's own paint check", async () => {
        // The paint check would pass at once; with the capability it is not consulted.
        const paintTest = vi.fn(() => true);
        setPaintTest(paintTest);
        await browserFixture.whenStable();
        await settle();

        resolveReady(FIRST_PAINT_MANIFEST);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(browserComponent['mounting']()).toBe(true);
        expect(paintTest).not.toHaveBeenCalled();

        resolveRendered();
        for (let i = 0; i < 10; i++) {
          await Promise.resolve();
        }
        // Swapped in the microtasks after rendered, as with the paint check.
        expect(browserComponent['mounting']()).toBe(false);
        expect(browserFixture.nativeElement.querySelector('[data-testid="gw-embed-loading"]')).toBeNull();
        expect(embedRootEl().style.visibility).toBe('');
      });

      it('drops the skeleton at once when the error panel goes up before rendered resolves', async () => {
        await browserFixture.whenStable();
        await settle();
        resolveReady(FIRST_PAINT_MANIFEST);
        await new Promise((resolve) => setTimeout(resolve, 0));

        (loaderMount.mock.calls[0][1] as GwHostContext).onFatal?.({
          error_type: 'render_crash',
          code: 'GW_RENDER_CRASH',
          message: 'The embed crashed.',
          recoverable: false,
        });
        await browserFixture.whenStable();

        await vi.waitFor(() => expect(browserComponent['mounting']()).toBe(false), { timeout: 1000 });
      });
    });

    it("uses the outlet's paint check for a bundle without the 'first-paint' capability, whose rendered resolves too early", async () => {
      setPaintTest((root) => root.childElementCount > 0);
      await browserFixture.whenStable();
      await settle();
      resolveReady(MANIFEST);
      // An older loader resolves rendered with ready; that must not drop the skeleton.
      resolveRendered();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(browserComponent['mounting']()).toBe(true);

      embedRootEl().appendChild(document.createElement('div'));
      await vi.waitFor(() => expect(browserComponent['mounting']()).toBe(false));
    });

    it("hands the embed LFX's spinner as the loading indicator, a new decorative element per call", async () => {
      const pending = mount();
      await settle();
      const factory = (loaderMount.mock.calls[0][1] as GwHostContext).loadingIndicator;

      const first = factory?.();
      const second = factory?.();

      // A CSS ring, not a Font Awesome icon: the kit is deferred and an unloaded icon draws nothing.
      expect(first?.tagName).toBe('DIV');
      expect(first?.className).toBe(GW_EMBED_LOADING_INDICATOR_CLASS);
      expect(first?.className).not.toContain('fa-');
      expect(first?.getAttribute('aria-hidden')).toBe('true');
      // Inline, so LFX's blues win over the embed's own border-blue-200 inside its root.
      expect(first?.style.borderRightColor).toBe(hexToRgb(lfxColors.blue[200]));
      expect(first?.style.borderBottomColor).toBe(hexToRgb(lfxColors.blue[200]));
      expect(first?.style.borderLeftColor).toBe(hexToRgb(lfxColors.blue[200]));
      expect(first?.style.borderTopColor).toBe(hexToRgb(lfxColors.blue[500]));
      expect(second).not.toBe(first);
      resolveReady(MANIFEST);
      await pending;
    });

    it('stops waiting for the first paint when the outlet is torn down', async () => {
      setPaintTest(() => false);
      const pending = mount();
      await settle();
      resolveReady(MANIFEST);
      await new Promise((resolve) => setTimeout(resolve, 0));
      browserFixture.destroy();
      await expect(pending).resolves.toBeUndefined();
    });

    it('treats a null ready result as terminal and shows the error panel', async () => {
      const pending = mount();
      await settle();
      resolveReady(null);
      await pending;
      expect(browserComponent['mounting']()).toBe(false);
      expect(browserComponent['mountError']()).toContain('could not be loaded');
    });

    it('does not raise the error panel when teardown cancelled the mount', async () => {
      const pending = mount();
      await settle();
      (browserComponent as unknown as { destroyed: boolean }).destroyed = true;
      resolveReady(null);
      await pending;
      expect(browserComponent['mountError']()).toBeNull();
    });

    describe('host-session context', () => {
      it('hands the loader the host-session context: proxies on this origin, the real URL as publicUrl', async () => {
        const pending = mount();
        await settle();
        const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
        expect(ctx.session).toEqual({ mode: 'host', meUrl: GW_EMBED_HOST_SESSION_ME_URL, logoutUrl: GW_EMBED_HOST_SESSION_LOGOUT_URL });
        expect(ctx.supabase).toEqual({
          url: `${window.location.origin}/api/gatewaze/supabase`,
          anonKey: 'anon',
          publicUrl: 'https://data.example.test',
        });
        // The embed calls `${apiBaseUrl}/api/...`, so this lands on the /api/gatewaze/api proxy.
        expect(ctx.apiBaseUrl).toBe('/api/gatewaze');
        expect(ctx.source.baseUrl).toBe(EMBED_URL);
        resolveReady(MANIFEST);
        await pending;
      });

      it('passes no sign-in entry point and no storage key, so the embed keeps no token in the browser', async () => {
        // The host must never send these embed fields: with them set, an embed would hold its own
        // session in localStorage.
        const pending = mount();
        await settle();
        const ctx = loaderMount.mock.calls[0][1] as unknown as Record<string, unknown>;
        expect(ctx['signIn']).toBeUndefined();
        expect(ctx['storageKeySuffix']).toBeUndefined();
        resolveReady(MANIFEST);
        await pending;
      });

      it('fails closed with the error panel, and logs it, when the deployment lacks the host-session capability', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const pending = mount();
        await settle();
        const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
        const fatal = {
          error_type: 'import_failed' as const,
          code: GW_EMBED_CAPABILITY_MISSING_CODE,
          message: 'The hosted embed (1.3.100) does not support host-session mode. Upgrade the Gatewaze deployment.',
          recoverable: false,
        };
        ctx.onFatal?.(fatal);
        resolveReady(null);
        await pending;

        expect(browserComponent['mountError']()).toContain('newer Gatewaze deployment');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('host-session'), fatal);
      });

      it('fails closed on a capability-missing fatal even if it were marked recoverable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const pending = mount();
        await settle();
        const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
        ctx.onFatal?.({ error_type: 'import_failed', code: GW_EMBED_CAPABILITY_MISSING_CODE, message: 'missing', recoverable: true });
        resolveReady(null);
        await pending;

        expect(browserComponent['mountError']()).toContain('newer Gatewaze deployment');
      });
    });

    it('leaves a panel that onFatal already raised in place', async () => {
      const pending = mount();
      await settle();
      const ctx = loaderMount.mock.calls[0][1] as GwHostContext;
      ctx.onFatal?.({ error_type: 'import_failed', code: 'gw_embed_contract_mismatch', message: 'Upgrade the loader.', recoverable: false });
      resolveReady(null);
      await pending;
      expect(browserComponent['mountError']()).toBe('Upgrade the loader.');
    });
  });

  describe('syncEmbedToHostUrl', () => {
    // Re-dispatches popstate so the embed's own router follows a host navigation. Whether it fires
    // is decided by what started the navigation, not by comparing URLs: the embed's own pushState
    // calls are invisible to the host, so a remembered URL goes stale and swallowed the sidebar
    // link back to it. Skipping popstate-triggered navigations is what keeps our own dispatch from
    // looping, so both sides of that rule are asserted through the router events.
    let dispatched: number;
    let onPopState: () => void;
    let nextId: number;

    beforeEach(() => {
      dispatched = 0;
      nextId = 1;
      onPopState = (): void => {
        dispatched += 1;
      };
      window.addEventListener('popstate', onPopState);
      // The guard returns early without a mount handle, which would make every case below vacuous.
      (component as unknown as { mountHandle: unknown }).mountHandle = { unmount: vi.fn() };
      callPrivate('watchHostNavigation');
    });

    afterEach(() => {
      window.removeEventListener('popstate', onPopState);
      window.history.replaceState(window.history.state, '', '/');
    });

    const at = (path: string): void => window.history.replaceState(window.history.state, '', path);

    /** Runs one host navigation through the router events, landing the address bar on `path`. */
    const navigate = (path: string, trigger: NavigationStart['navigationTrigger']): void => {
      const id = nextId++;
      routerEvents.next(new NavigationStart(id, path, trigger));
      at(path);
      routerEvents.next(new NavigationEnd(id, path, path));
    };

    it('redraws the embed when a host link returns to the mount URL after the embed moved on its own', () => {
      // The reported shape: the host showed the list, the embed pushed an edition URL itself, then
      // the sidebar's Newsletters link navigated back to the list.
      navigate('/foundation/gw/newsletters', 'imperative');
      dispatched = 0;
      window.history.pushState(window.history.state, '', '/foundation/gw/newsletters/editions/abc');

      navigate('/foundation/gw/newsletters', 'imperative');

      expect(dispatched).toBe(1);
    });

    it('dispatches nothing for a popstate-triggered navigation', () => {
      // Back/Forward already reached the embed's router, and our own dispatch produces exactly
      // this kind of navigation, so answering it would loop.
      navigate('/foundation/gw/newsletters', 'popstate');

      expect(dispatched).toBe(0);
    });

    it('dispatches on every imperative navigation, even to the same URL twice', () => {
      navigate('/foundation/gw/newsletters', 'imperative');
      navigate('/foundation/gw/newsletters', 'imperative');

      expect(dispatched).toBe(2);
    });

    it('stays out of a path that merely shares the prefix as a string', () => {
      // A bare startsWith would swallow this navigation instead of letting the router have it.
      at('/foundation/gwidgets');

      callPrivate('syncEmbedToHostUrl');

      expect(dispatched).toBe(0);
    });

    it('does nothing before the embed has mounted', () => {
      (component as unknown as { mountHandle: unknown }).mountHandle = null;
      at('/foundation/gw/newsletters');

      callPrivate('syncEmbedToHostUrl');

      expect(dispatched).toBe(0);
    });

    describe('against the real Angular router', () => {
      // The cases above feed router events by hand, so they cannot show that Angular runs a host
      // link back to its own last URL once the embed has moved the address bar. The fix depends on
      // that, and the doc this replaced said the opposite, so it is pinned against the real router.
      let router: Router;

      /** Lets Angular's setTimeout-wrapped popstate handling run, so a loop would show up here. */
      const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

      beforeEach(async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          imports: [GwModuleOutletComponent],
          providers: [
            provideRouter([{ path: '**', component: EmptyRouteComponent }]),
            // The real address bar, so the embed-side pushState below is visible to Angular.
            { provide: PlatformLocation, useClass: BrowserPlatformLocation },
            { provide: MessageService, useValue: { add: vi.fn() } },
            { provide: UserService, useValue: { user: signal(null), impersonating: signal(false) } },
            { provide: PLATFORM_ID, useValue: 'server' },
          ],
        });
        component = TestBed.createComponent(GwModuleOutletComponent).componentInstance;
        (component as unknown as { mountHandle: unknown }).mountHandle = { unmount: vi.fn() };
        router = TestBed.inject(Router);
        // Starts Angular's own popstate listener, which our synthetic dispatch also reaches.
        router.initialNavigation();
        callPrivate('watchHostNavigation');
        await router.navigateByUrl('/foundation/gw/newsletters');
        await flush();
        dispatched = 0;
      });

      it('runs a host link back to the list after the embed moved, and redraws the embed once', async () => {
        window.history.pushState(window.history.state, '', '/foundation/gw/newsletters/editions/abc');
        const ends: string[] = [];
        router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => ends.push(event.urlAfterRedirects));

        await router.navigateByUrl('/foundation/gw/newsletters');
        await flush();

        expect(ends).toEqual(['/foundation/gw/newsletters']);
        expect(window.location.pathname).toBe('/foundation/gw/newsletters');
        expect(dispatched).toBe(1);
      });
    });
  });

  describe('onFatal', () => {
    // Rewritten twice in response to review and previously untested, so deleting either change
    // left the whole suite green.
    it('routes a recoverable fatal to a toast and leaves the embed on screen', () => {
      // hostPanelShowing sets display:none on the mount points, so treating every fatal as
      // terminal would blank a live, working embed behind a stale error panel.
      callPrivate('onFatal', { error_type: 'render_crash', code: 'GW_X', message: 'transient', recoverable: true });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: expect.any(String) }));
      expect(component['mountError']()).toBeNull();
      expect(component['hostPanelShowing']()).toBe(false);
    });

    it('shows the error panel for a terminal fatal', () => {
      callPrivate('onFatal', { error_type: 'import_failed', code: 'GW_Y', message: 'gone', recoverable: false });

      expect(component['mountError']()).toBe('gone');
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    // `mounting` is template-bound and its `finally` reset is the only thing that clears the
    // skeleton, so an early return added outside that try would strand it with nothing to catch it.
    const loadingEl = (): Element | null => fixture.nativeElement.querySelector('[data-testid="gw-embed-loading"]');

    it('renders nothing while idle', async () => {
      await fixture.whenStable();

      expect(loadingEl()).toBeNull();
    });

    it('shows a skeleton while the embed bundle is being fetched', async () => {
      component['mounting'].set(true);
      await fixture.whenStable();

      expect(loadingEl()).not.toBeNull();
    });

    it('clears the skeleton once mounting settles', async () => {
      component['mounting'].set(true);
      await fixture.whenStable();
      component['mounting'].set(false);
      await fixture.whenStable();

      expect(loadingEl()).toBeNull();
    });

    it('keeps the embed mount points present throughout, so their refs stay stable', async () => {
      component['mounting'].set(true);
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('#gw-embed-root')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('#gw-embed-portals')).not.toBeNull();
    });
  });

  describe('showHostToast', () => {
    it('renders an embed notification through LFX toasts rather than the embed toaster', () => {
      callPrivate('showHostToast', { level: 'success', message: 'Edition duplicated', id: 'a' });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Success', detail: 'Edition duplicated' }));
    });

    it("maps the embed's 'warning' onto PrimeNG's 'warn'", () => {
      callPrivate('showHostToast', { level: 'warning', message: 'Careful', id: 'b' });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it('appends a description when the embed supplies one', () => {
      callPrivate('showHostToast', { level: 'error', message: 'Publish failed', description: 'upstream 500', id: 'c' });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Publish failed — upstream 500' }));
    });

    it('honours a requested duration', () => {
      callPrivate('showHostToast', { level: 'info', message: 'Working', id: 'd', durationMs: 12000 });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ life: 12000 }));
    });

    it('falls back to info for a level it does not recognise', () => {
      callPrivate('showHostToast', { level: 'nonsense', message: 'Hmm', id: 'e' });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
    });
  });
});

/** How the test DOM serialises an inline hex colour. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('gwEmbedHasPaintedContent', () => {
  // The real predicate, with layout stood in: the test DOM gives every element a zero-size rect.
  const rootWith = (html: string, height = 900): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
    return root;
  };

  it("does not count the embed's empty provider wrappers, even with height", () => {
    // What the embed renders while FeatureGuard is still loading: Radix's root Theme (min-height
    // 100vh in the scoped stylesheet) around an empty router, plus an empty toaster region.
    const root = rootWith('<div class="radix-themes" data-is-root-theme="true"><section aria-label="Notifications" tabindex="-1"></section></div>');

    expect(gwEmbedHasPaintedContent(root)).toBe(false);
  });

  it("counts the embed's spinner, which has no visible text", () => {
    const root = rootWith(
      '<div class="radix-themes" data-is-root-theme="true"><div class="flex justify-center py-16" role="status"><div class="animate-spin"></div></div></div>'
    );

    expect(gwEmbedHasPaintedContent(root)).toBe(true);
  });

  it('counts routed content by its text', () => {
    expect(gwEmbedHasPaintedContent(rootWith('<div class="radix-themes"><main><h1>Newsletters</h1></main></div>'))).toBe(true);
  });

  it('ignores text inside style, script and template elements', () => {
    expect(gwEmbedHasPaintedContent(rootWith('<div><style>.a{color:red}</style><template><p>later</p></template></div>'))).toBe(false);
  });

  it('counts nothing while the root has no height', () => {
    expect(gwEmbedHasPaintedContent(rootWith('<h1>Newsletters</h1>', 0))).toBe(false);
  });
});

describe('buildGwEmbedStylesheetUrl', () => {
  it('puts the key between the route and the name when there is one', () => {
    expect(buildGwEmbedStylesheetUrl('admin-embed-def.css', 'ownKey0123456789')).toBe(`${GW_EMBED_STYLESHEET_ROUTE}/ownKey0123456789/admin-embed-def.css`);
  });

  it('falls back to the unkeyed form without one', () => {
    expect(buildGwEmbedStylesheetUrl('admin-embed-def.css', '')).toBe(`${GW_EMBED_STYLESHEET_ROUTE}/admin-embed-def.css`);
  });
});

describe('resolveGwEmbedStylesheetName', () => {
  // The loader hands over the manifest's absolute stylesheet URL; only the hashed file name is
  // sent to GW_EMBED_STYLESHEET_ROUTE, so the server never sees a path it did not construct itself.
  it('keeps only the hashed file name', () => {
    expect(resolveGwEmbedStylesheetName('https://admin.example.test/embed/admin-embed-C7yXdkZR.css')).toBe('admin-embed-C7yXdkZR.css');
    expect(resolveGwEmbedStylesheetName('https://admin.example.test/embed/admin-embed-C7yXdkZR.css?x=1#y')).toBe('admin-embed-C7yXdkZR.css');
  });
});
