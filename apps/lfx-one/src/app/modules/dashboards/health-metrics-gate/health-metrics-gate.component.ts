// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { NavigationCancel, NavigationEnd, NavigationError, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SelectComponent } from '@components/select/select.component';
import { HEALTH_METRICS_BASE_PATH, HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { buildHealthMetricsYtdRangeLabel } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { filter } from 'rxjs';

import { HealthMetricsComponent } from '../health-metrics/health-metrics.component';
import { HealthMetricsChromeService } from './health-metrics-chrome.service';

import type { IsActiveMatchOptions } from '@angular/router';
import type { HealthMetricsRange, HealthMetricsTab, HealthMetricsTabKey, HealthMetricsYearOption } from '@lfx-one/shared/interfaces';

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
 * readiness (the `org-lens-cla-m3-enabled.guard.ts` pattern) would skip that duplicate legacy render, but
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
 * Since LFXV2-3366 the enabled branch is also the tab shell: it owns the sticky header (title and
 * period) and the tab bar, with each Level 2 page rendering through `<router-outlet />` as a child
 * route. The period is shared through {@link HealthMetricsChromeService}, provided here so it
 * survives tab switches but resets on leaving the page. Nothing renders an outlet while the flag is
 * off, so a direct hit on `…/health-metrics/engagement` still serves the legacy page.
 */
@Component({
  selector: 'lfx-health-metrics-gate',
  imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet, HealthMetricsComponent, SelectComponent],
  providers: [HealthMetricsChromeService],
  templateUrl: './health-metrics-gate.component.html',
  styleUrl: './health-metrics-gate.component.scss',
})
export class HealthMetricsGateComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  protected readonly chrome = inject(HealthMetricsChromeService);
  protected readonly userService = inject(UserService);

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;
  protected readonly tabs: readonly HealthMetricsTab[] = HEALTH_METRICS_TABS;
  protected readonly ytdRangeLabel = buildHealthMetricsYtdRangeLabel(new Date());
  protected readonly periodOptions = [...this.chrome.periods];
  protected readonly tabOptions = [...HEALTH_METRICS_TABS];
  /** The narrow header's dropdown, kept in step with the pill through the shared period. */
  protected readonly periodForm = new FormGroup({ range: new FormControl<HealthMetricsRange>(this.chrome.selectedRange(), { nonNullable: true }) });
  /** The narrowest header's tab dropdown, kept on the routed tab. */
  protected readonly tabForm = new FormGroup({ tab: new FormControl<HealthMetricsTabKey>(this.activeTabKey(this.router.url), { nonNullable: true }) });

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
    this.initPeriodSelect();
    this.initTabSelect();
    // The header only exists inside the enabled branch, so it appears a render after `hydrated`
    // latches — watching the viewChild signal picks it up whenever that happens.
    toObservable(this.pageHeader)
      .pipe(takeUntilDestroyed())
      .subscribe((header) => this.observeHeaderHeight(header?.nativeElement));
  }

  protected setPeriod(period: HealthMetricsYearOption): void {
    this.chrome.setPeriod(period);
  }

  private initPeriodSelect(): void {
    const control = this.periodForm.controls.range;
    effect(() => {
      const range = this.chrome.selectedRange();
      if (control.value !== range) control.setValue(range, { emitEvent: false });
    });
    control.valueChanges.pipe(takeUntilDestroyed()).subscribe((range) => {
      const period = this.chrome.periods.find((option) => option.range === range);
      if (period) this.chrome.setPeriod(period);
    });
  }

  private initTabSelect(): void {
    const control = this.tabForm.controls.tab;
    this.router.events
      .pipe(
        // A cancelled or failed navigation leaves the route where it was, so the dropdown goes back with it.
        filter((event) => event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError),
        takeUntilDestroyed()
      )
      .subscribe(() => control.setValue(this.activeTabKey(this.router.url), { emitEvent: false }));
    control.valueChanges.pipe(takeUntilDestroyed()).subscribe((key) => {
      const tab = this.tabs.find((candidate) => candidate.key === key);
      if (tab) void this.router.navigate(tab.route ? [this.basePath, tab.route] : [this.basePath], { queryParamsHandling: 'preserve' });
    });
  }

  /** The tab a URL routes to: the segment after the base path, or the Overview. */
  private activeTabKey(url: string): HealthMetricsTabKey {
    const path = url.split(/[?#]/)[0];
    const segment = path.startsWith(this.basePath) ? (path.slice(this.basePath.length).split('/')[1] ?? '') : '';
    return (this.tabs.find((tab) => tab.route === segment) ?? this.tabs[0]).key;
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
