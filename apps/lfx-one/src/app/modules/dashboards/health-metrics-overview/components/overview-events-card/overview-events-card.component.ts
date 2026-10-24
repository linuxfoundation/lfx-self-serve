// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, linkedSignal } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewEventsView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { forkJoin } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewEventTrendDialogComponent } from '../overview-event-trend-dialog/overview-event-trend-dialog.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';

import type { HealthMetricsOverviewEventRowView, HealthMetricsOverviewEventsView, HealthMetricsOverviewTrendDialogData } from '@lfx-one/shared/interfaces';

/** The period's events and sponsorship, and its event list: upcoming for YTD, the year's past events otherwise. */
@Component({
  selector: 'lfx-overview-events-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent],
  providers: [DialogService],
  templateUrl: './overview-events-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewEventsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly dialogService = inject(DialogService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.events;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.events;
  protected readonly pastLink = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.pastEvents;
  protected readonly speakersLink = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.speakers;
  protected readonly read = injectOverviewCardRead((foundationSlug) =>
    forkJoin({
      glance: this.analyticsService.getEventsAtAGlance({ foundationSlug }),
      sponsorship: this.analyticsService.getEventsSponsorship({ foundationSlug }),
      events: this.analyticsService.getOverviewEvents({ foundationSlug }),
    })
  );
  protected readonly view = computed<HealthMetricsOverviewEventsView | null>(() => {
    const data = this.read.data();
    if (!data) return null;
    const range = this.chrome.selectedRange();
    const periodLabel = this.chrome.periods.find((period) => period.range === range)?.label ?? '';
    return buildHealthMetricsOverviewEventsView(data.glance, data.sponsorship, data.events, range, periodLabel);
  });
  /** Back to one page whenever the list itself changes: a new period or a new foundation's read. */
  protected readonly visibleCount = linkedSignal({ source: this.view, computation: () => HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE });
  protected readonly visibleRows = computed<HealthMetricsOverviewEventRowView[]>(() => (this.view()?.rows ?? []).slice(0, this.visibleCount()));
  protected readonly hasMore = computed(() => (this.view()?.rows.length ?? 0) > this.visibleCount());

  protected showMore(): void {
    this.visibleCount.update((count) => count + HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE);
  }

  /** The design's registration trend dialog: no PrimeNG header, as the body draws its own. */
  protected openTrend(row: HealthMetricsOverviewEventRowView): void {
    const event = row.clickable ? this.read.data()?.events.upcoming.find((candidate) => candidate.eventId === row.eventId) : undefined;
    if (!event) return;

    const data: HealthMetricsOverviewTrendDialogData = { event };
    const ref = this.dialogService.open(OverviewEventTrendDialogComponent, {
      showHeader: false,
      width: 'min(720px, calc(100vw - 32px))',
      contentStyle: { padding: '22px' },
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      closeOnEscape: true,
      // The dialog focuses its own title; PrimeNG would put focus, and a ring, on the close button.
      focusOnShow: false,
      data,
    }) as DynamicDialogRef;
    nameDynamicDialog(this.dialogService, ref, OverviewEventTrendDialogComponent.headingId);
  }
}
