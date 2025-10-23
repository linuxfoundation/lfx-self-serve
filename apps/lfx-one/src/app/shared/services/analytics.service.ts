// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { LfxSegmentAnalytics, LfxSegmentAnalyticsClass } from '@lfx-one/shared/interfaces';
import { filter } from 'rxjs';

declare global {
  interface Window {
    LfxAnalytics?: {
      LfxSegmentsAnalytics: LfxSegmentAnalyticsClass;
    };
  }
}

/**
 * Analytics service for Segment integration
 * Uses Angular 19's afterNextRender for SSR-safe script loading
 */
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private scriptLoaded = false;
  private analyticsReady = false;
  private analytics?: LfxSegmentAnalytics;
  private identifyQueue: Array<{ user: unknown }> = [];

  /**
   * Initialize the analytics service - should be called from app component
   */
  public initialize(): void {
    // SSR-safe initialization using afterNextRender
    afterNextRender(() => {
      this.loadSegmentScript();
      this.setupRouteTracking();
    });
  }

  /**
   * Track a page view
   * @param pageName Page name
   * @param properties Optional page properties
   */
  public trackPage(pageName: string, properties?: Record<string, unknown>): void {
    if (!this.analyticsReady || !this.analytics) {
      return;
    }

    try {
      this.analytics.page(pageName, properties);
    } catch (error) {
      console.error('Error tracking page with Segment:', error);
    }
  }

  /**
   * Track a custom event
   * @param eventName Event name
   * @param properties Event properties
   */
  public trackEvent(eventName: string, properties?: Record<string, unknown>): void {
    if (!this.analyticsReady || !this.analytics) {
      return;
    }

    try {
      this.analytics.track(eventName, properties);
    } catch (error) {
      console.error('Error tracking event with Segment:', error);
    }
  }

  /**
   * Identify an Auth0 user with Segment
   * @param auth0User Auth0 user object
   */
  public identifyUser(auth0User: unknown): void {
    if (!auth0User) {
      return;
    }

    // If analytics is not ready yet, queue the identify call
    if (!this.analyticsReady || !this.analytics) {
      this.identifyQueue.push({ user: auth0User });
      return;
    }

    try {
      this.analytics.identifyAuth0User(auth0User);
    } catch (error) {
      console.error('Error identifying user with Segment:', error);
    }
  }

  /**
   * Load Segment script from CDN
   */
  private loadSegmentScript(): void {
    if (!environment.segment?.enabled || this.scriptLoaded) {
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = environment.segment.cdnUrl;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.scriptLoaded = true;
        this.waitForAnalytics();
      };

      script.onerror = (error) => {
        console.error('Failed to load Segment analytics script:', error);
      };

      document.head.appendChild(script);
    } catch (error) {
      console.error('Error initializing Segment:', error);
    }
  }

  /**
   * Wait for analytics object to be available and initialize it
   */
  private async waitForAnalytics(): Promise<void> {
    const maxAttempts = 100; // 10 seconds max wait
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (window?.LfxAnalytics?.LfxSegmentsAnalytics) {
        this.analytics = window.LfxAnalytics.LfxSegmentsAnalytics.getInstance();

        try {
          await this.analytics.init();
          this.analyticsReady = true;

          // Process any queued identify calls
          this.processIdentifyQueue();
          return;
        } catch (error) {
          console.error('Error initializing LfxSegmentsAnalytics:', error);
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    console.error('LfxSegmentsAnalytics not available after timeout');
  }

  /**
   * Process queued identify calls
   */
  private processIdentifyQueue(): void {
    while (this.identifyQueue.length > 0) {
      const item = this.identifyQueue.shift();
      if (item) {
        this.identifyUser(item.user);
      }
    }
  }

  /**
   * Set up automatic page tracking on route navigation
   */
  private setupRouteTracking(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event: NavigationEnd) => {
        const pageName = event.urlAfterRedirects.split('/').pop() || 'Home';
        this.trackPage(pageName, {
          path: event.urlAfterRedirects,
          url: window.location.href,
          title: document.title,
        });
      });
  }
}
