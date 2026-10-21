// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import type { Event as RouterEvent } from '@angular/router';
import type { LfxSegmentAnalytics } from '@lfx-one/shared/interfaces';
import { sanitizeSegmentEvent } from '@lfx-one/shared/utils';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { SegmentService } from './segment.service';

const SECRET = 'SYNTHETIC_PASSCODE';
const AUTH0_USER = { sub: 'auth0|synthetic', email: 'member@acme-motors.example' };

function createAnalytics() {
  return {
    init: vi.fn(() => Promise.resolve()),
    initWithEventSanitizer: vi.fn(() => Promise.resolve()),
    page: vi.fn(),
    track: vi.fn(),
    identifyAuth0User: vi.fn(),
    reset: vi.fn(),
  } satisfies LfxSegmentAnalytics;
}

type FakeAnalytics = ReturnType<typeof createAnalytics>;

/**
 * Pins linuxfoundation/lfx-self-serve-ops#49: Segment must only ever be initialized through the
 * LFX wrapper's protected `initWithEventSanitizer`, so the automatic initial page and every later
 * event pass through `sanitizeSegmentEvent`. The unprotected `init()` would send raw URLs
 * (including meeting passcodes) before any app code could intervene, so it must never run — not
 * even as a fallback when protected init is unavailable or fails.
 */
describe('SegmentService', () => {
  let service: SegmentService;
  let routerEvents: Subject<RouterEvent>;
  let analytics: FakeAnalytics;
  let consoleError: MockInstance<typeof console.error>;
  let originalUrl: string;
  let originalTitle: string;

  const installWrapper = (instance: LfxSegmentAnalytics): void => {
    window.LfxAnalytics = { LfxSegmentsAnalytics: { getInstance: () => instance } };
  };

  const waitForAnalytics = (): Promise<void> => service['waitForAnalytics']();

  beforeEach(() => {
    originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    originalTitle = document.title;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    routerEvents = new Subject<RouterEvent>();
    analytics = createAnalytics();
    installWrapper(analytics);

    TestBed.configureTestingModule({ providers: [SegmentService, { provide: Router, useValue: { events: routerEvents } }] });
    service = TestBed.inject(SegmentService);
  });

  afterEach(() => {
    delete window.LfxAnalytics;
    history.replaceState(null, '', originalUrl);
    document.title = originalTitle;
    vi.restoreAllMocks();
  });

  describe('protected initialization', () => {
    it('initializes once through initWithEventSanitizer with the app sanitizer and never calls init()', async () => {
      await waitForAnalytics();
      await waitForAnalytics();

      expect(analytics.initWithEventSanitizer).toHaveBeenCalledTimes(1);
      expect(analytics.initWithEventSanitizer).toHaveBeenCalledWith(sanitizeSegmentEvent);
      expect(analytics.init).not.toHaveBeenCalled();
    });

    it('drains queued identify calls after a successful protected init', async () => {
      service.identifyUser(AUTH0_USER);
      expect(analytics.identifyAuth0User).not.toHaveBeenCalled();

      await waitForAnalytics();

      expect(analytics.identifyAuth0User).toHaveBeenCalledWith(AUTH0_USER);
    });

    it('stays disabled without falling back to init() when the artifact lacks protected init', async () => {
      const legacy: LfxSegmentAnalytics = createAnalytics();
      // @ts-expect-error Deliberately model a legacy artifact without protected initialization.
      delete legacy.initWithEventSanitizer;
      installWrapper(legacy);
      service.identifyUser(AUTH0_USER);

      await waitForAnalytics();
      service.trackPage('page');
      service.trackEvent('event');

      expect(legacy.init).not.toHaveBeenCalled();
      expect(legacy.identifyAuth0User).not.toHaveBeenCalled();
      expect(legacy.page).not.toHaveBeenCalled();
      expect(legacy.track).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('does not support protected initialization'));
    });

    it('stays disabled, keeps identifies queued and does not retry when protected init rejects', async () => {
      analytics.initWithEventSanitizer.mockRejectedValue(new Error(`setup failed for /meetings/abc?password=${SECRET}`));
      service.identifyUser(AUTH0_USER);

      await waitForAnalytics();
      await waitForAnalytics();
      service.trackPage('page');
      service.trackEvent('event');

      expect(analytics.initWithEventSanitizer).toHaveBeenCalledTimes(1);
      expect(analytics.init).not.toHaveBeenCalled();
      expect(analytics.identifyAuth0User).not.toHaveBeenCalled();
      expect(analytics.page).not.toHaveBeenCalled();
      expect(analytics.track).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('LfxSegmentsAnalytics protected initialization failed; Segment tracking disabled');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET);
    });
  });

  describe('route tracking', () => {
    const navigate = async (url: string): Promise<void> => {
      history.replaceState(null, '', url);
      routerEvents.next(new NavigationEnd(1, url, url));
      // Page tracking waits one microtask for the router title strategy.
      await Promise.resolve();
    };

    beforeEach(async () => {
      await waitForAnalytics();
      service['setupRouteTracking']();
    });

    it('sends no passcode, other query params or hash in the page name or properties', async () => {
      vi.spyOn(document, 'referrer', 'get').mockReturnValue(`https://app.lfx.example/dashboard?token=${SECRET}#h`);
      document.title = 'Meeting | LFX';

      await navigate(`/meetings/abc?password=${SECRET}#frag`);

      expect(analytics.page).toHaveBeenCalledWith('abc', {
        path: '/meetings/abc',
        url: `${window.location.origin}/meetings/abc`,
        search: '',
        title: 'Meeting | LFX',
        referrer: 'https://app.lfx.example/dashboard',
      });
      expect(JSON.stringify(analytics.page.mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify(analytics.page.mock.calls)).not.toContain('password');
    });

    it('retains utm params in url and search', async () => {
      await navigate(`/meetings/abc?password=${SECRET}&utm_source=newsletter`);

      expect(analytics.page).toHaveBeenCalledWith(
        'abc',
        expect.objectContaining({
          path: '/meetings/abc',
          url: `${window.location.origin}/meetings/abc?utm_source=newsletter`,
          search: '?utm_source=newsletter',
        })
      );
    });

    it('names the root page Home', async () => {
      await navigate('/');

      expect(analytics.page).toHaveBeenCalledWith('Home', expect.objectContaining({ path: '/' }));
    });

    it('sends no page while impersonating', async () => {
      service.setImpersonating(true);

      await navigate('/meetings/abc');

      expect(analytics.page).not.toHaveBeenCalled();
    });
  });

  describe('impersonation suppression', () => {
    beforeEach(async () => {
      await waitForAnalytics();
      service.setImpersonating(true);
    });

    it('suppresses page, track and identify', () => {
      service.trackPage('page');
      service.trackEvent('event');
      service.identifyUser(AUTH0_USER);

      expect(analytics.page).not.toHaveBeenCalled();
      expect(analytics.track).not.toHaveBeenCalled();
      expect(analytics.identifyAuth0User).not.toHaveBeenCalled();
    });
  });
});
