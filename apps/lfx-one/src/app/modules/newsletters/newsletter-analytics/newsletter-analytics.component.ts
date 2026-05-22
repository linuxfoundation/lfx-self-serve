// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { NewsletterAnalytics, NewsletterChartData } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, of, switchMap, take } from 'rxjs';

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
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Signals ===
  protected readonly analytics = signal<NewsletterAnalytics | null>(null);
  protected readonly loading = signal<boolean>(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly canRenderChart = signal<boolean>(false);

  // === Computed (complex bodies extracted to private init* methods) ===
  protected readonly openRatePercent: Signal<number | null> = this.initOpenRatePercent();
  protected readonly hasOpens = computed(() => (this.analytics()?.totalOpens ?? 0) > 0);
  protected readonly chartData: Signal<NewsletterChartData | null> = this.initChartData();
  protected readonly chartOptions: Signal<Record<string, unknown>> = this.initChartOptions();

  public constructor() {
    // Lazy chart rendering on the browser only — Chart.js touches `window` on init.
    if (isPlatformBrowser(this.platformId)) {
      this.canRenderChart.set(true);
    }

    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const id = params.get('id');
          if (!id) {
            this.loading.set(false);
            this.loadError.set('Missing newsletter id.');
            return of(null);
          }
          this.loading.set(true);
          this.loadError.set(null);
          return this.newsletterService.getAnalytics(id).pipe(
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
  protected goBack(): void {
    this.router.navigate(['list'], { relativeTo: this.route.parent });
  }

  private initOpenRatePercent(): Signal<number | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a) return null;
      return Math.round((a.openRate ?? 0) * 100);
    });
  }

  private initChartData(): Signal<NewsletterChartData | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a || !this.canRenderChart()) return null;
      return {
        labels: a.dailyOpens.map((d) => d.date),
        datasets: [
          {
            label: 'Total opens',
            data: a.dailyOpens.map((d) => d.opens),
            borderColor: lfxColors.blue[600],
            backgroundColor: this.alpha(lfxColors.blue[500], 0.1),
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Unique opens',
            data: a.dailyOpens.map((d) => d.uniqueOpens),
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
