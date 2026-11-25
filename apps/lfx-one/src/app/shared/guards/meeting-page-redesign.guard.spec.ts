// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment } from '@angular/router';
import { MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { AuthContext, ServerRequestContext } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MEETING_PAGE_ANONYMOUS_FLAG_KEY, MEETING_PAGE_REDESIGN_KEY, meetingPageRedesignGuard } from './meeting-page-redesign.guard';

const AUTH_KEY = makeStateKey<AuthContext>('auth');

describe('meetingPageRedesignGuard', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let query: string;
  let state: Record<string, unknown> | undefined;
  let shown: { routeConfig: Route | null; paramMap: Map<string, string>; firstChild: null };

  const route: Route = { path: 'meetings/:id' };
  const segments = [new UrlSegment('meetings', {}), new UrlSegment('123', {})];

  const configure = (platform: 'browser' | 'server', context: ServerRequestContext | null = null): void => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: REQUEST_CONTEXT, useValue: context },
        { provide: FeatureFlagService, useValue: { getFlagOverride, providerReady: signal(true).asReadonly(), getBooleanFlag, waitForReady: vi.fn() } },
        {
          provide: Router,
          useValue: {
            getCurrentNavigation: () => ({
              extractedUrl: { queryParamMap: new URLSearchParams(query) },
              extras: { state },
            }),
            routerState: {
              snapshot: {
                get root() {
                  return { firstChild: shown };
                },
              },
            },
          },
        },
      ],
    });
  };
  const signIn = (): void => TestBed.inject(TransferState).set(AUTH_KEY, { authenticated: true, user: null, persona: null, organizations: [] });
  const runGuard = (): Promise<boolean> => TestBed.runInInjectionContext(() => meetingPageRedesignGuard(route, segments)) as Promise<boolean>;

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    getBooleanFlag = vi.fn().mockReturnValue(signal(true));
    query = '';
    state = undefined;
    shown = { routeConfig: null, paramMap: new Map(), firstChild: null };
  });

  describe('in the browser', () => {
    beforeEach(() => configure('browser'));

    it('matches for a signed-in viewer with the flag on', async () => {
      signIn();
      expect(await runGuard()).toBe(true);
    });

    it("follows the server's anonymous answer for a signed-out visitor, without asking LaunchDarkly", async () => {
      expect(await runGuard()).toBe(false);
      TestBed.inject(TransferState).set(MEETING_PAGE_ANONYMOUS_FLAG_KEY, true);
      expect(await runGuard()).toBe(true);
      expect(getBooleanFlag).not.toHaveBeenCalled();
    });

    it('matches a ?password= link', async () => {
      signIn();
      query = 'password=secret';
      expect(await runGuard()).toBe(true);
    });

    it('keeps a ?action= link on the legacy page', async () => {
      signIn();
      query = 'action=leave';
      expect(await runGuard()).toBe(false);
    });

    it('keeps a navigation handed back by the page on the legacy page', async () => {
      signIn();
      state = { [MEETING_PAGE_LEGACY_STATE]: true };
      expect(await runGuard()).toBe(false);
    });

    it('keeps the legacy page across its own query-param navigations', async () => {
      signIn();
      shown = { routeConfig: { path: 'meetings/:id' }, paramMap: new Map([['id', '123']]), firstChild: null };
      expect(await runGuard()).toBe(false);
    });

    it('keeps the server decision for the hydrating URL, once', async () => {
      signIn();
      TestBed.inject(TransferState).set(MEETING_PAGE_REDESIGN_KEY, { id: '123', enabled: false });

      expect(await runGuard()).toBe(false);
      expect(await runGuard()).toBe(true);
      expect(getBooleanFlag).toHaveBeenCalledTimes(1);
    });
  });

  describe('on the server', () => {
    const auth: AuthContext = { authenticated: true, user: null, persona: null, organizations: [] };

    it('reads the server flag and records the decision for hydration', async () => {
      configure('server', { auth, flags: { meetingsRedesign: true } });

      expect(await runGuard()).toBe(true);
      expect(TestBed.inject(TransferState).get(MEETING_PAGE_REDESIGN_KEY, null)).toEqual({ id: '123', enabled: true });
      expect(getBooleanFlag).not.toHaveBeenCalled();
    });

    it('keeps the decision for the hydrating URL when the server redirects to not-found', async () => {
      configure('server', { auth, flags: { meetingsRedesign: true } });
      expect(await runGuard()).toBe(true);

      const notFound = [new UrlSegment('meetings', {}), new UrlSegment('not-found', {})];
      const matched = await (TestBed.runInInjectionContext(() => meetingPageRedesignGuard({ path: 'meetings/not-found' }, notFound)) as Promise<boolean>);

      expect(matched).toBe(true);
      expect(TestBed.inject(TransferState).get(MEETING_PAGE_REDESIGN_KEY, null)).toEqual({ id: '123', enabled: true });
    });

    it('follows the server flag for an anonymous visitor', async () => {
      configure('server', { auth: { ...auth, authenticated: false }, flags: { meetingsRedesign: false } });

      expect(await runGuard()).toBe(false);
      expect(TestBed.inject(TransferState).get(MEETING_PAGE_REDESIGN_KEY, null)).toEqual({ id: '123', enabled: false });
      expect(TestBed.inject(TransferState).get(MEETING_PAGE_ANONYMOUS_FLAG_KEY, null)).toBe(false);
    });

    it('defaults to the legacy page when the server did not evaluate the flag', async () => {
      configure('server', { auth });

      expect(await runGuard()).toBe(false);
      expect(TestBed.inject(TransferState).get(MEETING_PAGE_REDESIGN_KEY, null)).toEqual({ id: '123', enabled: false });
    });
  });
});
