// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, Router, RouterStateSnapshot, UrlSegment, UrlTree } from '@angular/router';
import { PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { profileRedesignEnabledGuard, profileRedesignRedirectGuard } from './profile-redesign.guard';

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

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    flagValue = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(flagValue);
    waitForReady = vi.fn().mockImplementation(() => Promise.resolve(providerReady()));

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady } },
        { provide: PLATFORM_ID, useValue: 'browser' },
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

    it('defers to the browser on the server', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

      expect(await match('account', 'clas')).toBe(true);
      expect(getFlagOverride).not.toHaveBeenCalled();
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

    it('lets the tab load on the server', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

      expect(await activate('identities')).toBe(true);
      expect(getFlagOverride).not.toHaveBeenCalled();
    });
  });
});
