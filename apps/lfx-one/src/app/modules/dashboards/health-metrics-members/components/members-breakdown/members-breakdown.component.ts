// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  HEALTH_METRICS_MEMBERS_BREAKDOWN_TIP_ROOM_PX,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_VIEW_OPTIONS,
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
  HealthMetricsMembersBreakdownRowKind,
  HealthMetricsMembersBreakdownTableRow,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersBreakdownViewMode,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
} from '@lfx-one/shared/interfaces';

// Tailwind scans only the app's sources, so the table's class strings live here rather than in the shared package.

/** The table's row labels: tiers medium, totals bold, change rows small and muted. */
const LABEL_CLASSES: Record<HealthMetricsMembersBreakdownRowKind, string> = {
  tier: 'text-[13px] font-medium text-gray-900',
  total: 'text-[13px] font-semibold text-gray-900',
  change: 'text-[12px] font-normal text-gray-500',
};

/** A value cell's type and fill: the last year washed in accent, a change tinted by its direction. */
const CELL_CLASSES: Record<HealthMetricsMembersBreakdownRowKind, { base: string; last: string }> = {
  tier: { base: 'text-[13px] font-normal text-gray-900', last: 'bg-blue-50' },
  total: { base: 'text-[13px] font-semibold text-gray-900', last: 'bg-blue-100' },
  change: { base: 'text-[12px] font-normal text-gray-400', last: 'bg-blue-50' },
};

const CHANGE_CLASSES: Record<'up' | 'down', string> = {
  up: 'text-[12px] font-medium text-emerald-600 bg-[var(--ui-success-50)]',
  down: 'text-[12px] font-medium text-red-600 bg-[var(--ui-danger-50)]',
};

const CELL_BASE_CLASS = 'flex min-w-0 items-center justify-end whitespace-nowrap px-[10px] py-[11px] leading-[18px]';
const RULE_CLASS = 'border-[color:var(--ui-neutral-alpha-100)]';

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

  /** Opens a column's popup beside it, on its left when the right has no room for it. */
  protected showTip(index: number, event: Event, plot: HTMLElement): void {
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const bounds = plot.getBoundingClientRect();
    this.tip.set({ index, flip: column.left + column.width / 2 + HEALTH_METRICS_MEMBERS_BREAKDOWN_TIP_ROOM_PX > bounds.right });
  }

  protected hideTip(index: number): void {
    if (this.tip()?.index === index) this.tip.set(null);
  }

  /** Each row's rules and each cell's type and fill; a total's rule above replaces the row's own below. */
  private initTableRows(): Signal<HealthMetricsMembersBreakdownTableRow[]> {
    return computed(() => {
      const rows = this.view().rows;
      return rows.map((row, index) => ({
        key: row.key,
        label: row.label,
        icon: row.icon,
        rowClass: [rows[index + 1]?.kind === 'total' ? '' : `border-b ${RULE_CLASS}`, row.kind === 'total' ? 'border-t border-gray-900' : ''].join(' '),
        labelClass: LABEL_CLASSES[row.kind],
        cells: row.cells.map((cell, cellIndex) => {
          const last = cellIndex === row.cells.length - 1;
          const fill = cell.tone ? CHANGE_CLASSES[cell.tone] : `${CELL_CLASSES[row.kind].base} ${last ? CELL_CLASSES[row.kind].last : ''}`;
          // The last year's left edge is the dashed rule, not a solid one.
          return { label: cell.label, cellClass: `${CELL_BASE_CLASS} ${fill} ${last ? '' : `border-l ${RULE_CLASS}`}` };
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
