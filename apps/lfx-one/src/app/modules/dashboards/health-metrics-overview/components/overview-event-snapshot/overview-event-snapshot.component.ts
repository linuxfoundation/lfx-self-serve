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
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, of, switchMap, tap } from 'rxjs';

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
  imports: [SkeletonModule, UiBadgeComponent, UiSwitchComponent, UiSwitchOptionComponent, UiTooltipDirective],
  templateUrl: './overview-event-snapshot.component.html',
})
export class OverviewEventSnapshotComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly eventId = input.required<string>();
  /** Read by the dialog, which offers Download PNG only once the tables are in. */
  public readonly status = signal<HealthMetricsOverviewCardStatus>('loading');

  protected readonly periods = HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS;
  protected readonly period = signal<HealthMetricsEventsSnapshotPeriod>('7d');
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
