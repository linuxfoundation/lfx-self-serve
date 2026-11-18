// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { HEALTH_METRICS_EVENTS_SPEAKERS_LIST_OPTIONS, HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED, HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsSpeakersView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, take, tap } from 'rxjs';

import { HealthMetricsBarListComponent } from '../../../components/health-metrics-bar-list/health-metrics-bar-list.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsColumnChartComponent } from '../../../components/health-metrics-column-chart/health-metrics-column-chart.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { EventsSpeakerProposalsDrawerComponent } from '../events-speaker-proposals-drawer/events-speaker-proposals-drawer.component';

import type {
  HealthMetricsEventsSpeakerProposalsDrawerData,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersList,
  HealthMetricsEventsSpeakersQuery,
  HealthMetricsEventsSpeakersView,
} from '@lfx-one/shared/interfaces';

/**
 * `#spk` — the CFP pipeline: the metrics row, proposals by year by status, then the latest proposals or the companies
 * that submitted the most. One read carries all four periods, so a period change re-projects it.
 */
@Component({
  selector: 'lfx-events-speakers',
  imports: [
    EmptyStateComponent,
    HealthMetricsBarListComponent,
    HealthMetricsCellComponent,
    HealthMetricsColumnChartComponent,
    HealthMetricsMetricsRowComponent,
    Skeleton,
    TableComponent,
    UiBadgeComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './events-speakers.component.html',
})
export class EventsSpeakersComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly drawerService = inject(UiDrawerService);
  /** The open All speaker proposals drawer, closed when the period changes or the section leaves. */
  private drawerRef: DialogRef<unknown, EventsSpeakerProposalsDrawerComponent> | null = null;

  /** Fires once the section settles, `true` when the period has nothing to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly listOptions = HEALTH_METRICS_EVENTS_SPEAKERS_LIST_OPTIONS;
  /** Recent proposals or the most active companies, as the switch under the chart picks. */
  protected readonly list = signal<HealthMetricsEventsSpeakersList>(HEALTH_METRICS_EVENTS_SPEAKERS_LIST_OPTIONS[0].id);

  protected readonly query: Signal<HealthMetricsEventsSpeakersQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEventsSpeakers> = this.initResponse();
  protected readonly view: Signal<HealthMetricsEventsSpeakersView> = computed(() =>
    buildHealthMetricsEventsSpeakersView(this.response(), this.chrome.selectedRange())
  );
  /** Nothing measured for the foundation or the period; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && isEmptyView(this.view()));

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.closeAllProposals());

    if (isPlatformBrowser(this.platformId)) {
      // Every figure is per period, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  /** Opens every proposal of the period in the drawer; its own reads page through them. */
  protected openAllProposals(): void {
    const selected = this.chrome.selectedRange();
    const range = HEALTH_METRICS_L2_RANGES.find((candidate) => candidate === selected);
    const foundationSlug = this.query().foundationSlug;
    if (!foundationSlug || !range) return;

    this.closeAllProposals();
    const data: HealthMetricsEventsSpeakerProposalsDrawerData = { foundationSlug, range };
    const ref = this.drawerService.open<unknown, HealthMetricsEventsSpeakerProposalsDrawerData, EventsSpeakerProposalsDrawerComponent>(
      EventsSpeakerProposalsDrawerComponent,
      { data }
    );
    this.drawerRef = ref;
    ref.closed.pipe(take(1)).subscribe(() => {
      if (this.drawerRef === ref) this.drawerRef = null;
    });
  }

  protected onListChange(id: string | null): void {
    const option = HEALTH_METRICS_EVENTS_SPEAKERS_LIST_OPTIONS.find((candidate) => candidate.id === id);
    if (!option) return;

    this.list.set(option.id);
    // The two lists differ in height, and every anchor below moves with it.
    if (!this.loadFailed() && !this.loading()) this.settled.emit(isEmptyView(this.view()));
  }

  private initResponse(): Signal<HealthMetricsEventsSpeakers> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
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
          (query.foundationSlug ? this.analyticsService.getEventsSpeakers(query) : of(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED);
            }),
            tap((response) => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen)
                this.settled.emit(!this.loadFailed() && isEmptyView(buildHealthMetricsEventsSpeakersView(response, this.chrome.selectedRange())));
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_EVENTS_SPEAKERS_UNMEASURED }
    );
  }

  private closeAllProposals(): void {
    this.drawerRef?.close();
    this.drawerRef = null;
  }

  /** Re-settles the re-projected section; a read in flight or failed settles on its own. The drawer lists the old period, so it closes. */
  private onRangeChange(): void {
    this.closeAllProposals();
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit(isEmptyView(this.view()));
  }
}

/** Whether the period has nothing to show: the foundation or the period was never measured. */
function isEmptyView(view: HealthMetricsEventsSpeakersView): boolean {
  return !view.foundationMeasured || !view.measured;
}
