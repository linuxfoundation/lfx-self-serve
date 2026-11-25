// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, REQUEST_CONTEXT, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, Router, RouterStateSnapshot, UrlSegment, UrlTree } from '@angular/router';
import { PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { UserService } from '@shared/services/user.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILE_REDESIGN_KEY } from '../utils/profile-redesign.util';
import { profileRedesignEnabledGuard, profileRedesignOnlyGuard, profileRedesignReadGuard, profileRedesignRedirectGuard } from './profile-redesign.guard';

describe('profile redesign guards', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let flagValue: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;

  const url = (result: unknown): string => TestBed.inject(Router).serializeUrl(result as UrlTree);

  const match = (...paths: string[]) =>
    TestBed.runInInjectionContext(() =>
      profileRedesignEnabledGuard(
        { path: 'account' } as Route,
        paths.map((path) => new UrlSegment(path, {}))
      )
    );

  const activate = (path: string, fragment: string | null = null, queryParams: Record<string, string> = {}) =>
    TestBed.runInInjectionContext(() =>
      profileRedesignRedirectGuard({ routeConfig: { path }, fragment, queryParams } as unknown as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

  let authenticated: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    authenticated = signal(true);
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    flagValue = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(flagValue);
    waitForReady = vi.fn().mockImplementation(() => Promise.resolve(providerReady()));

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady } },
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { authenticated } },
      ],
    });
  });

  describe('profileRedesignEnabledGuard', () => {
    it('lets /account load with the flag on', async () => {
      expect(await match('account', 'identities')).toBe(true);
      expect(getBooleanFlag).toHaveBeenCalledWith(PROFILE_REDESIGN_FLAG, false);
    });

    it('falls back to the matching hub tab with the flag off', async () => {
      flagValue.set(false);

      expect(url(await match('account', 'identities'))).toBe('/profile/identities');
      expect(url(await match('account', 'password'))).toBe('/profile/settings#password');
      expect(url(await match('account'))).toBe('/profile');
    });

    it('falls back when the flag service never gets ready', async () => {
      providerReady.set(false);

      expect(url(await match('account', 'clas'))).toBe('/profile/clas');
      expect(getBooleanFlag).not.toHaveBeenCalled();
    });

    it('lets a local override decide without waiting', async () => {
      getFlagOverride.mockReturnValue(true);
      providerReady.set(false);

      expect(await match('account', 'clas')).toBe(true);
      expect(waitForReady).not.toHaveBeenCalled();
    });

    it('decides on the server from the flags it evaluated, and hands the answer to the browser', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { flags: { profileRedesign: false } } });

      expect(url(await match('account', 'clas'))).toBe('/profile/clas');
      expect(TestBed.inject(TransferState).get(PROFILE_REDESIGN_KEY, null)).toBe(false);
      expect(getFlagOverride).not.toHaveBeenCalled();
    });

    it('keeps the hub on the server when no flags were evaluated', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

      expect(url(await match('account', 'clas'))).toBe('/profile/clas');
    });

    it("follows the server's answer in the browser without asking the flag service", async () => {
      TestBed.inject(TransferState).set(PROFILE_REDESIGN_KEY, true);
      providerReady.set(false);

      expect(await match('account', 'clas')).toBe(true);
      expect(waitForReady).not.toHaveBeenCalled();
    });
  });

  describe('profileRedesignRedirectGuard', () => {
    it('sends a moved tab to its Account & Settings page, keeping the query', async () => {
      expect(url(await activate('identities', null, { success: 'linked' }))).toBe('/account/identities?success=linked');
      expect(url(await activate('settings', 'developer-settings'))).toBe('/account/developer-settings');
      expect(url(await activate('settings'))).toBe('/account/email-settings');
    });

    it('lets the tab load with the flag off, or for a tab that stays on the hub', async () => {
      expect(await activate('attributions')).toBe(true);
      expect(getBooleanFlag).not.toHaveBeenCalled();

      flagValue.set(false);
      expect(await activate('identities')).toBe(true);
    });

    it('lets the tab load when the flag service never gets ready', async () => {
      providerReady.set(false);

      expect(await activate('identities')).toBe(true);
    });

    it('redirects on the server when the flags it evaluated say so, and lets the tab load otherwise', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { flags: { profileRedesign: true } } });

      expect(url(await activate('settings', 'password', { success: 'profile_token_obtained' }))).toBe('/account/password?success=profile_token_obtained');
      expect(getFlagOverride).not.toHaveBeenCalled();
    });

    it('lets the tab load on the server with the flag off', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { flags: { profileRedesign: false } } });

      expect(await activate('identities')).toBe(true);
    });
  });

  describe('profileRedesignOnlyGuard', () => {
    const only = () => TestBed.runInInjectionContext(() => profileRedesignOnlyGuard({ path: 'profile' } as Route, [new UrlSegment('profile', {})]));

    it('matches the Profile page with the flag on, and lets the hub take /profile with it off', async () => {
      expect(await only()).toBe(true);

      flagValue.set(false);
      expect(await only()).toBe(false);
    });
  });

  describe('profileRedesignReadGuard', () => {
    const read = () => TestBed.runInInjectionContext(() => profileRedesignReadGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

    it('always lets the public profile load, whatever the flag says', async () => {
      expect(await read()).toBe(true);

      flagValue.set(false);
      expect(await read()).toBe(true);
    });

    it('lets a signed-out visitor through without waiting on the flag service', async () => {
      authenticated.set(false);
      providerReady.set(false);

      expect(await read()).toBe(true);
      expect(waitForReady).not.toHaveBeenCalled();
    });

    it('hands the server’s answer to the browser', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      TestBed.overrideProvider(REQUEST_CONTEXT, { useValue: { flags: { profileRedesign: true } } });

      expect(await read()).toBe(true);
      expect(TestBed.inject(TransferState).get(PROFILE_REDESIGN_KEY, null)).toBe(true);
    });
  });
});
