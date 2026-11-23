// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  HEALTH_METRICS_MEMBERS_CHART_TIP_ROOM_PX,
  HEALTH_METRICS_MEMBERS_GROWTH_PLOT,
  HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersGrowthView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../../../components/health-metrics-chart-tip/health-metrics-chart-tip.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type { HealthMetricsMembersGrowth, HealthMetricsMembersGrowthQuery, HealthMetricsMembersGrowthView } from '@lfx-one/shared/interfaces';

/**
 * `#growth` — cumulative new members by month, one line per year as PCC draws it. The period pill only picks which
 * year's line is solid, so one read serves every period.
 */
@Component({
  selector: 'lfx-members-growth',
  imports: [EmptyStateComponent, HealthMetricsChartTipComponent, Skeleton],
  templateUrl: './members-growth.component.html',
})
export class MembersGrowthComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when there is nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly plot = HEALTH_METRICS_MEMBERS_GROWTH_PLOT;
  protected readonly viewBox = `0 0 ${HEALTH_METRICS_MEMBERS_GROWTH_PLOT.width} ${HEALTH_METRICS_MEMBERS_GROWTH_PLOT.height}`;
  /** The year previewed while its legend item is hovered or focused. */
  protected readonly preview = signal<number | null>(null);
  /** The year a click, tap or Enter on its legend item selected; another activation clears it. */
  protected readonly selected = signal<number | null>(null);
  /** The year whose line stays at full opacity: the preview, else the selection. */
  protected readonly highlight = computed(() => this.preview() ?? this.selected());
  /** The month whose popup shows, and whether it opens to the month's left for want of room. */
  protected readonly tip = signal<{ index: number; flip: boolean } | null>(null);

  protected readonly query: Signal<HealthMetricsMembersGrowthQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsMembersGrowth> = this.initResponse();
  protected readonly view: Signal<HealthMetricsMembersGrowthView> = computed(() =>
    buildHealthMetricsMembersGrowthView(this.response(), this.chrome.selectedRange())
  );
  /** Each year's opacity: full unless another year's legend item is hovered. */
  protected readonly opacities: Signal<Map<number, number>> = computed(() => {
    const highlighted = this.highlight();
    return new Map(this.view().lines.map((line) => [line.year, highlighted === null || highlighted === line.year ? 1 : 0.15]));
  });
  /** On a phone only the first and last months show, pinned to the plot's edges. */
  protected readonly monthLabelClasses: Signal<string[]> = computed(() =>
    this.view().columns.map((_, index, columns) => {
      if (index === 0) return 'max-sm:!left-0 max-sm:translate-x-0';
      return index === columns.length - 1 ? 'max-sm:!left-auto max-sm:right-0 max-sm:translate-x-0' : 'max-sm:hidden';
    })
  );
  /** No month was measured; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && !this.view().measured);

  /** Opens a month's popup beside it, on its left only when the right has no room for it and the left has more. */
  protected showTip(index: number, event: Event): void {
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const centre = column.left + column.width / 2;
    const roomRight = document.documentElement.clientWidth - centre;
    this.tip.set({ index, flip: roomRight < HEALTH_METRICS_MEMBERS_CHART_TIP_ROOM_PX && centre > roomRight });
  }

  protected hideTip(index: number): void {
    if (this.tip()?.index === index) this.tip.set(null);
  }

  private initResponse(): Signal<HealthMetricsMembersGrowth> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED);
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
          this.preview.set(null);
          this.selected.set(null);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersGrowth(query) : of(HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && !buildHealthMetricsMembersGrowthView(response, this.chrome.selectedRange()).measured);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_GROWTH_UNMEASURED }
    );
  }
}
