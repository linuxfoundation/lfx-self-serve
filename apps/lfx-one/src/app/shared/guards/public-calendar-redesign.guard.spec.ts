// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, Route, Router, UrlSegment } from '@angular/router';
import { AuthContext, ServerRequestContext } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MEETING_PAGE_ANONYMOUS_FLAG_KEY } from './meeting-page-redesign.guard';
import { PUBLIC_CALENDAR_REDESIGN_KEY, publicCalendarRedesignGuard } from './public-calendar-redesign.guard';

const AUTH_KEY = makeStateKey<AuthContext>('auth');

describe('publicCalendarRedesignGuard', () => {
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let shown: { routeConfig: Route | null; paramMap: ReturnType<typeof convertToParamMap>; firstChild: null };

  const route: Route = { path: 'projects/:projectSlug/calendar' };
  const segments = [new UrlSegment('projects', {}), new UrlSegment('synthetic-project', {}), new UrlSegment('calendar', {})];
  const auth: AuthContext = { authenticated: true, user: null, persona: null, organizations: [] };

  const configure = (platform: 'browser' | 'server', context: ServerRequestContext | null = null): void => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: REQUEST_CONTEXT, useValue: context },
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride: () => undefined, providerReady: signal(true).asReadonly(), getBooleanFlag, waitForReady: vi.fn() },
        },
        { provide: Router, useValue: { routerState: { snapshot: { root: { firstChild: shown } } } } },
      ],
    });
  };
  const runGuard = (): Promise<boolean> => TestBed.runInInjectionContext(() => publicCalendarRedesignGuard(route, segments)) as Promise<boolean>;

  beforeEach(() => {
    getBooleanFlag = vi.fn().mockReturnValue(signal(true));
    shown = { routeConfig: null, paramMap: convertToParamMap({}), firstChild: null };
  });

  it('follows the server flag and records the decision for the project slug', async () => {
    configure('server', { auth, flags: { meetingsRedesign: true } });

    expect(await runGuard()).toBe(true);
    expect(TestBed.inject(TransferState).get(PUBLIC_CALENDAR_REDESIGN_KEY, null)).toEqual({ id: 'synthetic-project', enabled: true });
  });

  it('keeps the anonymous answer for a signed-out visitor', async () => {
    configure('server', { auth: { ...auth, authenticated: false }, flags: { meetingsRedesign: false } });

    expect(await runGuard()).toBe(false);
    expect(TestBed.inject(TransferState).get(MEETING_PAGE_ANONYMOUS_FLAG_KEY, null)).toBe(false);
  });

  it("reuses the server's decision while hydrating, then asks the flag service for a signed-in viewer", async () => {
    configure('browser');
    const transferState = TestBed.inject(TransferState);
    transferState.set(AUTH_KEY, auth);
    transferState.set(PUBLIC_CALENDAR_REDESIGN_KEY, { id: 'synthetic-project', enabled: false });

    expect(await runGuard()).toBe(false);
    expect(getBooleanFlag).not.toHaveBeenCalled();
    expect(await runGuard()).toBe(true);
  });

  it("keeps the page that is showing when only the calendar's query changes", async () => {
    shown = { routeConfig: route, paramMap: convertToParamMap({ projectSlug: 'synthetic-project' }), firstChild: null };
    configure('browser');
    TestBed.inject(TransferState).set(AUTH_KEY, auth);

    expect(await runGuard()).toBe(true);
    expect(await TestBed.runInInjectionContext(() => publicCalendarRedesignGuard({ path: route.path }, segments))).toBe(false);
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});
