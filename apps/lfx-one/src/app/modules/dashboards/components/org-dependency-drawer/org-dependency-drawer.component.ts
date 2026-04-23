// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { buildLensAwareInsightsUrl } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { FoundationCompanyBusFactorResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-dependency-drawer',
  imports: [DrawerModule, ChartComponent, InsightsHandoffSectionComponent],
  templateUrl: './org-dependency-drawer.component.html',
})
export class OrgDependencyDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly summaryData = input<FoundationCompanyBusFactorResponse>({
    topCompaniesCount: 0,
    topCompaniesPercentage: 0,
    otherCompaniesCount: 0,
    otherCompaniesPercentage: 0,
  });

  // === Computed Signals ===
  protected readonly insightsUrl: Signal<string> = computed(() =>
    buildLensAwareInsightsUrl(this.projectContextService.activeContext()?.slug, this.projectContextService.isFoundationContext(), {
      projectSubPath: 'contributors',
      projectParams: { timeRange: 'alltime', widget: 'organization-dependency' },
    })
  );

  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  protected readonly chartOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
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
          label: (ctx) => ` ${ctx.parsed.x}% contribution share`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        min: 0,
        grid: {
          color: lfxColors.gray[200],
          lineWidth: 1,
        },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 12 },
          callback: (value) => `${value}%`,
        },
        title: {
          display: true,
          text: 'Contribution Share (%)',
          color: lfxColors.gray[500],
          font: { size: 12 },
          padding: { top: 8 },
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[600],
          font: { size: 12 },
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.6, categoryPercentage: 0.9 },
    },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { topCompaniesCount, topCompaniesPercentage, otherCompaniesCount, otherCompaniesPercentage } = this.summaryData();
      return {
        labels: [`${topCompaniesCount} Orgs (${topCompaniesPercentage}%)`, `${otherCompaniesCount} Other Orgs`],
        datasets: [
          {
            data: [topCompaniesPercentage, otherCompaniesPercentage],
            backgroundColor: [lfxColors.blue[500], lfxColors.gray[300]],
            borderRadius: 4,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
