// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { NewsletterAnalytics, NewsletterChartData } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, EMPTY, finalize, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-analytics',
  imports: [DatePipe, CardComponent, ChartComponent, EmptyStateComponent, SkeletonModule],
  templateUrl: './newsletter-analytics.component.html',
  styleUrl: './newsletter-analytics.component.scss',
})
export class NewsletterAnalyticsComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly newsletterService = inject(NewsletterService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Signals ===
  protected readonly analytics = signal<NewsletterAnalytics | null>(null);
  protected readonly loading = signal<boolean>(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly canRenderChart = signal<boolean>(false);

  // === Computed (complex bodies extracted to private init* methods) ===
  protected readonly openRatePercent: Signal<number | null> = this.initOpenRatePercent();
  protected readonly hasOpens = computed(() => (this.analytics()?.total_opens ?? 0) > 0);
  // Upstream can return a non-zero `total_opens` rollup with an empty `daily_opens`
  // (e.g. shortly after send, before the daily bucketing job completes). Gate the
  // chart on real per-day data so we never render an empty axis with no series.
  protected readonly hasDailyBreakdown = computed(() => (this.analytics()?.daily_opens?.length ?? 0) > 0);
  protected readonly chartData: Signal<NewsletterChartData | null> = this.initChartData();
  protected readonly chartOptions: Signal<Record<string, unknown>> = this.initChartOptions();

  public constructor() {
    // Lazy chart rendering on the browser only — Chart.js touches `window` on init.
    if (isPlatformBrowser(this.platformId)) {
      this.canRenderChart.set(true);
    }

    // Wait for both the route param and ProjectContextService to hydrate
    // before fetching. On a deep link to `/projects/:slug/newsletters/:id/analytics`,
    // the paramMap can fire before the lens / persona resolution lands —
    // reading activeContextUid() synchronously inside switchMap would surface
    // a permanent "Missing project context" because paramMap doesn't re-emit.
    // Combining with the context signal re-runs the switchMap when context
    // becomes available.
    combineLatest([this.route.paramMap, toObservable(this.projectContextService.activeContextUid)])
      .pipe(
        switchMap(([params, projectUid]) => {
          const id = params.get('id');
          if (!id) {
            this.loading.set(false);
            this.loadError.set('Missing newsletter id.');
            return of(null);
          }
          if (!projectUid) {
            // Keep the skeleton up while context is still pending — emitting
            // a typed value here would set analytics to null and flash the
            // empty-state surface.
            this.loading.set(true);
            this.loadError.set(null);
            return EMPTY;
          }
          this.loading.set(true);
          this.loadError.set(null);
          return this.newsletterService.getAnalytics(projectUid, id).pipe(
            take(1),
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err?.error?.message || err?.message || 'Could not load analytics. Please try again.');
              this.messageService.add({
                severity: 'error',
                summary: 'Could not load analytics',
                detail: this.loadError() ?? '',
              });
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((data) => {
        this.analytics.set(data);
      });
  }

  // `['..']` on a 2-segment route resolves to `/<id>` — anchor to route.parent + explicit 'list' child.
  // Analytics is only reachable from the Sent tab, so anchor Back there explicitly.
  protected goBack(): void {
    this.router.navigate(['list'], {
      relativeTo: this.route.parent,
      queryParams: { tab: 'sent' },
    });
  }

  private initOpenRatePercent(): Signal<number | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a) return null;
      return Math.round((a.open_rate ?? 0) * 100);
    });
  }

  private initChartData(): Signal<NewsletterChartData | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a || !this.canRenderChart()) return null;
      return {
        labels: a.daily_opens.map((d) => d.date),
        datasets: [
          {
            label: 'Total opens',
            data: a.daily_opens.map((d) => d.opens),
            borderColor: lfxColors.blue[600],
            backgroundColor: this.alpha(lfxColors.blue[500], 0.1),
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Unique opens',
            data: a.daily_opens.map((d) => d.unique_opens),
            borderColor: lfxColors.emerald[500],
            backgroundColor: this.alpha(lfxColors.emerald[500], 0.1),
            tension: 0.3,
            fill: true,
          },
        ],
      };
    });
  }

  private initChartOptions(): Signal<Record<string, unknown>> {
    return computed(() => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' as const },
        tooltip: { mode: 'index' as const, intersect: false },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    }));
  }

  // Chart.js expects an rgba string for area fills; lfxColors entries are #RRGGBB.
  // Convert the hex to its rgb components and apply the alpha inline.
  private alpha(hex: string, opacity: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
}
