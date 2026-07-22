// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { ChartComponent } from '@components/chart/chart.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { InsightsHandoffSectionComponent } from '@components/insights-handoff-section/insights-handoff-section.component';
import {
  DEFAULT_FOUNDATION_HEALTH_SCORE_DISTRIBUTION,
  DEFAULT_FOUNDATION_PROJECTS_DETAIL,
  lfxColors,
  PROJECT_HEALTH_CATEGORY_BADGE,
  PROJECT_HEALTH_CATEGORY_LABEL,
  PROJECT_HEALTH_CHART_CATEGORIES,
  PROJECT_HEALTH_CHART_CATEGORY_COLOR,
  PROJECT_HEALTH_CHART_CATEGORY_LABEL,
  PROJECT_HEALTH_SCORE_CATEGORIES,
  PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE,
  PROJECT_HEALTH_STATUS_FILTER_OPTIONS,
  PROJECT_HEALTH_UNSCORED_BADGE,
} from '@lfx-one/shared/constants';
import { buildLensAwareInsightsUrl, buildVisiblePages } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FoundationHealthScore,
  FoundationHealthScoreDistributionResponse,
  FoundationProjectsDetailResponse,
  HealthStatusFilterValue,
  ProjectTableRow,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-project-health-scores-drawer',
  imports: [
    DrawerModule,
    ChartComponent,
    InsightsHandoffSectionComponent,
    TooltipModule,
    InputTextComponent,
    ButtonComponent,
    ReactiveFormsModule,
    DecimalPipe,
    NgClass,
  ],
  templateUrl: './project-health-scores-drawer.component.html',
})
export class ProjectHealthScoresDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  // The 5 scored categories, used for the table's status badges/filters.
  protected readonly categories = PROJECT_HEALTH_SCORE_CATEGORIES;
  protected readonly categoryBadge = PROJECT_HEALTH_CATEGORY_BADGE;
  protected readonly categoryLabel = PROJECT_HEALTH_CATEGORY_LABEL;
  // The 6 chart bars (leading Unscored + 5 scored), used for the chart and its legend so the
  // legend always matches what the bars actually show.
  protected readonly chartCategories = PROJECT_HEALTH_CHART_CATEGORIES;
  protected readonly chartCategoryLabel = PROJECT_HEALTH_CHART_CATEGORY_LABEL;
  protected readonly chartColor = PROJECT_HEALTH_CHART_CATEGORY_COLOR;
  protected readonly unscoredBadge = PROJECT_HEALTH_UNSCORED_BADGE;
  protected readonly statusFilterOptions = PROJECT_HEALTH_STATUS_FILTER_OPTIONS;

  protected readonly chartOptions: ChartOptions<'bar'> = {
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
        displayColors: true,
        callbacks: {
          title: (items) => {
            const category = PROJECT_HEALTH_CHART_CATEGORIES[items[0]?.dataIndex ?? 0];
            return PROJECT_HEALTH_CHART_CATEGORY_LABEL[category];
          },
          label: (ctx) => `${(ctx.parsed.y as number).toLocaleString()} projects`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300], width: 1 },
        ticks: { color: lfxColors.gray[600], font: { size: 12 }, padding: 4 },
      },
      y: {
        display: true,
        title: { display: true, text: 'Projects', color: lfxColors.gray[500], font: { size: 11 } },
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.55, categoryPercentage: 0.7, borderRadius: 4 } },
  };

  // === Forms ===
  protected readonly searchForm: FormGroup = this.fb.group({
    query: [''],
  });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<FoundationHealthScoreDistributionResponse>(DEFAULT_FOUNDATION_HEALTH_SCORE_DISTRIBUTION);

  // True while the parent's foundation health-score distribution request is in flight.
  // The parent zeroes `data`/`total` during this window, so without this gate the header badge and chart would render "no scores" while the independently-loaded projects table can already show scored badges.
  public readonly distributionLoading = input<boolean>(false);

  // Total foundation projects (from FOUNDATION_TOTAL_PROJECTS_MONTHLY) — may exceed
  // the number of scored projects because the two counts come from separate tables.
  public readonly total = input<number>(0);

  // === WritableSignals ===
  protected readonly page = signal(1);
  protected readonly tableLoading = signal(false);
  // Empty set = no filter (show all); otherwise only rows whose status is selected.
  protected readonly selectedStatuses = signal<Set<HealthStatusFilterValue>>(new Set());

  // === Computed Signals ===
  protected readonly insightsUrl: Signal<string> = computed(() =>
    buildLensAwareInsightsUrl(this.projectContextService.activeContext()?.slug, this.projectContextService.isFoundationContext())
  );

  protected readonly scoredProjects: Signal<number> = computed(() => this.initScoredProjects());

  protected readonly scoredLabel: Signal<string> = computed(() => this.initScoredLabel());

  protected readonly hasData: Signal<boolean> = computed(() => this.scoredProjects() > 0);
  // Gates the chart itself: a foundation whose projects are all unscored still has a bar to
  // draw (the leading Unscored bar), so this must not collapse to hasData() (scored-only).
  protected readonly hasChartData: Signal<boolean> = computed(() => this.scoredProjects() > 0 || this.data().unscored > 0);
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => !!this.search().trim() || this.selectedStatuses().size > 0);
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();

  protected readonly search: Signal<string> = this.initSearch();
  protected readonly projectsData: Signal<FoundationProjectsDetailResponse> = this.initProjectsData();
  protected readonly filteredProjects: Signal<ProjectTableRow[]> = this.initFilteredProjects();
  protected readonly totalPages: Signal<number> = computed(() => Math.ceil(this.filteredProjects().length / PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE));
  protected readonly paginatedProjects: Signal<ProjectTableRow[]> = this.initPaginatedProjects();
  protected readonly pageInfo: Signal<string> = this.initPageInfo();
  protected readonly visiblePages: Signal<number[]> = computed(() => buildVisiblePages(this.page(), this.totalPages()));

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected goToPage(page: number): void {
    const total = this.totalPages();
    const clamped = Math.min(Math.max(page, 1), total > 0 ? total : 1);
    this.page.set(clamped);
  }

  protected toggleStatus(value: HealthStatusFilterValue): void {
    this.selectedStatuses.update((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
    this.page.set(1);
  }

  // === Private Initializers ===
  private initScoredProjects(): number {
    const d = this.data();
    return d.excellent + d.healthy + d.stable + d.unsteady + d.critical;
  }

  private initScoredLabel(): string {
    const scored = this.scoredProjects();
    const total = this.total();
    return total > scored ? `${scored.toLocaleString()} of ${total.toLocaleString()} projects scored` : `${scored.toLocaleString()} projects scored`;
  }

  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const d = this.data();
      return {
        labels: PROJECT_HEALTH_CHART_CATEGORIES.map((category) => PROJECT_HEALTH_CHART_CATEGORY_LABEL[category]),
        datasets: [
          {
            data: PROJECT_HEALTH_CHART_CATEGORIES.map((category) => d[category]),
            backgroundColor: PROJECT_HEALTH_CHART_CATEGORIES.map((category) => this.chartColor[category]),
            borderRadius: 4,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }

  private initSearch(): Signal<string> {
    return toSignal(this.searchForm.get('query')!.valueChanges.pipe(tap(() => this.page.set(1))), { initialValue: '' });
  }

  private initProjectsData(): Signal<FoundationProjectsDetailResponse> {
    return toSignal(
      // React to visibility AND the selected foundation so the table reloads when
      // the foundation switches while the drawer is open (chart/totals are parent-driven).
      combineLatest([toObservable(this.visible), toObservable(this.projectContextService.selectedFoundation)]).pipe(
        skip(1),
        switchMap(([isVisible, foundation]) => {
          if (!isVisible) {
            this.tableLoading.set(false);
            return of(DEFAULT_FOUNDATION_PROJECTS_DETAIL);
          }
          const slug = foundation?.slug ?? '';
          if (!slug) {
            this.tableLoading.set(false);
            return of(DEFAULT_FOUNDATION_PROJECTS_DETAIL);
          }
          this.tableLoading.set(true);
          // Reset pagination and filters so stale search/status pills from the
          // previous foundation can't hide the freshly loaded list. Emit so the
          // search signal (sourced only from valueChanges) syncs with the input.
          this.page.set(1);
          this.selectedStatuses.set(new Set());
          this.searchForm.get('query')!.setValue('');
          return this.analyticsService.getFoundationProjectsDetail(slug).pipe(
            tap(() => this.tableLoading.set(false)),
            catchError(() => {
              this.tableLoading.set(false);
              return of(DEFAULT_FOUNDATION_PROJECTS_DETAIL);
            })
          );
        })
      ),
      { initialValue: DEFAULT_FOUNDATION_PROJECTS_DETAIL }
    );
  }

  private initFilteredProjects(): Signal<ProjectTableRow[]> {
    return computed(() => {
      const query = this.search().toLowerCase().trim();
      const statuses = this.selectedStatuses();
      const filtered = this.projectsData().projects.filter((p) => {
        const matchesQuery = !query || p.projectName.toLowerCase().includes(query);
        const matchesStatus = statuses.size === 0 || statuses.has(p.healthScoreCategory ?? 'unscored');
        return matchesQuery && matchesStatus;
      });
      // Sort by health (Excellent → unscored), then most active by 90d commits, to match the design.
      return [...filtered].sort(
        (a, b) => this.healthRank(b.healthScoreCategory) - this.healthRank(a.healthScoreCategory) || b.commitsLast90Days - a.commitsLast90Days
      );
    });
  }

  private initPaginatedProjects(): Signal<ProjectTableRow[]> {
    return computed(() => {
      const start = (this.page() - 1) * PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE;
      return this.filteredProjects().slice(start, start + PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE);
    });
  }

  private initPageInfo(): Signal<string> {
    return computed(() => {
      const filtered = this.filteredProjects();
      const page = this.page();
      const start = (page - 1) * PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE + 1;
      const end = Math.min(page * PROJECT_HEALTH_SCORES_DRAWER_ITEMS_PER_PAGE, filtered.length);
      return `Showing ${start}–${end} of ${filtered.length} projects`;
    });
  }

  // Ordinal rank for sorting; unscored (null) sorts last.
  private healthRank(category: FoundationHealthScore | null): number {
    return category ? PROJECT_HEALTH_SCORE_CATEGORIES.indexOf(category) : -1;
  }
}
