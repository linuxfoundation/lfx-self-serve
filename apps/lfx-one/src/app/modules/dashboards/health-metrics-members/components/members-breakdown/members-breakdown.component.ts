// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  getYearForRange,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_DEFAULT_SORT,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_YEAR_MIN_PX,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
  HEALTH_METRICS_SORT_HEADER_UNSORTED,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersBreakdownSortColumns,
  buildHealthMetricsMembersBreakdownView,
  healthMetricsRowSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsTierIconComponent } from '../../../components/health-metrics-tier-icon/health-metrics-tier-icon.component';

import type {
  HealthMetricsMembersBreakdownHeaderView,
  HealthMetricsMembersBreakdownRowView,
  HealthMetricsMembersBreakdownTableRow,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#breakdown` — members per tier at each year's end as PCC tables it, with the totals and revenue under them. One
 * read carries every year, so a period change leaves it as it is; it sorts in the browser, totals kept last.
 */
@Component({
  selector: 'lfx-members-breakdown',
  imports: [EmptyStateComponent, HealthMetricsThComponent, HealthMetricsTierIconComponent, Skeleton],
  templateUrl: './members-breakdown.component.html',
})
export class MembersBreakdownComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when there is nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsMembersTiersQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsMembersTiers> = this.initResponse();
  protected readonly view: Signal<HealthMetricsMembersBreakdownView> = computed(() => buildHealthMetricsMembersBreakdownView(this.response()));
  /** No membership was measured; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && !this.view().measured);
  /** Every year the table can show is a column, so the sort knows them all before a read lands; next year covers a tab left open past New Year. */
  protected readonly sorting = injectHealthMetricsTableSort(
    buildHealthMetricsMembersBreakdownSortColumns(getYearForRange('YTD') + 1),
    HEALTH_METRICS_MEMBERS_BREAKDOWN_DEFAULT_SORT
  );
  /** Each year column with its sort state; a column the sort does not know reads unsorted rather than failing to render. */
  protected readonly yearHeaders: Signal<HealthMetricsMembersBreakdownHeaderView[]> = computed(() => {
    const headers = this.sorting.headers();
    return this.view().columns.map((column) => ({ ...column, header: headers[column.sortKey] ?? HEALTH_METRICS_SORT_HEADER_UNSORTED }));
  });
  /** The tiers in the reader's order; Total members and Total revenue stay at the bottom whatever the sort. */
  private readonly sortedRows: Signal<HealthMetricsMembersBreakdownRowView[]> = computed(() =>
    sortHealthMetricsRows(this.view().rows, this.sorting.order(), healthMetricsRowSortValue, (row) => row.kind === 'total')
  );
  /** The design's 560px floor, widened to fit every year column so the header fill and rules span the whole scroll. */
  protected readonly tableMinWidthPx = computed(() => Math.max(560, 170 + this.view().columns.length * HEALTH_METRICS_MEMBERS_BREAKDOWN_YEAR_MIN_PX));
  protected readonly gridColumns = computed(
    () => `minmax(170px, 1.8fr) repeat(${this.view().columns.length}, minmax(${HEALTH_METRICS_MEMBERS_BREAKDOWN_YEAR_MIN_PX}px, 1fr))`
  );
  protected readonly tableRows: Signal<HealthMetricsMembersBreakdownTableRow[]> = this.initTableRows();

  /**
   * Each row's rules and fill, and each cell's type: a stripe on every other tier as shown, the accent on the totals,
   * and the dark rule above the first total in place of the row's own below.
   */
  private initTableRows(): Signal<HealthMetricsMembersBreakdownTableRow[]> {
    return computed(() => {
      const classes = HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES;
      const rows = this.sortedRows();
      return rows.map((row, index) => {
        const opensTotals = row.kind === 'total' && rows[index - 1]?.kind !== 'total';
        const closesTiers = row.kind !== 'total' && rows[index + 1]?.kind === 'total';
        const fill = row.kind === 'total' ? classes.totalFill : rowStripe(index % 2 === 1);
        return {
          key: row.key,
          label: row.label,
          icon: row.icon,
          rowClass: [closesTiers ? '' : classes.rowRule, opensTotals ? classes.totalRule : '', fill].filter(Boolean).join(' '),
          labelClass: classes.label[row.kind],
          cells: row.cells.map((label) => ({ label, cellClass: `${classes.cellBase} ${classes.cell[row.kind]} ${classes.cellRule}` })),
        };
      });
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
          this.reading.emit();
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
              if (foundationSeen) this.settled.emit(!this.loadFailed() && !buildHealthMetricsMembersBreakdownView(response).measured);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED }
    );
  }
}

function rowStripe(striped: boolean): string {
  return striped ? HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES.stripe : '';
}
