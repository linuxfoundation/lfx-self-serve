// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, TransferState, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  GW_EMBED_DEFAULT_API_BASE_URL,
  GW_EMBED_ENABLED_FEATURES,
  GW_EMBED_ENABLED_MODULE_IDS,
  GW_EMBED_LANDING_PATH,
  GW_EMBED_LOGIN_PATH,
  GW_EMBED_DEFAULT_SESSION_TTL_S,
  GW_EMBED_NOTIFICATION_DEFAULT_LIFE_MS,
  GW_EMBED_NOTIFICATION_SEVERITY,
  GW_EMBED_ADOPTION_TIMEOUT_MS,
  GW_EMBED_AUTO_SIGNIN_KEY,
  GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS,
  GW_EMBED_SESSION_RECOVERY_KEY,
  GW_EMBED_SIGNIN_STATE_KEY,
  GW_EMBED_SIGNIN_STATE_PARAM,
  GW_EMBED_SESSION_RECOVERY_COOLDOWN_MS,
  GW_EMBED_STORAGE_KEY_PREFIX,
  GW_EMBED_STYLESHEET_PATH,
} from '@lfx-one/shared/constants';
import { buildGwEmbedStorageSuffix, hasAuthFragment, resolveGwEmbedRoutePrefix } from '@lfx-one/shared/utils';
import { GwEmbedFatalError, GwEmbedMountHandle, GwEmbedNotification, GwHostContext, GwRuntimeConfig } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';

import { UserService } from '../../../shared/services/user.service';

import { getRuntimeConfig } from '../../../shared/providers/runtime-config.provider';

/**
 * Writes the embed's runtime-config global. Kept as a narrow function so this global has exactly one write site; its shape is declared
 * ambiently in `src/types/gw-embed.d.ts`, so no cast is involved.
 */
