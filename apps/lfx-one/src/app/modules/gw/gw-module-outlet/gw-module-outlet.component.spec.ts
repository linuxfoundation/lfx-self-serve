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
