// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { OrgEventSpeakersMonthlyResponse } from '@lfx-one/shared/interfaces';

const DEFAULT_MONTHLY: OrgEventSpeakersMonthlyResponse = { monthlyData: [], monthlyLabels: [], totalSpeakers: 0 };

@Component({
  selector: 'lfx-org-event-speakers-drawer',
  imports: [DrawerModule, ChartComponent, InsightsHandoffSectionComponent],
  templateUrl: './org-event-speakers-drawer.component.html',
})
export class OrgEventSpeakersDrawerComponent {
  // === Services ===
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Chart Options ===
  protected readonly speakersChartOptions: ChartOptions<'bar'> = {
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
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} speakers`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7, borderRadius: 4, borderSkipped: 'start' } },
  };

  // === Computed Signals ===
  private readonly monthlyData = this.initMonthlyData();
  protected readonly hasData: Signal<boolean> = computed(() => this.monthlyData().monthlyData.length > 0);
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initMonthlyData(): Signal<OrgEventSpeakersMonthlyResponse> {
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          if (!isVisible) {
            this.drawerLoading.set(false);
            return of(DEFAULT_MONTHLY);
          }
          this.drawerLoading.set(true);
          const accountId = this.accountContextService.selectedAccount().accountId;
          const foundationSlug = this.projectContextService.selectedFoundation()?.slug ?? '';

          if (!accountId || !foundationSlug) {
            this.drawerLoading.set(false);
            return of(DEFAULT_MONTHLY);
          }

          return this.analyticsService.getOrgEventSpeakersMonthly(accountId, foundationSlug).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              return of(DEFAULT_MONTHLY);
            })
          );
        })
      ),
      { initialValue: DEFAULT_MONTHLY }
    );
  }

  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.monthlyData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            backgroundColor: lfxColors.blue[400],
          },
        ],
      };
    });
  }
}
