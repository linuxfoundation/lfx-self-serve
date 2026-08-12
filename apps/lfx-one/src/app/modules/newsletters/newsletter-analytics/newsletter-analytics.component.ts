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
import { TableComponent } from '@components/table/table.component';
import { lfxColors, NEWSLETTER_TOP_LINKS_LIMIT } from '@lfx-one/shared/constants';
import { NewsletterAnalytics, NewsletterChartData, NewsletterLinkRow } from '@lfx-one/shared/interfaces';
import { normalizeToUrl } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, of, switchMap, take } from 'rxjs';

import { NewsletterFailedRecipientsDrawerComponent } from '../components/newsletter-failed-recipients-drawer/newsletter-failed-recipients-drawer.component';
import { NewsletterRecipientEngagementComponent } from '../components/newsletter-recipient-engagement/newsletter-recipient-engagement.component';

@Component({
  selector: 'lfx-newsletter-analytics',
  imports: [
    DatePipe,
    CardComponent,
    ChartComponent,
    EmptyStateComponent,
    TableComponent,
    SkeletonModule,
    NewsletterFailedRecipientsDrawerComponent,
    NewsletterRecipientEngagementComponent,
  ],
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
  protected readonly failedDrawerVisible = signal<boolean>(false);
  // Route params, retained for the recipient engagement child component's inputs.
  protected readonly projectUid = signal<string>('');
  protected readonly newsletterId = signal<string>('');

  // === Computed (complex bodies extracted to private init* methods) ===
  protected readonly openRatePercent: Signal<number | null> = this.initOpenRatePercent();
  protected readonly hasOpens = computed(() => (this.analytics()?.total_opens ?? 0) > 0);
  // Upstream can return a non-zero `total_opens` rollup with an empty `daily_opens`
  // (e.g. shortly after send, before the daily bucketing job completes). Gate the
  // chart on real per-day data so we never render an empty axis with no series.
  protected readonly hasDailyBreakdown = computed(() => (this.analytics()?.daily_opens?.length ?? 0) > 0);
  protected readonly chartData: Signal<NewsletterChartData | null> = this.initChartData();
  // Shared by both the opens and clicks charts — the config closes over nothing
  // chart-specific (legend, tooltip mode, zero-based y-axis), so a single computed
  // keeps the two visually identical instead of letting a duplicate drift.
  protected readonly chartOptions: Signal<Record<string, unknown>> = this.initChartOptions();

  // Click metrics (lfx-v2-newsletter-service PR #76) are SendGrid-only: an
  // email-service (SES) newsletter always reports zeros/empty arrays, and
  // `send_provider` isn't exposed on any public DTO, so we can't distinguish
  // "unmeasurable" from "zero clicks". Every click UI element is gated on this
  // single rule so the page looks identical to today whenever it's false.
  protected readonly hasClickData = computed(() => {
    const a = this.analytics();
    if (!a) return false;
    return (a.total_clicks ?? 0) > 0 || (a.unique_clicks ?? 0) > 0 || (a.daily_clicks?.length ?? 0) > 0 || (a.top_links?.length ?? 0) > 0;
  });
  protected readonly clickRatePercent: Signal<number | null> = this.initClickRatePercent();
  protected readonly clickToOpenRatePercent: Signal<number | null> = this.initClickToOpenRatePercent();
  // Distinct from hasDailyBreakdown: upstream derives daily_clicks from a separate
  // event query than daily_opens, so a day present in one series can be absent
  // from the other. Reusing hasDailyBreakdown would render an empty clicks axis.
  protected readonly hasDailyClickBreakdown = computed(() => (this.analytics()?.daily_clicks?.length ?? 0) > 0);
  protected readonly clickChartData: Signal<NewsletterChartData | null> = this.initClickChartData();
  protected readonly topLinkRows: Signal<NewsletterLinkRow[]> = this.initTopLinkRows();
  protected readonly topLinksLimit = NEWSLETTER_TOP_LINKS_LIMIT;

  public constructor() {
    // Lazy chart rendering on the browser only — Chart.js touches `window` on init.
    if (isPlatformBrowser(this.platformId)) {
      this.canRenderChart.set(true);
    }

    // Read project_uid and newsletter id from the route. Both are required
    // segments per newsletters.routes.ts, so we don't need to wait for any
    // ambient context to hydrate — the URL carries everything we need.
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const id = params.get('id');
          const projectUid = params.get('projectUid');
          if (!id || !projectUid) {
            this.loading.set(false);
            this.loadError.set('Missing newsletter id or project.');
            return of(null);
          }
          this.projectUid.set(projectUid);
          this.newsletterId.set(id);
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

  protected openFailedDrawer(): void {
    this.failedDrawerVisible.set(true);
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

  private initClickRatePercent(): Signal<number | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a) return null;
      return Math.round((a.click_rate ?? 0) * 100);
    });
  }

  private initClickToOpenRatePercent(): Signal<number | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a) return null;
      // Clamp client-side too: upstream clamps click_to_open_rate to 1.0, but a
      // stale/partial rollup can still report a raw value above 1 (clicks recorded
      // before the matching opens land), which would otherwise render e.g. "112%".
      return Math.round(Math.min(a.click_to_open_rate ?? 0, 1) * 100);
    });
  }

  private initClickChartData(): Signal<NewsletterChartData | null> {
    return computed(() => {
      const a = this.analytics();
      if (!a || !this.canRenderChart()) return null;
      // Own labels, never index-aligned with the opens chart's daily_opens: upstream
      // builds daily_clicks from a separate event query, so a day present in one
      // series can be absent from the other (e.g. an image-blocked clicker produces
      // a click-only day with no matching open bucket).
      const daily = a.daily_clicks ?? [];
      return {
        labels: daily.map((d) => d.date),
        datasets: [
          {
            label: 'Total clicks',
            data: daily.map((d) => d.clicks),
            borderColor: lfxColors.violet[600],
            backgroundColor: this.alpha(lfxColors.violet[500], 0.1),
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Unique clicks',
            data: daily.map((d) => d.unique_clicks),
            borderColor: lfxColors.amber[500],
            backgroundColor: this.alpha(lfxColors.amber[500], 0.1),
            tension: 0.3,
            fill: true,
          },
        ],
      };
    });
  }

  private initTopLinkRows(): Signal<NewsletterLinkRow[]> {
    return computed(() => {
      const links = this.analytics()?.top_links ?? [];
      // Defensive slice: upstream already caps at NEWSLETTER_TOP_LINKS_LIMIT, but
      // mirroring the cap here keeps the display note and the rendered rows from
      // ever drifting apart if that upstream guarantee ever changes.
      return links.slice(0, NEWSLETTER_TOP_LINKS_LIMIT).map((link) => ({
        ...link,
        href: normalizeToUrl(link.url),
      }));
    });
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
