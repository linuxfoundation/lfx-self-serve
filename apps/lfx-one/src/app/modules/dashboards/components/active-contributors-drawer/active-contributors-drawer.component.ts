// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { SelectComponent } from '@components/select/select.component';
import { DEFAULT_FOUNDATION_ACTIVE_CONTRIBUTORS_MONTHLY, DEFAULT_FOUNDATION_CONTRIBUTORS_DISTRIBUTION, lfxColors } from '@lfx-one/shared/constants';
import { hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, forkJoin, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FoundationActiveContributorsMonthlyResponse,
  FoundationContributorsDistributionResponse,
  UniqueContributorsDailyResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-active-contributors-drawer',
  imports: [DrawerModule, ChartComponent, SelectComponent, ReactiveFormsModule, InsightsHandoffSectionComponent],
  templateUrl: './active-contributors-drawer.component.html',
})
export class ActiveContributorsDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  protected readonly timeRangeOptions = [{ label: 'Last 12 months', value: 'last-12-months' }];

  protected readonly trendChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} contributors`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { line: { tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 } },
  };

  protected readonly distributionChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` Share: ${(ctx.parsed.y as number).toFixed(1)}%`,
          afterLabel: (ctx) => {
            const band = this.distributionData().distribution[ctx.dataIndex];
            return band ? ` ${band.contributorCount.toLocaleString()} contributors` : '';
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4 },
      },
      y: {
        display: true,
        title: { display: true, text: 'Contribution Share', color: lfxColors.gray[500], font: { size: 11 } },
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4, callback: (v) => `${v}%` },
      },
    },
    datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7 } },
  };

  // === Forms ===
  protected readonly headerForm: FormGroup = this.fb.group({
    timeRange: [{ value: 'last-12-months', disabled: true }],
  });

  // === Inputs ===
  public readonly data = input<UniqueContributorsDailyResponse>({ data: [], avgContributors: 0, totalDays: 0 });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals ===
  protected readonly metricValue: Signal<string> = computed(() => this.data().avgContributors.toLocaleString());
  protected readonly hasData: Signal<boolean> = computed(() => this.data().avgContributors > 0);

  private readonly drawerData = this.initDrawerData();
  protected readonly monthlyTrendData: Signal<FoundationActiveContributorsMonthlyResponse> = computed(() => this.drawerData().monthly);
  protected readonly distributionData: Signal<FoundationContributorsDistributionResponse> = computed(() => this.drawerData().distribution);
  protected readonly hasTrendData: Signal<boolean> = computed(() => this.monthlyTrendData().monthlyData.length > 0);
  protected readonly hasDistributionData: Signal<boolean> = computed(() => this.distributionData().distribution.length > 0);

  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly distributionChartData: Signal<ChartData<'bar'>> = this.initDistributionChartData();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<{ monthly: FoundationActiveContributorsMonthlyResponse; distribution: FoundationContributorsDistributionResponse }> {
    const defaultValue = { monthly: DEFAULT_FOUNDATION_ACTIVE_CONTRIBUTORS_MONTHLY, distribution: DEFAULT_FOUNDATION_CONTRIBUTORS_DISTRIBUTION };
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          if (!isVisible) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          this.drawerLoading.set(true);
          const slug = this.projectContextService.selectedFoundation()?.slug ?? '';
          if (!slug) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          return forkJoin({
            monthly: this.analyticsService.getFoundationActiveContributorsMonthly(slug),
            distribution: this.analyticsService.getFoundationContributorsDistribution(slug),
          }).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initTrendChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.monthlyTrendData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[400], 0.2),
            fill: true,
          },
        ],
      };
    });
  }

  private initDistributionChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { distribution } = this.distributionData();
      const bandColors: Record<string, string> = {
        'Top 10%': '#475569',
        'Next 40%': '#64748b',
        'Bottom 50%': '#94a3b8',
      };
      return {
        labels: distribution.map((d) => `${d.band} contributors`),
        datasets: [
          {
            data: distribution.map((d) => d.contributionSharePercentage),
            backgroundColor: distribution.map((d) => bandColors[d.band] ?? lfxColors.gray[400]),
            borderRadius: 4,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
