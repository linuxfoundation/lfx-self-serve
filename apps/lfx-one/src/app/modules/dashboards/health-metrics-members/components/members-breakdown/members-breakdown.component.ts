// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES, HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersBreakdownView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsTierIconComponent } from '../../../components/health-metrics-tier-icon/health-metrics-tier-icon.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsMembersBreakdownTableRow,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
} from '@lfx-one/shared/interfaces';

/**
 * `#breakdown` — members per tier at each year's end as PCC tables it, with the totals and revenue under them. One
 * read carries every year, so a period change only re-counts the sub-nav badge.
 */
@Component({
  selector: 'lfx-members-breakdown',
  imports: [EmptyStateComponent, HealthMetricsTierIconComponent, Skeleton],
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
      // The sub-nav count is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  /**
   * Each row's rules and fill, and each cell's type: a stripe on every other tier, the accent on the totals, and the
   * dark rule above the first total in place of the row's own below.
   */
  private initTableRows(): Signal<HealthMetricsMembersBreakdownTableRow[]> {
    return computed(() => {
      const classes = HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES;
      const rows = this.view().rows;
      return rows.map((row, index) => {
        const opensTotals = row.kind === 'total' && rows[index - 1]?.kind !== 'total';
        const closesTiers = row.kind !== 'total' && rows[index + 1]?.kind === 'total';
        const fill = row.kind === 'total' ? classes.totalFill : rowStripe(row.striped);
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

  /** Re-counts the sub-nav badge for the new period; a read in flight or failed settles on its own. */
  private onRangeChange(): void {
    if (this.loadFailed() || this.loading()) return;

    this.report(this.view());
  }

  private report(view: HealthMetricsMembersBreakdownView): void {
    this.countChange.emit(this.loadFailed() ? null : view.count);
    this.settled.emit(!this.loadFailed() && !view.measured);
  }
}

function rowStripe(striped: boolean): string {
  return striped ? HEALTH_METRICS_MEMBERS_BREAKDOWN_TABLE_CLASSES.stripe : '';
}
