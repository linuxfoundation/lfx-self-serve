// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, PLATFORM_ID, type Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_ALL_EVENTS,
  HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_STATUS_OPTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEventsSpeakersProposalRowView, formatHealthMetricsEventsSpeakerProposalsSubtitle } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, EMPTY, Subject, switchMap, tap } from 'rxjs';

import type {
  HealthMetricsEventsSpeakerProposals,
  HealthMetricsEventsSpeakerProposalsDrawerData,
  HealthMetricsEventsSpeakerProposalsFilterOption,
  HealthMetricsEventsSpeakerProposalsQuery,
  HealthMetricsEventsSpeakersProposalRowView,
  HealthMetricsEventsSpeakersStatusGroup,
} from '@lfx-one/shared/interfaces';

/**
 * All speaker proposals for the period, newest first, filtered by event and status. Pages load as the list scrolls to its
 * end, and a filter change starts again from the first page. The speaker is shown by job title, never by name.
 */
@Component({
  selector: 'lfx-events-speaker-proposals-drawer',
  imports: [Skeleton, UiAvatarComponent, UiBadgeComponent, UiDrawerComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './events-speaker-proposals-drawer.component.html',
})
export class EventsSpeakerProposalsDrawerComponent {
  private readonly data = inject<HealthMetricsEventsSpeakerProposalsDrawerData>(DIALOG_DATA);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  /** Each offset to read; a filter change pushes 0, which `switchMap` lets cancel a page still in flight. */
  private readonly pageRequests = new Subject<number>();

  protected readonly statusOptions = HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_STATUS_OPTIONS;
  protected readonly eventId = signal<string>('');
  protected readonly status = signal<string>('');
  protected readonly eventOptions = signal<HealthMetricsEventsSpeakerProposalsFilterOption[]>([HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_ALL_EVENTS]);
  protected readonly rows = signal<HealthMetricsEventsSpeakersProposalRowView[]>([]);
  protected readonly total = signal<number | null>(null);
  /** The first page of the current filters is loading. */
  protected readonly loading = signal<boolean>(true);
  /** A later page is loading under the rows. */
  protected readonly loadingMore = signal<boolean>(false);
  protected readonly loadFailed = signal<boolean>(false);

  protected readonly subtitle: Signal<string> = computed(() => {
    const total = this.total();
    return total === null ? '' : formatHealthMetricsEventsSpeakerProposalsSubtitle(total, this.data.range);
  });
  /** More rows remain past the ones shown, and no page is loading or failed, so reaching the end loads the next. */
  protected readonly canLoadMore: Signal<boolean> = computed(
    () => !this.loading() && !this.loadingMore() && !this.loadFailed() && this.rows().length < (this.total() ?? 0)
  );

  public constructor() {
    this.pageRequests
      .pipe(
        switchMap((offset) => {
          const query = this.query(offset);
          return this.analyticsService.getEventsSpeakerProposals(query).pipe(
            tap((page) => this.applyPage(page, offset)),
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              this.loading.set(false);
              this.loadingMore.set(false);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe();

    this.watchListEnd();
    this.reload();
  }

  protected onEventChange(id: string | null): void {
    this.eventId.set(id ?? '');
    this.reload();
  }

  protected onStatusChange(id: string | null): void {
    this.status.set(id ?? '');
    this.reload();
  }

  /** Starts again from the first page, as the filters changed; the subtitle keeps the last total until the new one lands. */
  private reload(): void {
    this.rows.set([]);
    this.loading.set(true);
    this.loadingMore.set(false);
    this.loadFailed.set(false);
    this.pageRequests.next(0);
  }

  private query(offset: number): HealthMetricsEventsSpeakerProposalsQuery {
    const status = this.status();
    return {
      foundationSlug: this.data.foundationSlug,
      range: this.data.range,
      eventId: this.eventId(),
      status: status ? (status as HealthMetricsEventsSpeakersStatusGroup) : null,
      offset,
      pageSize: HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_PAGE_SIZE,
    };
  }

  private applyPage(page: HealthMetricsEventsSpeakerProposals, offset: number): void {
    const rows = page.rows.map(buildHealthMetricsEventsSpeakersProposalRowView);
    this.rows.update((current) => (offset === 0 ? rows : [...current, ...rows]));
    this.total.set(page.totalRecords);
    if (page.events) {
      this.eventOptions.set([HEALTH_METRICS_EVENTS_SPEAKER_PROPOSALS_ALL_EVENTS, ...page.events.map((event) => ({ id: event.id, label: event.name }))]);
    }
    this.loading.set(false);
    this.loadingMore.set(false);
  }

  /** Loads the next page once the marker after the last row scrolls into view, including a short page that leaves it showing. */
  private watchListEnd(): void {
    afterRenderEffect((onCleanup) => {
      const sentinel = this.sentinel()?.nativeElement;
      if (!sentinel || !isPlatformBrowser(this.platformId) || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting || !this.canLoadMore()) return;
        this.loadingMore.set(true);
        this.pageRequests.next(this.rows().length);
      });
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }
}
