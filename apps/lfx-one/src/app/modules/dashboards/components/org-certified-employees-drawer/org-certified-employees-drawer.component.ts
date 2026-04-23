// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { hexToRgba, wrapLabel } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, forkJoin, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type { OrgCertifiedEmployeesDistributionResponse, OrgCertifiedEmployeesMonthlyResponse } from '@lfx-one/shared/interfaces';

const DEFAULT_MONTHLY: OrgCertifiedEmployeesMonthlyResponse = { monthlyData: [], monthlyLabels: [], totalCertifiedEmployees: 0 };
const DEFAULT_DISTRIBUTION: OrgCertifiedEmployeesDistributionResponse = { programs: [] };

@Component({
  selector: 'lfx-org-certified-employees-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './org-certified-employees-drawer.component.html',
})
export class OrgCertifiedEmployeesDrawerComponent {
  // === Services ===
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Chart Options ===
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
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} certified employees`,
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
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} employees`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4, maxRotation: 0, minRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7, borderRadius: 4, borderSkipped: 'start' } },
  };

  // === Computed Signals ===
  private readonly drawerData = this.initDrawerData();
  protected readonly monthlyData: Signal<OrgCertifiedEmployeesMonthlyResponse> = computed(() => this.drawerData().monthly);
  protected readonly distributionData: Signal<OrgCertifiedEmployeesDistributionResponse> = computed(() => this.drawerData().distribution);
  protected readonly hasTrendData: Signal<boolean> = computed(() => this.monthlyData().monthlyData.length > 0);
  protected readonly hasDistributionData: Signal<boolean> = computed(() => this.distributionData().programs.length > 0);

  protected readonly trendChartData: Signal<ChartData<'line'>> = this.initTrendChartData();
  protected readonly distributionChartData: Signal<ChartData<'bar'>> = this.initDistributionChartData();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<{ monthly: OrgCertifiedEmployeesMonthlyResponse; distribution: OrgCertifiedEmployeesDistributionResponse }> {
    const defaultValue = { monthly: DEFAULT_MONTHLY, distribution: DEFAULT_DISTRIBUTION };
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          if (!isVisible) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          this.drawerLoading.set(true);
          const accountId = this.accountContextService.selectedAccount().accountId;
          const foundationSlug = this.projectContextService.selectedFoundation()?.slug ?? '';

          if (!accountId || !foundationSlug) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }

          return forkJoin({
            monthly: this.analyticsService.getOrgCertifiedEmployeesMonthly(accountId, foundationSlug),
            distribution: this.analyticsService.getOrgCertifiedEmployeesDistribution(accountId, foundationSlug),
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
      const { monthlyData, monthlyLabels } = this.monthlyData();
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
      const { programs } = this.distributionData();
      return {
        labels: programs.map((p) => wrapLabel(p.certificationBucket, 14)),
        datasets: [
          {
            data: programs.map((p) => p.certifiedEmployeeCount),
            backgroundColor: lfxColors.violet[500],
          },
        ],
      };
    });
  }
}
