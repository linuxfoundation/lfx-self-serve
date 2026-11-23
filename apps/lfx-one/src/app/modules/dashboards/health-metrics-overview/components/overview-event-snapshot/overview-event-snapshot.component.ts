// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewSnapshotView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, of, switchMap, tap } from 'rxjs';

import { HealthMetricsInfoTipComponent } from '../../../components/health-metrics-info-tip/health-metrics-info-tip.component';

import type {
  HealthMetricsEventsSnapshot,
  HealthMetricsEventsSnapshotPeriod,
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewSnapshotSectionView,
} from '@lfx-one/shared/interfaces';

/**
 * The event dialog's Snapshot tab: how registrations and sponsorship moved over the last 7, 30 or 90 days, as two
 * tables of the level at the window's start, at its end, and the change between. One read serves every period.
 */
@Component({
  selector: 'lfx-overview-event-snapshot',
  imports: [HealthMetricsInfoTipComponent, SkeletonModule, UiBadgeComponent, UiSwitchComponent, UiSwitchOptionComponent],
  templateUrl: './overview-event-snapshot.component.html',
})
export class OverviewEventSnapshotComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly eventId = input.required<string>();
  /** The phone layout: three columns that never scroll sideways, the change under today's value and short dates. */
  public readonly compact = input<boolean>(false);
  /** Read by the dialog, which offers Download PNG only once the tables are in. */
  public readonly status = signal<HealthMetricsOverviewCardStatus>('loading');

  protected readonly periods = HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS;
  protected readonly period = signal<HealthMetricsEventsSnapshotPeriod>('7d');
  // Exact px from the design, which tightens every size on a phone.
  protected readonly desktopClasses = {
    stack: 'gap-[24px]',
    section: 'gap-[16px]',
    title: 'text-[16px] leading-[24px]',
    table: 'min-w-[674px]',
    grid: 'grid-cols-[minmax(180px,1.6fr)_minmax(130px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-[16px] px-[8px]',
    header: 'min-h-[44px] text-[12px] leading-[16px]',
    headerDate: 'items-center',
    headerToday: 'px-[12px]',
    row: 'text-[14px] leading-[20px]',
    label: 'flex items-center gap-[6px] py-[12px]',
    tip: '',
    cell: 'items-center py-[12px]',
    today: 'items-center justify-end p-[12px]',
  };
  protected readonly compactClasses = {
    stack: 'gap-[16px]',
    section: 'gap-[14px]',
    title: 'text-[14px] leading-[20px]',
    table: '',
    grid: 'grid-cols-[minmax(0,1fr)_76px_128px] gap-[8px]',
    header: 'min-h-[32px] text-[11px] leading-[14px]',
    headerDate: 'items-center py-[6px]',
    headerToday: 'px-[8px]',
    row: 'text-[13px] leading-[18px]',
    // A word too long for the narrowest phones breaks rather than running into the next column.
    label: 'block self-stretch break-words py-[7px] text-[12px] leading-[18px]',
    tip: 'ml-[4px] inline-flex align-[-1px]',
    cell: 'items-start py-[7px]',
    today: 'flex-col items-end justify-start px-[8px] py-[7px]',
  };
  protected readonly classes = computed(() => (this.compact() ? this.compactClasses : this.desktopClasses));
  private readonly snapshot = this.initSnapshot();
  protected readonly sections = computed<HealthMetricsOverviewSnapshotSectionView[]>(() => {
    const snapshot = this.snapshot();
    return snapshot ? buildHealthMetricsOverviewSnapshotView(snapshot, this.period()) : [];
  });

  protected onPeriodChange(value: string | null): void {
    const period = this.periods.find((option) => option.value === value);
    if (period) this.period.set(period.value);
  }

  /** A failed read says so, rather than showing every change as none. */
  private initSnapshot() {
    return toSignal(
      toObservable(this.eventId).pipe(
        tap(() => this.status.set('loading')),
        switchMap((eventId) =>
          this.analyticsService.getEventsSnapshot({ foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '', eventId }).pipe(
            tap(() => this.status.set('ready')),
            catchError(() => {
              this.status.set('failed');
              return of<HealthMetricsEventsSnapshot | null>(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }
}
