// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HEALTH_METRICS_BASE_PATH, HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';

import { HealthMetricsComponent } from '../health-metrics/health-metrics.component';
import { HealthMetricsChromeService } from './health-metrics-chrome.service';

import type { IsActiveMatchOptions } from '@angular/router';
import type { HealthMetricsTab, HealthMetricsYearOption } from '@lfx-one/shared/interfaces';

/**
 * Route target for `foundation/health-metrics`. Renders the legacy page by default (server and
 * client agree on this until the flag resolves) and swaps to the LFXV2-3365 overview page once
 * `health-metrics-overview-enabled` flips true — a signal-driven `@if` inside one stable route,
 * not a router-level component swap, so hydration never has to reconcile two different trees.
 *
 * Accepted trade-off: on a flag-on load the flag still reads false through SSR and hydration, so
 * `HealthMetricsComponent` mounts server-side, its data fetches run to completion there (SSR waits
 * for them before serializing), and the legacy page stays rendered on the client until the flag
 * resolves post-hydration — only then does the swap happen. A `CanMatchFn` awaiting flag
 * readiness (the `org-lens-enabled.guard.ts` pattern) would skip that duplicate legacy render, but
 * it would hold the whole route's client-side render until the provider reports for the ~100% of
 * users the flag is still off for — a worse trade while this page is dark-launched to a small
 * cohort; remove this gate rather than ramping the flag to 100% through it.
 *
 * `overviewEnabled` is forced false until `hydrated` latches true in `afterNextRender` (a no-op on
 * the server, so this never fires there). Without the latch, the non-production localStorage flag
 * override in `FeatureFlagService` reads synchronously ahead of `isInitialized()`, so a pre-seeded
 * override (as e2e helpers for other flags do) would swap pages on the very first client render
 * and mismatch the SSR-rendered legacy DOM.
 *
 * Since LFXV2-3366 the enabled branch is also the tab shell: it owns the sticky header (project,
 * period, export) and the tab bar, with each Level 2 page rendering through `<router-outlet />` as
 * a child route. Selection state is shared through {@link HealthMetricsChromeService}, provided
 * here so it survives tab switches but resets on leaving the page. Nothing renders an outlet while
 * the flag is off, so a direct hit on `…/health-metrics/engagement` still serves the legacy page.
 */
@Component({
  selector: 'lfx-health-metrics-gate',
  imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet, HealthMetricsComponent],
  providers: [HealthMetricsChromeService],
  templateUrl: './health-metrics-gate.component.html',
  styleUrl: './health-metrics-gate.component.scss',
})
export class HealthMetricsGateComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly chrome = inject(HealthMetricsChromeService);

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;
  protected readonly tabs: readonly HealthMetricsTab[] = HEALTH_METRICS_TABS;

  // queryParams must be `ignored` rather than the `{ exact: true }` shorthand's `exact` — the tab
  // links carry no query params of their own while the URL always carries `foundationSlug`.
  protected readonly exactMatch: IsActiveMatchOptions = { paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' };
  protected readonly subsetMatch: IsActiveMatchOptions = { paths: 'subset', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' };

  protected readonly pageHeader = viewChild<ElementRef<HTMLElement>>('pageHeader');

  private headerObserved = false;
  private readonly hydrated = signal(false);
  private readonly rawOverviewEnabled = this.featureFlagService.getBooleanFlag(HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, false);

  protected readonly overviewEnabled = computed(() => this.hydrated() && this.rawOverviewEnabled());

  public constructor() {
    afterNextRender(() => this.hydrated.set(true));
    // The header only exists inside the enabled branch, so it appears a render after `hydrated`
    // latches — watching the viewChild signal picks it up whenever that happens.
    toObservable(this.pageHeader)
      .pipe(takeUntilDestroyed())
      .subscribe((header) => this.observeHeaderHeight(header?.nativeElement));
  }

  protected setPeriod(period: HealthMetricsYearOption): void {
    this.chrome.setPeriod(period);
  }

  private observeHeaderHeight(header: HTMLElement | undefined): void {
    // ResizeObserver is browser-only, and is missing in some client engines too (e.g. jsdom in
    // specs) — guard both per .claude/rules/ssr-safety.md.
    if (!header || this.headerObserved || !isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.headerObserved = true;
    const observer = new ResizeObserver(([entry]) => {
      // contentRect is the content box only (excludes padding/border); this header has vertical
      // padding, so border-box size is required to get its true rendered height. borderBoxSize
      // isn't implemented in every engine (e.g. older Safari/jsdom) — fall back to getBoundingClientRect.
      const height = entry.borderBoxSize?.[0]?.blockSize ?? header.getBoundingClientRect().height;
      this.chrome.headerHeightPx.set(height);
    });
    observer.observe(header);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
