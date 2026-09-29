// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS, HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED, lfxColors } from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersTiersView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FilterPillOption,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersMode,
  HealthMetricsMembersTiersQuery,
  HealthMetricsMembersTiersView,
} from '@lfx-one/shared/interfaces';

/**
 * `#tiers` — members and revenue by tier: a hero for the selected period, the tier × year matrix and
 * its composition as shares. One read carries every year, so a period or mode change never re-reads.
 */
@Component({
  selector: 'lfx-members-tiers',
  imports: [ChartComponent, EmptyStateComponent, FilterPillsComponent, Skeleton],
  templateUrl: './members-tiers.component.html',
})
export class MembersTiersComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the tiers settle — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly mode = signal<HealthMetricsMembersTiersMode>(HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS[0].id);
  protected readonly modeOptions: FilterPillOption[] = [...HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS];

  protected readonly query: Signal<HealthMetricsMembersTiersQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsMembersTiers> = this.initResponse();
  protected readonly view: Signal<HealthMetricsMembersTiersView> = computed(() =>
    buildHealthMetricsMembersTiersView(this.response(), this.chrome.selectedRange(), this.mode())
  );

  protected readonly chartData: Signal<ChartData<'bar'>> = computed(() => this.buildChart(this.view()));
  protected readonly chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      // The legend is drawn below the chart in markup, so it wraps with the tier names.
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => this.tooltipTitle(items[0]?.dataIndex),
          label: (item) => this.tooltipLabel(item.datasetIndex, item.dataIndex),
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: lfxColors.gray[500], font: { size: 10 } } },
      y: {
        stacked: true,
        min: 0,
        max: 100,
        grid: { color: lfxColors.gray[200] },
        border: { display: false },
        ticks: { stepSize: 25, color: lfxColors.gray[500], font: { size: 10 }, callback: (value) => `${value}%` },
      },
    },
  };

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The hero is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onModeChange(id: string): void {
    const option = HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS.find((candidate) => candidate.id === id);
    if (option) this.mode.set(option.id);
  }

  private initResponse(): Signal<HealthMetricsMembersTiers> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersTiers(query) : of(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED }
    );
  }

  /** Re-settles the re-projected hero; a read in flight or failed settles on its own. */
  private onRangeChange(): void {
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit();
  }

  /** One stacked dataset per tier, as its share of each year's members; the year's total sits under its label. */
  private buildChart(view: HealthMetricsMembersTiersView): ChartData<'bar'> {
    return {
      labels: view.years.map((year) => [String(year.year), year.totalMembersLabel]),
      datasets: view.tiers.map((tier) => ({
        label: tier.tier,
        data: tier.cells.map((cell) => cell.sharePct),
        backgroundColor: tier.color,
        maxBarThickness: 56,
      })),
    };
  }

  private tooltipTitle(index: number | undefined): string {
    const year = index === undefined ? undefined : this.view().years[index];
    if (!year) return '';

    return year.isPartial ? `${year.year} · partial year` : String(year.year);
  }

  private tooltipLabel(tierIndex: number, yearIndex: number): string {
    const tier = this.view().tiers[tierIndex];
    const cell = tier?.cells[yearIndex];
    if (!tier || !cell) return '';

    // An unmeasured count has no share to state.
    return cell.sharePct === null ? `${tier.tier}: ${cell.label}` : `${tier.tier}: ${cell.label} (${Math.round(cell.sharePct)}%)`;
  }
}
