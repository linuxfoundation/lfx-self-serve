// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import {
  createHorizontalBarChartOptions,
  DASHBOARD_TOOLTIP_CONFIG,
  HEALTH_METRICS_FLYWHEEL_CONVERSION_DECIMAL_PLACES,
  lfxColors,
} from '@lfx-one/shared/constants';
import { buildFlywheelCardSummary, buildFlywheelFunnelStages, formatNumber, selectFlywheelBannerView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { catchError, filter, finalize, map, of, switchMap, tap } from 'rxjs';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FlywheelCardSummaryView,
  FlywheelConversionResponse,
  FlywheelHealthMetricsBannerView,
  FlywheelHealthMetricsFunnelStage,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

const CONVERSION_PRECISION = HEALTH_METRICS_FLYWHEEL_CONVERSION_DECIMAL_PLACES;

@Component({
  selector: 'lfx-flywheel-conversion-card',
  standalone: true,
  imports: [ChartComponent, SkeletonModule],
  templateUrl: './flywheel-conversion-card.component.html',
  styleUrl: './flywheel-conversion-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlywheelConversionCardComponent {
  private readonly elementRef = inject(ElementRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  // TODO: wire range through to server once dbt NORTH_STAR_FLYWHEEL_CONVERSION supports range columns
  public readonly range = input<HealthMetricsRange>('YTD');

  // === Internal State ===
  protected readonly loading = signal(true);
  private readonly data: Signal<FlywheelConversionResponse | null> = this.initDataFromServer();

  // === Computed Signals ===
  protected readonly summary: Signal<FlywheelCardSummaryView | null> = computed(() => buildFlywheelCardSummary(this.data()));

  protected readonly funnelStages: Signal<FlywheelHealthMetricsFunnelStage[]> = computed(() => buildFlywheelFunnelStages(this.data()));

  protected readonly banner: Signal<FlywheelHealthMetricsBannerView | null> = computed(() => selectFlywheelBannerView(this.data()));

  protected readonly hasFlywheelData: Signal<boolean> = computed(() => {
    const payload = this.data();
    if (!payload) return false;
    const attendees = payload.funnel?.eventAttendees ?? 0;
    const totalReengaged = payload.reengagement?.totalReengaged ?? 0;
    const monthlyCount = payload.monthlyData?.length ?? 0;
    return (payload.conversionRate ?? 0) > 0 || attendees > 0 || totalReengaged > 0 || monthlyCount > 0;
  });

  /** Current conversion rate formatted to two decimal places (e.g. "12.34%"). */
  protected readonly formattedCurrentConversion: Signal<string> = computed(() => {
    const summary = this.summary();
    if (!summary) return '—';
    return `${summary.currentConversionRate.toFixed(CONVERSION_PRECISION)}%`;
  });

  /** Signed change percentage formatted for display (e.g. "+0.99%", "-4.61%"). */
  protected readonly formattedChangePercentage: Signal<string> = computed(() => {
    const summary = this.summary();
    if (!summary) return '';
    const sign = summary.changePercentage >= 0 ? '+' : '-';
    return `${sign}${Math.abs(summary.changePercentage).toFixed(CONVERSION_PRECISION)}%`;
  });

  /** Previous-period conversion rate formatted to two decimal places. */
  protected readonly formattedPreviousConversion: Signal<string> = computed(() => {
    const summary = this.summary();
    if (!summary) return '—';
    return `${summary.previousPeriodConversionRate.toFixed(CONVERSION_PRECISION)}%`;
  });

  /** Chart.js data for the funnel horizontal bar chart. */
  protected readonly funnelChartData: Signal<ChartData<'bar'>> = computed(() => {
    const stages = this.funnelStages();
    return {
      labels: stages.map((s) => s.label),
      datasets: [
        {
          data: stages.map((s) => s.count),
          backgroundColor: [
            lfxColors.blue[700],
            lfxColors.blue[600],
            lfxColors.blue[500],
            lfxColors.blue[400],
            lfxColors.blue[400],
            lfxColors.blue[300],
            lfxColors.blue[300],
          ],
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: 'start',
        },
      ],
    };
  });

  /** Chart.js options for the funnel horizontal bar chart. */
  protected readonly funnelChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${formatNumber(ctx.parsed.x ?? 0)} people`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[600], font: { size: 12 } },
      },
    },
  });

  // === Protected Methods ===
  protected downloadCard(): void {
    if (this.loading() || !this.hasFlywheelData()) return;
    downloadCardAsImage(this.elementRef.nativeElement, 'flywheel-conversion-rate');
  }

  private initDataFromServer(): Signal<FlywheelConversionResponse | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal<FlywheelConversionResponse | null>(null);
    }
    return toSignal(
      toObservable(this.projectContextService.selectedFoundation).pipe(
        map((foundation) => foundation?.slug || ''),
        filter((slug): slug is string => !!slug),
        tap(() => this.loading.set(true)),
        switchMap((slug) =>
          this.analyticsService.getFlywheelConversion(slug).pipe(
            catchError(() => of(null)),
            finalize(() => this.loading.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }
}
