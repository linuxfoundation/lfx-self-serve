// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_VIEW_OPTIONS,
  HEALTH_METRICS_MEMBERS_CHART_TIP_ROOM_PX,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersBreakdownView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../../../components/health-metrics-chart-tip/health-metrics-chart-tip.component';
import { HealthMetricsTierIconComponent } from '../../../components/health-metrics-tier-icon/health-metrics-tier-icon.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { OverviewKpiStripComponent } from '../../../health-metrics-overview/components/overview-kpi-strip/overview-kpi-strip.component';

import type {
  HealthMetricsMembersBreakdownTableRow,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersBreakdownViewMode,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#breakdown` — members per tier at each year's end as stacked columns or a table, under a metrics row for the
 * selected period. One read carries every year, so a period or view change never re-reads.
 */
@Component({
  selector: 'lfx-members-breakdown',
  imports: [
    EmptyStateComponent,
    HealthMetricsChartTipComponent,
    HealthMetricsTierIconComponent,
    OverviewKpiStripComponent,
    Skeleton,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './members-breakdown.component.html',
})
export class MembersBreakdownComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when there is nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();
  /** The selected year's members, for the sub-nav badge; `null` until read, and when unmeasured. */
  public readonly countChange = output<number | null>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly viewOptions = HEALTH_METRICS_MEMBERS_BREAKDOWN_VIEW_OPTIONS;
  protected readonly mode = signal<HealthMetricsMembersBreakdownViewMode>(HEALTH_METRICS_MEMBERS_BREAKDOWN_VIEW_OPTIONS[0].value);
  /** The column whose popup shows, and whether it opens to the column's left for want of room. */
  protected readonly tip = signal<{ index: number; flip: boolean } | null>(null);

  protected readonly query: Signal<HealthMetricsMembersTiersQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsMembersTiers> = this.initResponse();
  protected readonly view: Signal<HealthMetricsMembersBreakdownView> = computed(() =>
    buildHealthMetricsMembersBreakdownView(this.response(), this.chrome.selectedRange())
  );
  /** No membership was measured; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && !this.view().measured);
  protected readonly gridColumns = computed(() => `minmax(170px, 1.8fr) repeat(${this.view().columns.length}, minmax(0, 1fr))`);
  protected readonly tableRows: Signal<HealthMetricsMembersBreakdownTableRow[]> = this.initTableRows();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The metrics row is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onModeChange(value: string | null): void {
    const option = HEALTH_METRICS_MEMBERS_BREAKDOWN_VIEW_OPTIONS.find((candidate) => candidate.value === value);
    if (option) this.mode.set(option.value);
  }

  /** Opens a column's popup beside it, on its left only when the right has no room for it and the left has more. */
  protected showTip(index: number, event: Event): void {
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const centre = column.left + column.width / 2;
    const roomRight = document.documentElement.clientWidth - centre;
    this.tip.set({ index, flip: roomRight < HEALTH_METRICS_MEMBERS_CHART_TIP_ROOM_PX && centre > roomRight });
  }

  protected hideTip(index: number): void {
    if (this.tip()?.index === index) this.tip.set(null);
  }

  /** Each row's rules and each cell's type and fill; a total's rule above replaces the row's own below. */
  private initTableRows(): Signal<HealthMetricsMembersBreakdownTableRow[]> {
    return computed(() => {
      const classes = HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES;
      const rows = this.view().rows;
      return rows.map((row, index) => ({
        key: row.key,
        label: row.label,
        icon: row.icon,
        rowClass: [rows[index + 1]?.kind === 'total' ? '' : classes.rowRule, row.kind === 'total' ? classes.totalRule : ''].join(' '),
        labelClass: classes.label[row.kind],
        cells: row.cells.map((cell, cellIndex) => {
          const last = cellIndex === row.cells.length - 1;
          const fill = cell.tone ? classes.change[cell.tone] : `${classes.cell[row.kind]} ${last ? classes.lastCell[row.kind] : ''}`;
          // The last year's left edge is the dashed rule, not a solid one.
          return { label: cell.label, cellClass: `${classes.cellBase} ${fill} ${last ? '' : classes.cellRule}` };
        }),
      }));
    });
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
          this.tip.set(null);
          this.reading.emit();
          this.countChange.emit(null);
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersTiers(query) : of(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.report(buildHealthMetricsMembersBreakdownView(response, this.chrome.selectedRange()));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED }
    );
  }

  /** Re-settles the re-projected metrics row; a read in flight or failed settles on its own. */
  private onRangeChange(): void {
    if (this.loadFailed() || this.loading()) return;

    this.report(this.view());
  }

  private report(view: HealthMetricsMembersBreakdownView): void {
    this.countChange.emit(this.loadFailed() ? null : view.count);
    this.settled.emit(!this.loadFailed() && !view.measured);
  }
}
