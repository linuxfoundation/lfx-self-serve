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
import { MetricDeltaComponent } from '@components/metric-delta/metric-delta.component';
import { SelectComponent } from '@components/select/select.component';
import {
  DEFAULT_FOUNDATION_PROJECTS_DETAIL,
  DEFAULT_FOUNDATION_PROJECTS_LIFECYCLE,
  DEFAULT_FOUNDATION_TOTAL_PROJECTS,
  lfxColors,
  TOTAL_PROJECTS_DRAWER_ITEMS_PER_PAGE,
} from '@lfx-one/shared/constants';
import { buildLensAwareInsightsUrl, buildVisiblePages, computePeriodDelta, hexToRgba } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, forkJoin, of, skip, switchMap, tap } from 'rxjs';

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
    InputTextComponent,
    ButtonComponent,
    ReactiveFormsModule,
    DecimalPipe,
    NgClass,
    InsightsHandoffSectionComponent,
    TooltipModule,
    MetricDeltaComponent,
  ],
  templateUrl: './total-projects-drawer.component.html',
})
export class TotalProjectsDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  protected readonly timeRangeOptions = [{ label: 'Last 12 months', value: 'last-12-months' }];

  // === Forms ===
  protected readonly headerForm: FormGroup = this.fb.group({
    timeRange: [{ value: 'last-12-months', disabled: true }],
  });

  protected readonly searchForm: FormGroup = this.fb.group({
    query: [''],
  });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FoundationTotalProjectsResponse>(DEFAULT_FOUNDATION_TOTAL_PROJECTS);

  // True while the parent's foundation total-projects monthly request is in flight.
  // The parent passes its own eager fetch's loading signal so the primary chart can
  // render instantly on click (data already resolved) and only show a spinner during
  // a foundation switch while the drawer is open.
  public readonly dataLoading = input<boolean>(false);

  // === Enum exposure for template ===
  protected readonly LifecycleStage = LifecycleStage;

  // === WritableSignals ===
  protected readonly primaryPage = signal(1);
  protected readonly drawerLoading = signal(false);

  // === Computed Signals ===
  protected readonly insightsUrl: Signal<string> = computed(() =>
    buildLensAwareInsightsUrl(this.projectContextService.activeContext()?.slug, this.projectContextService.isFoundationContext())
  );

  protected readonly hasData: Signal<boolean> = computed(() => this.data().monthlyData.length > 0);
  protected readonly metricValue: Signal<string> = this.initMetricValue();
  protected readonly delta = computed(() => computePeriodDelta(this.data().monthlyData));
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

  protected goToPrimaryPage(page: number): void {
    this.primaryPage.set(page);
  }

  // === Private Initializers ===
  private initMetricValue(): Signal<string> {
    // Guarded by hasData() (monthlyData non-empty) in the template, so the last month is always present.
    return computed(() => {
      const m = this.data().monthlyData;
      return m[m.length - 1].toLocaleString('en-US');
    });
  }

  private initPrimarySearch(): Signal<string> {
    return toSignal(this.searchForm.get('query')!.valueChanges.pipe(tap(() => this.primaryPage.set(1))), { initialValue: '' });
  }

  private initDrawerData(): Signal<{ projects: FoundationProjectsDetailResponse; lifecycle: FoundationProjectsLifecycleDistributionResponse }> {
    const defaultValue = { projects: DEFAULT_FOUNDATION_PROJECTS_DETAIL, lifecycle: DEFAULT_FOUNDATION_PROJECTS_LIFECYCLE };
    return toSignal(
      // React to visibility AND the selected foundation so the drawer reloads when
      // an ED/Admin Mode user switches foundations while the drawer stays open.
      combineLatest([toObservable(this.visible), toObservable(this.projectContextService.selectedFoundation)]).pipe(
        skip(1),
        switchMap(([isVisible, foundation]) => {
          if (!isVisible) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          this.drawerLoading.set(true);
          const slug = foundation?.slug ?? '';
          if (!slug) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          // Reset pagination + search so a stale query/page from the previous
          // foundation can't hide or off-range the freshly loaded list.
          this.primaryPage.set(1);
          this.searchForm.get('query')!.setValue('');
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
      return projects.filter((p) => p.projectName.toLowerCase().includes(query) || (p.lifecycleStage ?? '').toLowerCase().includes(query));
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
    return computed(() => buildVisiblePages(this.primaryPage(), this.primaryTotalPages()));
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
