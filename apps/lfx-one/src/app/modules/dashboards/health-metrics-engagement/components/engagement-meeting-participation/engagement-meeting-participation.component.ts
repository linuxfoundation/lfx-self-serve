// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES,
} from '@lfx-one/shared/constants';
import {
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementPctDelta,
  formatHealthMetricsEngagementPpDelta,
  resolveHealthMetricsEngagementDeltaDirection,
  selectHealthMetricsEngagementParticipationPeriod,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { EngagementAttendanceBarComponent } from '../engagement-attendance-bar/engagement-attendance-bar.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import type {
  FilterPillOption,
  HealthMetricsEngagementMeetingParticipation,
  HealthMetricsEngagementParticipationMode,
  HealthMetricsEngagementParticipationQuery,
  HealthMetricsEngagementParticipationRowView,
  HealthMetricsEngagementSectionKey,
} from '@lfx-one/shared/interfaces';

/**
 * `#participation` — the foundation-wide roll-up the view computes itself, plus one row per meeting
 * type. The hero reads the view's `all` row rather than summing the type rows, which would
 * double-count a meeting belonging to more than one group.
 */
@Component({
  selector: 'lfx-engagement-meeting-participation',
  imports: [EmptyStateComponent, FilterPillsComponent, TableComponent, EngagementAttendanceBarComponent],
  templateUrl: './engagement-meeting-participation.component.html',
})
export class EngagementMeetingParticipationComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The hero's cross-links; the container owns scrolling so both sections stay in one pane. */
  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();
  /** Fires once a read settles — this section's height changes, which moves every anchor below it. */
  public readonly settled = output<void>();

  protected readonly modeOptions: FilterPillOption[] = HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES.map((mode) => ({
    id: mode.key,
    label: mode.label,
  }));

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly mode = signal<HealthMetricsEngagementParticipationMode>(this.parseInitialMode());
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not an empty foundation, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly query: Signal<HealthMetricsEngagementParticipationQuery> = computed(() => this.initQuery());
  protected readonly response: Signal<HealthMetricsEngagementMeetingParticipation> = this.initResponse();

  protected readonly totalPeriod = computed(() => {
    const total = this.response().total;
    return total ? selectHealthMetricsEngagementParticipationPeriod(total, this.chrome.selectedRange()) : null;
  });
  protected readonly totalGroups = computed(() => this.response().total?.totalGroups ?? 0);

  // Resolved here rather than per cell: the template only reads signals, and the period lookup runs
  // once per row per response instead of on every change-detection pass.
  protected readonly rowViews = computed<HealthMetricsEngagementParticipationRowView[]>(() => {
    const range = this.chrome.selectedRange();
    return this.response().rows.map((row) => ({ row, period: selectHealthMetricsEngagementParticipationPeriod(row, range) }));
  });

  protected readonly attendanceMode = computed(() => this.mode() === 'attendance');
  protected readonly heroValue = computed(() => {
    const period = this.totalPeriod();
    if (!period) return '—';

    return this.attendanceMode() ? formatHealthMetricsEngagementAttendance(period.attendancePct, period.meetingsHeld) : period.meetingsHeld.toLocaleString();
  });
  protected readonly heroLabel = computed(() => (this.attendanceMode() ? 'All-meeting attendance' : 'Meetings held'));
  protected readonly heroDelta = computed(() => {
    const period = this.totalPeriod();
    if (!period) return '—';

    return this.attendanceMode()
      ? formatHealthMetricsEngagementPpDelta(period.attendanceChangePp)
      : formatHealthMetricsEngagementPctDelta(period.meetingsChangePct);
  });
  protected readonly heroDeltaDirection = computed(() => {
    const period = this.totalPeriod();
    const change = this.attendanceMode() ? (period?.attendanceChangePp ?? null) : (period?.meetingsChangePct ?? null);
    return resolveHealthMetricsEngagementDeltaDirection(change);
  });
  /** The side row carries whichever measure the hero is not showing. */
  protected readonly secondaryLabel = computed(() => (this.attendanceMode() ? 'Meetings held' : 'All-meeting attendance'));
  protected readonly secondaryValue = computed(() => {
    const period = this.totalPeriod();
    if (!period) return '—';

    return this.attendanceMode() ? period.meetingsHeld.toLocaleString() : formatHealthMetricsEngagementAttendance(period.attendancePct, period.meetingsHeld);
  });
  protected readonly meetingsLabel = computed(() => {
    const meetings = this.totalPeriod()?.meetingsHeld ?? 0;
    return `${meetings.toLocaleString()} ${meetings === 1 ? 'meeting' : 'meetings'} in period`;
  });
  // The roll-up's own meeting count decides this, not a row's: the banner qualifies the hero.
  protected readonly lowConfidence = computed(() => {
    const period = this.totalPeriod();
    return period !== null && period.meetingsHeld > 0 && period.meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE;
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.mode)
        .pipe(
          // `skip(1)` drops the state just read out of the URL — navigating back to it would be a
          // no-op write during hydration.
          skip(1),
          takeUntilDestroyed()
        )
        .subscribe((mode) => this.syncUrl(mode));
    }
  }

  protected onModeChange(key: string): void {
    this.mode.set(this.toMode(key));
  }

  protected onSectionLink(key: HealthMetricsEngagementSectionKey): void {
    this.sectionPicked.emit(key);
  }

  private initQuery(): HealthMetricsEngagementParticipationQuery {
    return {
      foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
      range: this.chrome.selectedRange(),
    };
  }

  private initResponse(): Signal<HealthMetricsEngagementMeetingParticipation> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT);
    }

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug && a.range === b.range),
        tap(() => {
          this.loading.set(true);
          this.loadFailed.set(false);
        }),
        // Empty slug handled inside switchMap so clearing the foundation also cancels the in-flight
        // request for the previous one.
        switchMap((query) =>
          (query.foundationSlug
            ? this.analyticsService.getEngagementMeetingParticipation(query)
            : of(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT)
          ).pipe(
            // Caught per query so a failure ends this read without tearing down the outer pipeline;
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT);
            }),
            tap(() => {
              this.loading.set(false);
              this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT }
    );
  }

  private syncUrl(mode: HealthMetricsEngagementParticipationMode): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { partMode: mode === 'attendance' ? null : mode },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private parseInitialMode(): HealthMetricsEngagementParticipationMode {
    return this.toMode(this.initialParams.get('partMode') ?? 'attendance');
  }

  private toMode(key: string): HealthMetricsEngagementParticipationMode {
    const match = HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES.find((mode) => mode.key === key);
    return match ? match.key : 'attendance';
  }
}
