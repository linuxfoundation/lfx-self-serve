// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  GW_EMBED_AUTO_SIGNIN_KEY,
  GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS,
  GW_EMBED_SESSION_RECOVERY_COOLDOWN_MS,
  GW_EMBED_SESSION_RECOVERY_KEY,
  GW_EMBED_SIGNIN_STATE_KEY,
  GW_EMBED_SIGNIN_STATE_PARAM,
  GW_EMBED_STORAGE_KEY_PREFIX,
  GW_EMBED_STORAGE_KEY_SUFFIX,
} from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from '../../../shared/services/user.service';
import { GwModuleOutletComponent } from './gw-module-outlet.component';

/**
 * These cover the host-side decisions the embed can't make for itself — session adoption, the
 * /login loop-breaker, and the notification bridge. The mount path itself isn't exercised: the
 * component is created under a server PLATFORM_ID so `afterNextRender` never fires and no attempt
 * is made to import the embed bundle, which isn't resolvable in a test environment.
 */
describe('GwModuleOutletComponent', () => {
  const SESSION_KEY = `${GW_EMBED_STORAGE_KEY_PREFIX}${GW_EMBED_STORAGE_KEY_SUFFIX}`;
  const RECOVERY_KEY = GW_EMBED_SESSION_RECOVERY_KEY;

  let fixture: ComponentFixture<GwModuleOutletComponent>;
  let component: GwModuleOutletComponent;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  /** Private by design — these are internal decisions, not API, but they're where the risk lives. */
  const callPrivate = <T>(name: string, ...args: unknown[]): T => (component as unknown as Record<string, (...a: unknown[]) => T>)[name](...args);

  const futureSession = (): string => JSON.stringify({ access_token: 'token', expires_at: Math.floor(Date.now() / 1000) + 3600 });

  /**
   * Burns the automatic sign-in budget so a /login bounce falls through to the manual panel.
   *
   * The host attempts an automatic LFID redirect BEFORE offering the button, because a user who is
   * already signed in to LFX should never be asked to sign in a second time. Every manual-fallback
   * case below is therefore reachable only once that budget is spent, and each one says so.
   */
  const exhaustAutoSignIn = (): void => window.sessionStorage.setItem(GW_EMBED_AUTO_SIGNIN_KEY, String(GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS));

  beforeEach(() => {
    navigateByUrl = vi.fn();
    add = vi.fn();
    window.localStorage.clear();
    window.sessionStorage.clear();

    TestBed.configureTestingModule({
      imports: [GwModuleOutletComponent],
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        { provide: MessageService, useValue: { add } },
        // Stubbed rather than real: UserService pulls in HttpClient and a chain of app providers,
        // and all this component asks it for is the signed-in user's email.
        { provide: UserService, useValue: { user: signal(null) } },
        // Server platform keeps afterNextRender (and therefore the embed import) out of the test.
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    fixture = TestBed.createComponent(GwModuleOutletComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe('hasUsableStoredSession', () => {
    it('accepts a stored session that has not expired', () => {
      window.localStorage.setItem(SESSION_KEY, futureSession());

      expect(callPrivate<boolean>('hasUsableStoredSession')).toBe(true);
    });

    it('rejects an expired session', () => {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: 'token', expires_at: Math.floor(Date.now() / 1000) - 1 }));

      expect(callPrivate<boolean>('hasUsableStoredSession')).toBe(false);
    });

    it('rejects a session with no access token', () => {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ expires_at: Math.floor(Date.now() / 1000) + 3600 }));

      expect(callPrivate<boolean>('hasUsableStoredSession')).toBe(false);
    });

    it('rejects when nothing is stored', () => {
      expect(callPrivate<boolean>('hasUsableStoredSession')).toBe(false);
    });

    it('rejects malformed JSON rather than throwing', () => {
      window.localStorage.setItem(SESSION_KEY, 'not json');

      expect(callPrivate<boolean>('hasUsableStoredSession')).toBe(false);
    });
  });

  describe('claimSessionRecoveryAttempt', () => {
    it('grants the first claim', () => {
      expect(callPrivate<boolean>('claimSessionRecoveryAttempt')).toBe(true);
    });

    it('refuses a second claim inside the cooldown, so a bad session cannot reload forever', () => {
      expect(callPrivate<boolean>('claimSessionRecoveryAttempt')).toBe(true);
      expect(callPrivate<boolean>('claimSessionRecoveryAttempt')).toBe(false);
    });

    it('grants again once the cooldown has elapsed', () => {
      window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now() - GW_EMBED_SESSION_RECOVERY_COOLDOWN_MS - 1));

      expect(callPrivate<boolean>('claimSessionRecoveryAttempt')).toBe(true);
    });

    it('refuses when storage is unavailable, rather than risking an unbounded reload loop', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });

      expect(callPrivate<boolean>('claimSessionRecoveryAttempt')).toBe(false);
    });
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

    it('asks for sign-in when the embed bounces to /login with no usable session', () => {
      exhaustAutoSignIn();

      callPrivate('handleHostNavigation', '/foundation/gw/login');

      expect(component['signInRequired']()).toBe(true);
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('spends an automatic sign-in attempt before ever showing the manual panel', () => {
      // The whole point of the automatic path: a user with a live LFX session must not be asked to
      // sign in again. The redirect itself is a window.location.assign jsdom won't follow, so the
      // assertion is on the budget being claimed and the panel being withheld.
      callPrivate('handleHostNavigation', '/foundation/gw/login');

      expect(window.sessionStorage.getItem(GW_EMBED_AUTO_SIGNIN_KEY)).toBe('1');
      expect(component['signInRequired']()).toBe(false);
    });

    it('does not ask for sign-in when a usable session is present and a recovery reload is available', () => {
      // The branch ends in a window.location.assign, which jsdom will not navigate and will not let
      // us redefine. Asserting the observable side effects is enough: the one-shot claim is spent
      // and we did NOT fall through to the sign-in prompt.
      window.localStorage.setItem(SESSION_KEY, futureSession());

      callPrivate('handleHostNavigation', '/foundation/gw/login');

      expect(window.sessionStorage.getItem(RECOVERY_KEY)).not.toBeNull();
      expect(component['signInRequired']()).toBe(false);
    });

    it('falls back to the sign-in prompt when the one-shot recovery claim is already spent', () => {
      exhaustAutoSignIn();
      window.localStorage.setItem(SESSION_KEY, futureSession());
      window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

      callPrivate('handleHostNavigation', '/foundation/gw/login');

      expect(component['signInRequired']()).toBe(true);
    });

    it('ignores a query string when matching the login path', () => {
      exhaustAutoSignIn();

      callPrivate('handleHostNavigation', '/foundation/gw/login?returnTo=%2Ffoundation%2Fgw');

      expect(component['signInRequired']()).toBe(true);
      expect(component['mountError']()).toBeNull();
    });
  });

  describe('claimAutoSignInAttempt', () => {
    // The ceiling is the only thing standing between a failed adoption and an unbounded host -> IdP
    // -> host redirect loop, so it is asserted directly rather than through handleHostNavigation.
    it('allows attempts up to the ceiling and refuses after it', () => {
      const claims = Array.from({ length: GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS + 1 }, () => callPrivate<boolean>('claimAutoSignInAttempt'));

      expect(claims.slice(0, GW_EMBED_AUTO_SIGNIN_MAX_ATTEMPTS).every(Boolean)).toBe(true);
      expect(claims.at(-1)).toBe(false);
    });

    it('refuses when the stored counter is not a number', () => {
      // Number('') is 0, so the guard has to reject non-numeric text specifically — a corrupted
      // counter must fail closed to the manual panel, not reset the budget to zero.
      window.sessionStorage.setItem(GW_EMBED_AUTO_SIGNIN_KEY, 'tampered');

      expect(callPrivate<boolean>('claimAutoSignInAttempt')).toBe(false);
    });
  });

  describe('adoptAuthFragment', () => {
    // The function that writes a Supabase session into localStorage from whatever is on the URL.
    // Its invariants: the nonce is the gate that fails closed, an absent email on either side is a
    // PASS (a profile need not carry one, and failing closed would strand that user), expires_at
    // must never be NaN, and the fragment is cleared on every path — success or refusal — so
    // tokens do not linger in the address bar or in history.
    const SUPABASE = 'https://data.example.test';
    const ANON = 'anon-key';

    const withFragment = (fragment: string, nonce: string | null = 'nonce-1'): void => {
      const url = new URL(window.location.href);
      if (nonce === null) {
        url.searchParams.delete(GW_EMBED_SIGNIN_STATE_PARAM);
      } else {
        url.searchParams.set(GW_EMBED_SIGNIN_STATE_PARAM, nonce);
        window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, nonce);
      }
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${fragment}`);
    };

    const tokens = (extra = ''): string => `#access_token=at&refresh_token=rt${extra}`;

    const stubUser = (body: unknown, ok = true): ReturnType<typeof vi.fn> => {
      const f = vi.fn().mockResolvedValue({ ok, json: async () => body });
      vi.stubGlobal('fetch', f);
      return f;
    };

    const storedSession = (): { expires_at?: number; user?: unknown } | null => {
      const raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      window.history.replaceState(window.history.state, '', window.location.pathname);
    });

    it('stores the session when the nonce matches and the emails agree', async () => {
      TestBed.inject(UserService).user.set({ email: 'Person@example.test' } as never);
      stubUser({ email: 'person@example.test' });
      withFragment(tokens('&expires_in=120'));

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(storedSession()).not.toBeNull();
      expect(window.location.hash).toBe('');
    });

    it('refuses a fragment whose nonce this browser never issued — the crafted-link case', async () => {
      // The control that actually fails closed: without it, a crafted link carrying an attacker's
      // valid tokens would be adopted and the victim would work inside the attacker's tenant.
      const f = stubUser({ email: 'person@example.test' });
      withFragment(tokens(), null);

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(storedSession()).toBeNull();
      expect(f).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('');
    });

    it('stores nothing when the token lookup fails, and still clears the fragment', async () => {
      // The nonce is already spent by this point, so no retry can succeed — leaving the tokens on
      // the URL would only risk them being carried somewhere else.
      stubUser(null, false);
      withFragment(tokens());

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(storedSession()).toBeNull();
      expect(window.location.hash).toBe('');
    });

    it('refuses a session belonging to someone other than the signed-in LFX user', async () => {
      TestBed.inject(UserService).user.set({ email: 'person@example.test' } as never);
      stubUser({ email: 'someone-else@example.test' });
      withFragment(tokens());

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(storedSession()).toBeNull();
    });

    it('adopts when either side reports no email, because absent is a pass and not a match', async () => {
      // Stated as its own case because the comment in the source had it backwards once. Failing
      // closed here would strand a user whose LFX profile carries no address.
      TestBed.inject(UserService).user.set({ email: undefined } as never);
      stubUser({ email: 'person@example.test' });
      withFragment(tokens());

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(storedSession()).not.toBeNull();
    });

    it.each([
      ['absent', ''],
      ['non-numeric', '&expires_in=soon'],
      ['negative', '&expires_in=-60'],
    ])('falls back to the default TTL when expires_in is %s, never NaN', async (_label, extra) => {
      // A NaN expires_at would make every later hasUsableStoredSession() read the session as
      // expired, which presents as a sign-in loop rather than as a parsing bug.
      stubUser({ email: 'person@example.test' });
      withFragment(tokens(extra));

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      const expiresAt = storedSession()?.expires_at;
      expect(Number.isFinite(expiresAt)).toBe(true);
      expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('does nothing at all when the URL carries no tokens', async () => {
      const f = stubUser({ email: 'person@example.test' });
      withFragment('');

      await callPrivate<Promise<void>>('adoptAuthFragment', SUPABASE, ANON);

      expect(f).not.toHaveBeenCalled();
      expect(storedSession()).toBeNull();
    });
  });

  describe('syncEmbedToHostUrl', () => {
    // Re-dispatches popstate so the embed's own router follows a host navigation. The lastSyncedUrl
    // guard is the only thing between this and the unbounded NavigationEnd -> dispatch ->
    // NavigationEnd loop that shipped once already, so it is asserted directly.
    let dispatched: number;
    let onPopState: () => void;

    beforeEach(() => {
      dispatched = 0;
      onPopState = (): void => {
        dispatched += 1;
      };
      window.addEventListener('popstate', onPopState);
      // The guard returns early without a mount handle, which would make every case below vacuous.
      (component as unknown as { mountHandle: unknown }).mountHandle = { unmount: vi.fn() };
    });

    afterEach(() => {
      window.removeEventListener('popstate', onPopState);
      window.history.replaceState(window.history.state, '', '/');
    });

    const at = (path: string): void => window.history.replaceState(window.history.state, '', path);

    it('tells the embed about an in-prefix navigation', () => {
      at('/foundation/gw/newsletters');

      callPrivate('syncEmbedToHostUrl');

      expect(dispatched).toBe(1);
    });

    it('does not re-dispatch for a URL it has already synced', () => {
      at('/foundation/gw/newsletters');
      callPrivate('syncEmbedToHostUrl');

      callPrivate('syncEmbedToHostUrl');

      expect(dispatched).toBe(1);
    });

    it('dispatches again once the query string changes', () => {
      at('/foundation/gw/newsletters');
      callPrivate('syncEmbedToHostUrl');

      at('/foundation/gw/newsletters?page=2');
      callPrivate('syncEmbedToHostUrl');

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

  describe('consumeSignInState', () => {
    // This is the gate that stops a crafted link handing the user someone else's Supabase session.
    const withStateOnUrl = (value: string | null): void => {
      const url = new URL(window.location.href);
      if (value === null) {
        url.searchParams.delete('gw_state');
      } else {
        url.searchParams.set('gw_state', value);
      }
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    };

    afterEach(() => withStateOnUrl(null));

    it('accepts a nonce that matches the one this browser stored', () => {
      window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, 'nonce-1');
      withStateOnUrl('nonce-1');

      expect(callPrivate<boolean>('consumeSignInState')).toBe(true);
    });

    it('rejects a fragment that arrives with no nonce at all — the crafted-link case', () => {
      window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, 'nonce-1');
      withStateOnUrl(null);

      expect(callPrivate<boolean>('consumeSignInState')).toBe(false);
    });

    it('rejects a mismatched nonce', () => {
      window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, 'nonce-1');
      withStateOnUrl('nonce-2');

      expect(callPrivate<boolean>('consumeSignInState')).toBe(false);
    });

    it('rejects when this browser never started a sign-in', () => {
      withStateOnUrl('nonce-1');

      expect(callPrivate<boolean>('consumeSignInState')).toBe(false);
    });

    it('is single-use, so a replayed return cannot reuse the same nonce', () => {
      window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, 'nonce-1');
      withStateOnUrl('nonce-1');

      expect(callPrivate<boolean>('consumeSignInState')).toBe(true);
      expect(callPrivate<boolean>('consumeSignInState')).toBe(false);
    });

    it('fails closed when storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });

      expect(callPrivate<boolean>('consumeSignInState')).toBe(false);
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
