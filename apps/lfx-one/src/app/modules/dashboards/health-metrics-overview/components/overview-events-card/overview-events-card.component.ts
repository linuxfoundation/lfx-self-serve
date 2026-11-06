// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, linkedSignal, PLATFORM_ID, signal, viewChild } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_EVENT_LEGEND,
  HEALTH_METRICS_OVERVIEW_EVENTS_ACTIONS_MIN_WIDTH_PX,
  HEALTH_METRICS_OVERVIEW_EVENTS_INFO,
  HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
  HEALTH_METRICS_OVERVIEW_FILL_CLASSES,
  HEALTH_METRICS_OVERVIEW_UPCOMING_HATCH,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewEventsView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { UiGaugeComponent } from '@shared/uikit/gauge/gauge.component';
import { UiSplitButtonComponent } from '@shared/uikit/split-button/split-button.component';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { forkJoin } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewEventDialogComponent } from '../overview-event-dialog/overview-event-dialog.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewInfoTipComponent } from '../overview-info-tip/overview-info-tip.component';

import type {
  HealthMetricsOverviewEventDialogData,
  HealthMetricsOverviewEventDialogTab,
  HealthMetricsOverviewEventRowView,
  HealthMetricsOverviewEventsView,
} from '@lfx-one/shared/interfaces';

/** The period's events and sponsorship, and its event list: upcoming for YTD, the year's past events otherwise. */
@Component({
  selector: 'lfx-overview-events-card',
  imports: [NgTemplateOutlet, OverviewCardComponent, OverviewExploreLinkComponent, OverviewInfoTipComponent, UiGaugeComponent, UiSplitButtonComponent],
  providers: [DialogService],
  templateUrl: './overview-events-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewEventsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly dialogService = inject(DialogService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.events;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.events;
  protected readonly pastLink = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.pastEvents;
  protected readonly speakersLink = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.speakers;
  protected readonly info = HEALTH_METRICS_OVERVIEW_EVENTS_INFO;
  protected readonly legend = HEALTH_METRICS_OVERVIEW_EVENT_LEGEND;
  protected readonly pastClass = HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue;
  protected readonly upcomingHatch = HEALTH_METRICS_OVERVIEW_UPCOMING_HATCH;
  /** The design's columns at each table width: three below 912px, the actions from 912px, wider data columns from 1000px. */
  protected readonly gridClasses =
    'grid grid-cols-[minmax(0,1fr)_minmax(150px,170px)_minmax(170px,200px)] gap-x-[24px] @[912px]/evtbl:grid-cols-[minmax(260px,1fr)_minmax(150px,170px)_minmax(170px,200px)_260px] @[1000px]/evtbl:grid-cols-[minmax(240px,1fr)_minmax(170px,210px)_minmax(170px,210px)_260px] @[1000px]/evtbl:gap-x-[40px]';
  /** "Trend" below 961px of table, "Registration trend" from it; only one of the pair shows. */
  protected readonly actionPairs = [
    { key: 'trend-short', label: 'Trend', class: 'inline-flex @[961px]/evtbl:hidden' },
    { key: 'trend', label: 'Registration trend', class: 'hidden @[961px]/evtbl:inline-flex' },
  ] as const;
  private readonly tableWidth = signal<number | null>(null);
  private readonly table = viewChild<ElementRef<HTMLElement>>('table');
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
    return buildHealthMetricsOverviewEventsView(data.glance, data.sponsorship, data.events, this.chrome.selectedRange());
  });
  /** One page again whenever the list itself changes: a new period or a new foundation's read. */
  protected readonly showAll = linkedSignal({ source: this.view, computation: () => false });
  protected readonly visibleRows = computed<HealthMetricsOverviewEventRowView[]>(() => {
    const rows = this.view()?.rows ?? [];
    return this.showAll() ? rows : rows.slice(0, HEALTH_METRICS_OVERVIEW_EVENTS_PAGE_SIZE);
  });
  protected readonly hiddenCount = computed(() => (this.view()?.rows.length ?? 0) - this.visibleRows().length);
  /** The table hides its actions, so each row's event name becomes a button that opens the trend. */
  protected readonly narrow = computed(() => {
    const width = this.tableWidth();
    return width !== null && width < HEALTH_METRICS_OVERVIEW_EVENTS_ACTIONS_MIN_WIDTH_PX;
  });

  public constructor() {
    // The table only renders once the card has read, after the first render, so `afterNextRender` would miss it.
    effect((onCleanup) => {
      const element = this.table()?.nativeElement;
      if (!element || !isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(([entry]) => this.tableWidth.set(entry.contentRect.width));
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }

  /** The design's event dialog on the given tab: no PrimeNG header, as the body draws its own; anchored to the top so switching tabs never moves it. */
  protected openEvent(row: HealthMetricsOverviewEventRowView, tab: HealthMetricsOverviewEventDialogTab): void {
    const events = this.read.data()?.events;
    const event = (row.isPast ? events?.past : events?.upcoming)?.find((candidate) => candidate.eventId === row.eventId);
    if (!event) return;

    const data: HealthMetricsOverviewEventDialogData = { event, isPast: row.isPast, tab };
    const ref = this.dialogService.open(OverviewEventDialogComponent, {
      showHeader: false,
      width: 'min(1040px, calc(100vw - 32px))',
      position: 'top',
      // The design's inset from the top, and a height that leaves the same below.
      style: { marginTop: 'min(48px, 6vh)', maxHeight: 'calc(100vh - 2 * min(48px, 6vh))' },
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
    nameDynamicDialog(this.dialogService, ref, OverviewEventDialogComponent.headingId);
  }
}
