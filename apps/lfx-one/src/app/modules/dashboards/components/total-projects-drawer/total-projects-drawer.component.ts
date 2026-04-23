// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { ChartComponent } from '@components/chart/chart.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  DEFAULT_FOUNDATION_PROJECTS_DETAIL,
  DEFAULT_FOUNDATION_PROJECTS_LIFECYCLE,
  DEFAULT_FOUNDATION_TOTAL_PROJECTS,
  lfxColors,
  TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE,
} from '@lfx-one/shared/constants';
import { buildInsightsUrl, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, forkJoin, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { LifecycleStage } from '@lfx-one/shared/interfaces';
import type {
  FoundationProjectsDetailResponse,
  FoundationProjectsLifecycleDistributionResponse,
  FoundationTotalProjectsResponse,
  ProjectTableRow,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-total-projects-drawer',
  imports: [
    DrawerModule,
    ChartComponent,
    SelectComponent,
    SelectButtonComponent,
    InputTextComponent,
    ButtonComponent,
    ReactiveFormsModule,
    DecimalPipe,
    NgClass,
    InsightsHandoffSectionComponent,
  ],
  templateUrl: './total-projects-drawer.component.html',
})
export class TotalProjectsDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  protected readonly insightsUrl = buildInsightsUrl();
  protected readonly timeRangeOptions = [{ label: 'Last 12 months', value: 'last-12-months' }];
  protected readonly viewOptions = [
    { label: 'Chart', value: 'chart' },
    { label: 'Table', value: 'table' },
  ];

  // === Forms ===
  protected readonly headerForm: FormGroup = this.fb.group({
    timeRange: [{ value: 'last-12-months', disabled: true }],
  });

  protected readonly viewForm: FormGroup = this.fb.group({
    primaryView: ['chart'],
  });

  protected readonly searchForm: FormGroup = this.fb.group({
    query: [''],
  });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FoundationTotalProjectsResponse>(DEFAULT_FOUNDATION_TOTAL_PROJECTS);

  // === Enum exposure for template ===
  protected readonly LifecycleStage = LifecycleStage;

  // === WritableSignals ===
  protected readonly primaryView = signal<'chart' | 'table'>('chart');
  protected readonly primaryPage = signal(1);
  protected readonly drawerLoading = signal(false);
  protected readonly hasData: Signal<boolean> = computed(() => this.data().monthlyData.length > 0);
  protected readonly primarySearch: Signal<string> = this.initPrimarySearch();
  private readonly drawerData = this.initDrawerData();
  protected readonly projectsDetailData: Signal<FoundationProjectsDetailResponse> = computed(() => this.drawerData().projects);
  protected readonly lifecycleDistributionData: Signal<FoundationProjectsLifecycleDistributionResponse> = computed(() => this.drawerData().lifecycle);
  protected readonly primaryFilteredData: Signal<ProjectTableRow[]> = this.initPrimaryFilteredData();
  protected readonly primaryTotalPages: Signal<number> = computed(() => Math.ceil(this.primaryFilteredData().length / TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE));
  protected readonly primaryPaginatedData: Signal<ProjectTableRow[]> = this.initPrimaryPaginatedData();
  protected readonly primaryPageInfo: Signal<string> = this.initPrimaryPageInfo();
  protected readonly primaryVisiblePages: Signal<number[]> = this.initPrimaryVisiblePages();
  protected readonly hasLifecycleData: Signal<boolean> = computed(() => this.lifecycleDistributionData().distribution.some((d) => d.count > 0));
  protected readonly primaryChartData: Signal<ChartData<ChartType>> = this.initPrimaryChartData();
  protected readonly lifecycleChartData: Signal<ChartData<'bar'>> = this.initLifecycleChartData();

  protected readonly primaryChartOptions: ChartOptions<ChartType> = {
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
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} total projects`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { color: lfxColors.gray[100] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxTicksLimit: 6, maxRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[100] },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
      },
    },
    datasets: { line: { tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 } },
  };

  private readonly lifecycleColorMap: Record<string, string> = {
    [LifecycleStage.Sandbox]: lfxColors.violet[500],
    [LifecycleStage.Incubating]: lfxColors.blue[500],
    [LifecycleStage.Graduated]: lfxColors.emerald[500],
  };

  protected readonly barChartSectionOptions: ChartOptions<'bar'> = {
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
        grid: { color: lfxColors.gray[200] },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4 },
      },
    },
    datasets: { bar: { barPercentage: 0.7, categoryPercentage: 0.8 } },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected onPrimaryViewChange(event: { value: 'chart' | 'table' }): void {
    if (event.value) {
      this.primaryView.set(event.value);
    }
  }

  protected goToPrimaryPage(page: number): void {
    this.primaryPage.set(page);
  }

  // === Private Initializers ===
  private initPrimarySearch(): Signal<string> {
    return toSignal(this.searchForm.get('query')!.valueChanges.pipe(tap(() => this.primaryPage.set(1))), { initialValue: '' });
  }

  private initDrawerData(): Signal<{ projects: FoundationProjectsDetailResponse; lifecycle: FoundationProjectsLifecycleDistributionResponse }> {
    const defaultValue = { projects: DEFAULT_FOUNDATION_PROJECTS_DETAIL, lifecycle: DEFAULT_FOUNDATION_PROJECTS_LIFECYCLE };
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
            projects: this.analyticsService.getFoundationProjectsDetail(slug),
            lifecycle: this.analyticsService.getFoundationProjectsLifecycleDistribution(slug),
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

  private initPrimaryFilteredData(): Signal<ProjectTableRow[]> {
    return computed(() => {
      const query = this.primarySearch().toLowerCase().trim();
      const projects = this.projectsDetailData().projects;
      if (!query) return projects;
      return projects.filter((p) => p.projectName.toLowerCase().includes(query) || p.lifecycleStage.toLowerCase().includes(query));
    });
  }

  private initPrimaryPaginatedData(): Signal<ProjectTableRow[]> {
    return computed(() => {
      const start = (this.primaryPage() - 1) * TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE;
      return this.primaryFilteredData().slice(start, start + TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE);
    });
  }

  private initPrimaryPageInfo(): Signal<string> {
    return computed(() => {
      const filtered = this.primaryFilteredData();
      const page = this.primaryPage();
      const start = (page - 1) * TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE + 1;
      const end = Math.min(page * TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE, filtered.length);
      return `Showing ${start}–${end} of ${filtered.length} projects`;
    });
  }

  private initPrimaryVisiblePages(): Signal<number[]> {
    return computed(() => {
      const total = this.primaryTotalPages();
      const current = this.primaryPage();
      const count = Math.min(5, total);
      let start: number;

      if (total <= 5) {
        start = 1;
      } else if (current <= 3) {
        start = 1;
      } else if (current >= total - 2) {
        start = total - 4;
      } else {
        start = current - 2;
      }

      return Array.from({ length: count }, (_, i) => start + i);
    });
  }

  private initPrimaryChartData(): Signal<ChartData<ChartType>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.data();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.15),
            fill: true,
          },
        ],
      };
    });
  }

  private initLifecycleChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const distribution = this.lifecycleDistributionData().distribution;
      return {
        labels: distribution.map((d) => d.stage),
        datasets: [
          {
            data: distribution.map((d) => d.count),
            backgroundColor: distribution.map((d) => this.lifecycleColorMap[d.stage] ?? lfxColors.gray[400]),
            borderRadius: 4,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