function setGwRuntimeConfig(config: GwRuntimeConfig): void {
  globalThis.__GATEWAZE_CONFIG__ = config;
}

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
 * `@gatewaze/admin-embed` is built in the separate `gatewaze` repo (`packages/admin`'s embed Vite
 * config) and published to npm; this app takes it as a pinned dependency. The dynamic import is
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

  // viewChild mount points — both are unconditional siblings in the template so they exist in the
  // DOM (and are stable references) before the embed ever mounts.
  protected readonly embedRoot = viewChild.required<ElementRef<HTMLDivElement>>('embedRoot');
  protected readonly embedPortals = viewChild.required<ElementRef<HTMLDivElement>>('embedPortals');

  // 5. WritableSignals
  protected readonly mountError = signal<string | null>(null);
  protected readonly signInRequired = signal(false);

  /**
   * True from the first BROWSER render until the embed has mounted or failed — never during SSR.
   *
   * `mountEmbed` runs from `afterNextRender` and returns early off-browser, so the server-rendered
   * HTML carries the mount points and no skeleton.
   *
   * Template-bound: the embed is a large React bundle fetched on demand, so without this the user
   * watches an empty container for as long as the import takes.
   */
  protected readonly mounting = signal(false);

  /**
   * True while the host is showing a panel of its own instead of the embed.
   *
   * Drives collapsing the mount points: an embed sitting at a dead end still occupies full height
   * while rendering nothing, which pushed the sign-in panel off-screen entirely.
   */
  protected readonly hostPanelShowing = computed(() => this.signInRequired() || this.mountError() !== null);

  // Plain (non-signal) mount bookkeeping — not template-bound, so no need for reactivity here.
  private destroyed = false;
  private mountHandle: GwEmbedMountHandle | null = null;
  /** Last URL the embed's router has been told about — see syncEmbedToHostUrl. */
  private lastSyncedUrl: string | null = null;
  /** Which mount path this instance is serving; see resolveGwEmbedRoutePrefix. */
  private routePrefix: string = resolveGwEmbedRoutePrefix('');

  /**
   * The embed's `localStorage` key, scoped to the signed-in LFX identity.
   *
   * A computed rather than a field: `userService.user()` is populated from TransferState during
   * bootstrap, so a value read in the field initializer can predate it. Every read and write of
   * the stored session goes through this, so the three call sites cannot drift apart.
   *
   * See `buildGwEmbedStorageSuffix` for why the scoping matters — briefly, the key used to be
   * browser-wide, so the next LFX user on a shared browser inherited the previous one's Gatewaze
   * session and acted as them.
   */
  private readonly sessionStorageKey = computed(() => `${GW_EMBED_STORAGE_KEY_PREFIX}${buildGwEmbedStorageSuffix(this.userService.user()?.sub)}`);

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
   * Starts the LFID flow, returning to whatever embed page the user is on (either mount — the
   * return URL is built from `this.routePrefix`, not a fixed prefix).
   *
   * Reached automatically on the first /login bounce, and from the manual panel after that. A user
   * who is already signed in to LFX must never be asked to sign in a second time — the embed is
   * inside LFX, so a second login prompt reads as a bug regardless of how the tokens actually work.
   *
   * The automatic path is what makes the loop risk real: the embed asks the host to navigate to
   * `/login` on every unauthenticated render, so an unguarded auto-redirect spins the user through
   * Auth0 forever whenever sign-in doesn't stick. `claimAutoSignInAttempt()` is the bound — a
   * per-session ceiling, after which this falls through to the manual panel and stays there.
   */
  protected startSignIn(): void {
    const lfidStartUrl = getRuntimeConfig(this.transferState).gwLfidStartUrl;
    if (!lfidStartUrl) {
      this.showErrorPanel('Gatewaze sign-in is not configured (GW_LFID_START_URL is unset).');
      return;
    }

    // Never return to the login path: the embed sent the user there *because* they were
    // unauthenticated, and it has no route for it — returning would land them back on the same dead
    // end holding a session they can't use. Any other in-prefix page is a fine place to come back to.
    const loginUrl = `${this.routePrefix}${GW_EMBED_LOGIN_PATH}`;
    const onLoginDeadEnd = window.location.pathname.replace(/\/$/, '') === loginUrl;
    // Built without the fragment: `returnUrl` is handed to a third-party service as a query
    // parameter, and if an adoption attempt failed the fragment may still hold access and refresh
    // tokens — which would then land in that service's access log.
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = '';
    const returnUrl = onLoginDeadEnd ? this.buildLandingUrl() : currentUrl.toString();

    // Bind this sign-in to this browser. The nonce goes out on the return URL and is required
    // back before any token from the returned fragment is adopted — without it, anyone who can get
    // the user to open a link can hand them a Supabase session (see adoptAuthFragment).
    const state = crypto.randomUUID();
    try {
      window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, state);
    } catch {
      // Storage unavailable: continue without it. adoptAuthFragment fails closed, so the worst
      // case is that sign-in does not complete — never that an unverified token is adopted.
    }

    const returnWithState = new URL(returnUrl);
    returnWithState.searchParams.set(GW_EMBED_SIGNIN_STATE_PARAM, state);

    const separator = lfidStartUrl.includes('?') ? '&' : '?';
    window.location.assign(`${lfidStartUrl}${separator}return_url=${encodeURIComponent(returnWithState.toString())}`);
  }

  // 10. Private initializer
  private async mountEmbed(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Refuse to mount while impersonating, because the two halves of this route cannot agree on
    // who the caller is. `requireGwEmbedAccess` authorizes the IMPERSONATED target (it reads
    // `req.bearerToken`, which carries the impersonation token), while the embed sends its own
    // Supabase bearer for whoever signed in to Gatewaze in this browser — the real user. So a
    // write could execute as the impersonator while the LFX chrome and the permission check both
    // say it is the target, and Gatewaze's audit trail would name the wrong account.
    //
    // Blocked rather than reconciled: making the two agree means minting a Gatewaze session for
    // the target, which is a far larger decision than a pilot should take unilaterally — it would
    // let support staff act as a user inside a system that has its own identity model. Failing
    // closed costs an impersonating admin one unavailable module and nothing else.
    if (this.userService.impersonating()) {
      // Cleared here too: the user may have arrived on the LFID return leg, and bailing out with
      // the fragment intact leaves access and refresh tokens in the address bar and in history.
      this.clearAuthFragment();
      this.showErrorPanel('The newsletters module is unavailable while impersonating another user.');
      return;
    }

    // The embed itself is documented to guard against being mounted twice into the same node, but
    // we still guard here so a second `afterNextRender` firing (or any future re-entrant caller)
    // can't kick off a redundant import + mount while one is already in flight or done.
    if (this.mounting() || this.mountHandle) {
      return;
    }
    this.mounting.set(true);

    try {
      const runtimeConfig = getRuntimeConfig(this.transferState);

      // Fail at the boundary rather than inside the embed. Both values default to '' when their
      // env vars are unset, and an empty Supabase URL produces an opaque failure several layers
      // down — this is also the behaviour RuntimeConfig's own doc comment promises.
      if (!runtimeConfig.gwSupabaseUrl || !runtimeConfig.gwSupabaseAnonKey) {
        // This return precedes `adoptAuthFragment`, which is normally what strips the fragment. If
        // configuration went missing during the LFID round trip, the tokens would otherwise sit in
        // the address bar and in session history indefinitely — surviving every later navigation,
        // for a failure the user can do nothing about. Clearing costs nothing: adoption cannot
        // succeed on this path anyway.
        this.clearAuthFragment();
        this.showErrorPanel('The embedded admin module is not configured (GW_SUPABASE_URL / GW_SUPABASE_ANON_KEY are unset).');
        return;
      }
      // Resolved rather than fixed: the embed is mounted from both the Foundation Lens and the
      // Project Lens, and the basename must match the path the user actually arrived on.
      this.routePrefix = resolveGwEmbedRoutePrefix(window.location.pathname);

      const ctx: GwHostContext = {
        basename: this.routePrefix,
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
          returnUrl: this.buildEmbedReturnUrl(),
        },
        storageKeySuffix: buildGwEmbedStorageSuffix(this.userService.user()?.sub),
        portalContainer: this.embedPortals().nativeElement,
        notify: (notification) => this.showHostToast(notification),
        onFatal: (err) => this.onFatal(err),
        navigateHost: (path) => this.handleHostNavigation(path),
      };

      // The embed's stylesheet is emitted as a separate file by its library build
      // (`cssCodeSplit: false`), so importing the JS chunk pulls in no styles — the host has to
      // load the CSS itself. Injected before the import so the styles are in flight alongside the
      // (much larger) chunk rather than after it.
      this.ensureStylesheet();

      // Consume the LFID auth fragment before the embed mounts (see adoptAuthFragment).
      await this.adoptAuthFragment(ctx.supabase.url, ctx.supabase.anonKey);
      if (this.destroyed) {
        return;
      }

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
      // away from the embed) — don't mount into a host node that's about to be removed.
      if (this.destroyed) {
        return;
      }

      this.mountHandle = mod.mount(this.embedRoot().nativeElement, ctx);
      this.lastSyncedUrl = `${window.location.pathname}${window.location.search}`;
      this.watchHostNavigation();
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
    }
  }

  /**
   * Turns the LFID auth fragment into a stored Supabase session, before the embed mounts.
   *
   * **This is a workaround for an embed bug and should be deleted when that is fixed.** The embed
   * configures supabase-js with `detectSessionInUrl`, which would normally do this itself — but its
   * client is lazy (a `Proxy` in the embed's `supabase.ts`) and is only constructed when
   * `AuthProvider`'s effect calls `getSession()`. Its router's catch-all route sits OUTSIDE the auth
   * boundary, so on any path the embed can't match — `/login`, which is exactly where its
   * `FeatureGuard` sends an unauthenticated user — the catch-all's effect runs first (React runs
   * child effects before parent effects) and hands navigation back to the host before the client
   * exists. The tokens are then lost with the navigation, so sign-in can never complete: the round
   * trip mints a session server-side every time and the browser never keeps it.
   *
   * Writing the session here removes the race entirely — by the time the embed mounts, the session
   * is already in the storage key it reads.
   *
   * Best-effort in the sense that a failure never blocks the mount — the embed still gets its
   * chance, and falls back to its own sign-in path.
   *
   * It does NOT leave the fragment alone on failure, which an earlier version of this sentence
   * claimed. The fragment is cleared once the nonce is consumed and before the identity lookup, so
   * every exit after that point — refusal, network failure, abort — leaves nothing on the URL.
   * That is deliberate: the nonce is single-use, so a fragment surviving a failure could not be
   * adopted by a retry anyway, and leaving live tokens in the address bar is the hazard the
   * clearing exists to remove.
   */
  private async adoptAuthFragment(supabaseUrl: string, anonKey: string): Promise<void> {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    if (!hash || !supabaseUrl || !anonKey) {
      return;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) {
      // A HALF fragment still carries a credential. An errored or truncated callback can arrive
      // with one of the pair, which cannot be adopted but is just as readable by later script and
      // just as easy to copy out of the address bar — so returning quietly left a live token on
      // the URL precisely when something had already gone wrong.
      //
      // Conditional, because this branch also catches a fragment that is not ours at all: a plain
      // `#section` anchor must survive, and clearing unconditionally would break in-page links.
      //
      // Tested with `hasAuthFragment`, not with the two tokens read above. The shared contract
      // (`AUTH_FRAGMENT_KEYS`) classifies five keys as credential material — `id_token`,
      // `provider_token` and `provider_refresh_token` as well — and checking only the pair this
      // function needs left a malformed callback carrying one of the other three sitting in the
      // address bar and in history, readable by any later same-origin script. The same list is
      // what the RUM redaction uses, so the two cannot disagree about what counts as a credential.
      if (hasAuthFragment(window.location.hash)) {
        this.clearAuthFragment();
      }
      return;
    }

    // The fragment is only trusted if it came back from a sign-in THIS browser started. Without
    // this, a crafted link carrying the attacker's own (perfectly valid) Supabase tokens would be
    // adopted verbatim, and the victim would compose newsletters and upload media into the
    // attacker's tenant while appearing signed in to LFX — login CSRF / session fixation. The
    // nonce is single-use: consumed here whether or not it matches.
    if (!this.consumeSignInState()) {
      this.clearAuthFragment();
      return;
    }

    // Cleared HERE, before the first await, and that ordering is the whole point.
    //
    // Everything this function still needs is already in locals: `accessToken`, `refreshToken` and
    // `params` were parsed off the hash string above, and `URLSearchParams` holds a copy rather
    // than a live view of the URL. So the address bar can be emptied now at no cost.
    //
    // It used to be cleared on each exit path AFTER the identity fetch, which left live access and
    // refresh tokens in `window.location.hash` for the whole round trip — up to
    // GW_EMBED_ADOPTION_TIMEOUT_MS. Anything that reads the page URL during that window captures a
    // credential, and this app boots a third-party script that does exactly that: `AppComponent`
    // calls `bootIntercom()` before this runs, and Intercom records the current URL when its
    // asynchronously loaded widget processes the boot call. Whether the credential left the origin
    // came down to which of the two won a race.
    //
    // Nothing downstream may reintroduce an await before this line.
    this.clearAuthFragment();

    try {
      // supabase-js stores the user object alongside the tokens, and the fragment doesn't carry it.
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        // Bounded so a hung Supabase gateway cannot strand `mounting` at true — a permanent
        // skeleton, since the embed's dynamic import has not even started yet. The abort lands in
        // the fail-closed catch below.
        //
        // This bound used to also be what limited how long the tokens sat in the address bar. It
        // no longer carries that duty: the fragment is cleared before this call.
        signal: AbortSignal.timeout(GW_EMBED_ADOPTION_TIMEOUT_MS),
      });
      if (!response.ok) {
        return;
      }

      const user = (await response.json()) as { email?: string } | null;

      // Second gate: the returned session must belong to the person already signed in to LFX.
      //
      // Fails CLOSED, including when either side reports no address. An earlier version compared
      // only when both were present, on the stated reasoning that "a profile legitimately need not
      // carry an address" and refusing would strand such a user. That reasoning was wrong on the
      // facts: `User.email` is required by the interface contract, LFID always supplies one, and
      // this runs after hydration so `userService.user()` is populated. So the absent case is not
      // a legitimate user to protect — it is a state we cannot explain, on the one path that binds
      // a Gatewaze session to an LFX identity.
      //
      // A defence-in-depth check that passes whenever it cannot evaluate itself is not one. The
      // nonce is still the primary control; this is what stops a nonce-valid session belonging to
      // someone else being adopted, and it can only do that if an unverifiable identity is refused.
      const lfxEmail = this.userService.user()?.email?.toLowerCase();
      const gwEmail = user?.email?.toLowerCase();
      if (!lfxEmail || !gwEmail || lfxEmail !== gwEmail) {
        return;
      }

      // A non-numeric or negative expires_in would make expires_at NaN, and every later
      // hasUsableStoredSession() check would then read the session as expired.
      const parsedExpiresIn = Number(params.get('expires_in'));
      const expiresIn = Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : GW_EMBED_DEFAULT_SESSION_TTL_S;
      const session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: params.get('token_type') ?? 'bearer',
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        user,
      };

      window.localStorage.setItem(this.sessionStorageKey(), JSON.stringify(session));
      // The auto-sign-in counter is deliberately NOT cleared here. Clearing it on adoption looked
      // like it only enabled a later silent renewal, but adoption succeeding is not the same as the
      // embed accepting the session — this file already treats "session stored, embed still bounces
      // to /login" as reachable, which is why claimSessionRecoveryAttempt exists. In that state a
      // cleared counter makes the ceiling reset every cycle, so the user is pinned in a redirect
      // loop with one identity-provider round trip per iteration. Two automatic attempts per tab,
      // then the manual panel, is a far smaller cost than an unbounded loop.
    } catch (error) {
      // Logged, because silently swallowing this leaves a failed adoption indiagnosable: the user
      // lands on the manual sign-in panel with no indication why, and support has nothing to work
      // from. The sibling failure in mountEmbed logs the same way. Bounded and carries no token
      // material — the thrown value here is a fetch/abort error, not the session.
      console.warn('[GwModuleOutlet] Auth fragment adoption failed', error);
    }
  }

  /**
   * The URL the embed should return to after ITS own sign-in, with authentication material removed.
   *
   * Never `window.location.href`. On the LFID return leg the address bar still carries
   * `#access_token=…&refresh_token=…` — `adoptAuthFragment` clears it, but the context is built
   * before that runs — and the embed hands this value to a third party as a query parameter, where
   * a fragment survives into access logs. `startSignIn` was hardened against exactly this; this
   * path is the same hazard reached from the other direction.
   *
   * The spent sign-in nonce goes too: it is single-use and has no meaning on a later round trip.
   */
  private buildEmbedReturnUrl(): string {
    const url = new URL(window.location.href);
    url.hash = '';
    // The nonce is stripped rather than refreshed, and no new one is minted here — see the
    // `signIn` doc comment on GwHostContext. This runs while the mount context is assembled, which
    // is before `adoptAuthFragment` consumes a nonce arriving from a completed sign-in, so minting
    // one would overwrite the pending value and break every host-initiated return. A return leg
    // built from this URL therefore cannot be adopted, which is why sign-in is host-initiated.
    url.searchParams.delete(GW_EMBED_SIGNIN_STATE_PARAM);
    return url.toString();
  }

  /**
   * Takes the single-use sign-in nonce, returning whether it matches the one on the URL.
   *
   * Consumed whether or not it matches, so a failed or replayed return cannot be retried against
   * the same nonce. Fails CLOSED — no stored nonce, no nonce on the URL, or storage unavailable
   * all mean "do not adopt".
   */
  private consumeSignInState(): boolean {
    try {
      const expected = window.sessionStorage.getItem(GW_EMBED_SIGNIN_STATE_KEY);
      window.sessionStorage.removeItem(GW_EMBED_SIGNIN_STATE_KEY);

      const actual = new URLSearchParams(window.location.search).get(GW_EMBED_SIGNIN_STATE_PARAM);
      return Boolean(expected) && expected === actual;
    } catch {
      return false;
    }
  }

  /**
   * Shows the sign-in panel, and only that panel.
   *
   * `signInRequired` and `mountError` drive two independent `@if` siblings in the template, and
   * nothing but `onFatal` used to coordinate them — so the pair could both be set and the user got
   * two contradictory explanations at once, with a dead button on the sign-in one. The concrete
   * route was a partial config: `GW_LFID_START_URL` unset makes `startSignIn` set an error and
   * return, and after the auto-attempt ceiling `handleHostNavigation` then raises the sign-in
   * panel on top of it.
   *
   * Patching the individual writers would have fixed the instances and left the impossible state
   * expressible for the next one. Every write goes through here or `showErrorPanel` instead, so
   * "both panels showing" cannot be constructed.
   */
  private showSignInPanel(): void {
    this.mountError.set(null);
    this.signInRequired.set(true);
  }

  /** Shows the error panel, and only that panel. See showSignInPanel for why this is funnelled. */
  private showErrorPanel(message: string): void {
    this.signInRequired.set(false);
    this.mountError.set(message);
  }

  /**
   * Removes the tokens and the sign-in nonce from the address bar.
   *
   * `history.state` is passed through rather than replaced with null: the Angular Router keeps its
   * own navigation state there, and dropping it breaks back/forward and scroll restoration.
   */
  private clearAuthFragment(): void {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete(GW_EMBED_SIGNIN_STATE_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }

  /**
   * Keeps the embed's router in step with host-initiated navigation.
   *
   * Both mounts are `**` wildcards, so moving between two embed URLs — the sidebar's Newsletters
   * and Broadcasts links, or going back to an index from a detail page — does not recreate this
   * component. Angular updates the URL with `history.pushState`, which fires no `popstate`, and
   * `popstate` is the only thing the embed's router listens to. The address bar moved while the
   * embed carried on rendering the previous page, and only a reload resolved it.
   *
   * Re-dispatching `popstate` is what tells the embed's router to re-read the URL. Guarded on
   * `lastSyncedUrl` because Angular also handles `popstate`: without it, Angular's own handling
   * could emit another NavigationEnd and this would dispatch again, forever.
   *
   * Only host navigation needs this. The embed pushes its own URLs with `pushState`, which Angular
   * never observes, so its internal navigation cannot reach here and cannot be clobbered by it.
   */
  private watchHostNavigation(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.syncEmbedToHostUrl());
  }

  private syncEmbedToHostUrl(): void {
    if (!this.mountHandle) {
      return;
    }

    const path = window.location.pathname;
    // Leaving the embed's subtree destroys this component, so the router there needs no telling.
    // Anchored on a segment boundary: a bare startsWith would also match a future
    // `/foundation/gwidgets`, whose navigation would then be swallowed here instead of reaching
    // the router. server.ts guards the `/api/gw` mount the same way.
    if (path !== this.routePrefix && !path.startsWith(`${this.routePrefix}/`)) {
      return;
    }

    // A DURABLE guard, deliberately. A synchronous re-entrancy flag does not work here: Angular
    // wraps its own popstate handling in a setTimeout (router2.mjs, "added in #12160"), so the flag
    // is already cleared by the time that runs. Combined with onSameUrlNavigation: 'reload' it
    // produced an unbounded loop — NavigationEnd → dispatch → same-URL navigation → NavigationEnd.
    // With the default 'ignore', that re-entry is answered with NavigationSkipped rather than
    // NavigationEnd, so this never fires for our own dispatch and the URL comparison below is the
    // only guard needed.
    const url = `${path}${window.location.search}`;
    if (url === this.lastSyncedUrl) {
      return;
    }
    this.lastSyncedUrl = url;
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }

  /**
   * The embed's landing page on this mount, carrying the current query string.
   *
   * Both callers are leaving the embed's `/login` dead end — one to restart LFID, one to reload
   * onto a route that can read a stored session — and both used to rebuild this URL from the prefix
   * alone, which silently dropped `?project=`.
   *
   * That parameter is not decoration. `gwEmbedTenantGuard` reads it from the route to decide which
   * tenant is being navigated to, and falls back to persisted context only when it is absent. So a
   * shared `?project=agentic-ai-foundation` link that passed the guard on arrival came back from
   * the round trip without it, landed on whatever the cookie happened to hold, and was refused —
   * after a successful sign-in, with the fragment then never adopted. The guard was deliberately
   * rewritten to stop trusting that fallback; dropping the parameter walked straight back into it.
   *
   * The whole search is preserved rather than just `project`: the non-dead-end branch of
   * `startSignIn` already returns the full URL including its query, so singling out one parameter
   * would make two paths that should agree disagree. The fragment is what must not survive, and it
   * is not read here.
   */
  private buildLandingUrl(): string {
    // The spent sign-in nonce is stripped, matching `buildEmbedReturnUrl` and `clearAuthFragment`.
    // It is single-use and already consumed by the time either caller runs, so carrying it forward
    // only risks a later arrival looking like a fresh sign-in return.
    const url = new URL(`${window.location.origin}${this.routePrefix}${GW_EMBED_LANDING_PATH}${window.location.search}`);
    url.searchParams.delete(GW_EMBED_SIGNIN_STATE_PARAM);
    return url.toString();
  }

  /** Whether a stored embed session exists and hasn't expired. */
  private hasUsableStoredSession(): boolean {
    try {
      const raw = window.localStorage.getItem(this.sessionStorageKey());
      if (!raw) {
        return false;
      }

      const session = JSON.parse(raw) as { access_token?: string; expires_at?: number };
      return Boolean(session.access_token) && (session.expires_at ?? 0) > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }

  /**
   * Takes the one-shot claim on reloading to recover a session, returning false if it's already
   * been taken recently.
   *
   * Without this, a session the embed refuses for some other reason would reload to the landing
   * route, bounce back to `/login`, and reload again forever. One attempt per window means a
   * genuine failure falls through to the sign-in prompt instead.
   */
  private claimSessionRecoveryAttempt(): boolean {
    try {
      const last = Number(window.sessionStorage.getItem(GW_EMBED_SESSION_RECOVERY_KEY) ?? 0);
      if (Date.now() - last < GW_EMBED_SESSION_RECOVERY_COOLDOWN_MS) {
        return false;
      }

      window.sessionStorage.setItem(GW_EMBED_SESSION_RECOVERY_KEY, String(Date.now()));
      return true;
    } catch {
      // Storage unavailable (private mode, blocked cookies) — don't risk an unbounded reload loop.
      return false;
    }
  }

  /**
   * Counts this tab's automatic LFID attempts, returning false once the ceiling is reached.
   *
   * A bounded count rather than a cooldown: a cooldown lets the loop resume every time it expires,
   * which is the failure being guarded against, only slower. A hard ceiling stops for good.
   *
   * NaN is treated as exhausted — a corrupted value must not read as "plenty of attempts left".
   */
  private claimAutoSignInAttempt(): boolean {
    try {
      const attempts = Number(window.sessionStorage.getItem(GW_EMBED_AUTO_SIGNIN_KEY) ?? 0);
      if (!Number.isFinite(attempts) || attempts >= GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS) {
        return false;
      }
      window.sessionStorage.setItem(GW_EMBED_AUTO_SIGNIN_KEY, String(attempts + 1));
      return true;
    } catch {
      // Storage unavailable (private mode, blocked cookies). Fall back to the manual panel: an
      // unguarded automatic redirect is the one outcome worse than an extra click.
      return false;
    }
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
   * So paths inside the prefix are never forwarded to the router. `/login` is answered with the
   * sign-in prompt the embed has no UI for; any other unmatched in-prefix path is surfaced as an
   * error rather than silently looping. Paths outside the prefix are genuine host navigation.
   */
  private handleHostNavigation(path: string): void {
    // Anchored on a segment boundary — see resolveGwEmbedRoutePrefix. A bare startsWith would
    // swallow a future `/foundation/gwidgets` here instead of handing it to the router.
    const pathOnly = path.split('?')[0];
    if (pathOnly !== this.routePrefix && !pathOnly.startsWith(`${this.routePrefix}/`)) {
      void this.router.navigateByUrl(path);
      return;
    }

    const remainder = path.slice(this.routePrefix.length).split('?')[0].replace(/\/$/, '');
    if (remainder === GW_EMBED_LOGIN_PATH) {
      // A stored session plus a bounce to /login means the embed asked for its login page before it
      // had read that session — and /login matches no embed route, so nothing there will ever read
      // it either. Reload onto a real route so the guarded tree gets a chance to see the session.
      // A full load rather than a router navigation: both routers must re-read the URL, and Angular
      // would stay on this same wildcard route without remounting the embed.
      if (this.hasUsableStoredSession() && this.claimSessionRecoveryAttempt()) {
        window.location.assign(this.buildLandingUrl());
        return;
      }

      // Start LFID automatically rather than asking. A user who is already signed in to LFX has
      // no model in which "sign in to Gatewaze" makes sense — they ARE signed in, and the embed's
      // separate session is an implementation detail they should never have to know about. With an
      // LFID session already in the browser the round trip is silent, so this reads as the page
      // simply loading.
      //
      // Bounded by GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS per tab, currently 2, so the manual panel
      // appears on the third /login arrival. The embed asks for /login on every unauthenticated
      // render, so without the bound a session that fails to stick would bounce the user through
      // the identity provider endlessly. The panel cannot loop and gives the user something to act
      // on. Stated as the constant rather than a number because this comment previously said "one
      // attempt" and was read during a loop investigation after the ceiling had already moved.
      if (this.claimAutoSignInAttempt()) {
        this.startSignIn();
        return;
      }

      this.showSignInPanel();
      return;
    }

    this.showErrorPanel(`The embedded admin module asked to open "${path}", which has no route.`);
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

  private onFatal(err: GwEmbedFatalError): void {
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

    // Terminal. Clear the sign-in prompt first: the two panels are independent signals, so a fatal
    // arriving after a failed sign-in round trip stacked both of them on screen.
    this.showErrorPanel(err.message || 'The embedded admin module failed to load.');
  }

  /**
   * Adds the embed's stylesheet to `<head>` once per document.
   *
   * It stays there after unmount: the sheet is only reachable through the embed's own scoping
   * selectors, re-fetching it on every visit to an embed route would be wasteful, and removing it
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
