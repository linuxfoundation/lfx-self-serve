// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_CHART_TIP_ROOM_PX,
  HEALTH_METRICS_OVERVIEW_CREATE_NEWSLETTER_LINK,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
  HEALTH_METRICS_OVERVIEW_FILL_CLASSES,
  HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX,
  HEALTH_METRICS_OVERVIEW_STROKES,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewNewsletterView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { distinctUntilChanged, EMPTY, Observable, switchMap } from 'rxjs';

import { HealthMetricsChartTipComponent } from '../../../components/health-metrics-chart-tip/health-metrics-chart-tip.component';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewNewsletterTickView, HealthMetricsOverviewNewsletterView } from '@lfx-one/shared/interfaces';

/** Newsletters sent in the period: the summary, each newsletter's open and click rate, and how engaged subscribers are. */
@Component({
  selector: 'lfx-overview-newsletter-card',
  imports: [HealthMetricsChartTipComponent, OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-newsletter-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewNewsletterCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContext = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.newsletter;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.newsletter;
  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly fills = HEALTH_METRICS_OVERVIEW_FILL_CLASSES;
  /** One newsletter card per page, so a fixed id is unique. */
  protected readonly areaGradientId = 'overview-newsletter-area';
  protected readonly areaFill = `url(#${this.areaGradientId})`;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.newsletters;
  protected readonly tip = signal<{ index: number; flip: boolean } | null>(null);
  protected readonly openTipIndex = computed(() => this.tip()?.index ?? null);
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewNewsletters({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewNewsletterView | null>(() => {
    const newsletters = this.read.data();
    return newsletters ? buildHealthMetricsOverviewNewsletterView(newsletters, this.chrome.selectedRange()) : null;
  });
  // A newsletter sent now counts toward the current year, so only YTD offers to write one.
  protected readonly isYtd = computed(() => this.chrome.selectedRange() === 'YTD');
  protected readonly createNewsletterLink = computed(() => ({
    ...HEALTH_METRICS_OVERVIEW_CREATE_NEWSLETTER_LINK,
    queryParams: { project: this.projectContext.selectedFoundation()?.slug ?? null },
  }));
  private readonly plot = viewChild<ElementRef<HTMLElement>>('plot');
  /** `null` until measured, so the server and the first paint label every newsletter. */
  private readonly plotWidthPx: Signal<number | null> = this.initPlotWidth();
  protected readonly ticks: Signal<HealthMetricsOverviewNewsletterTickView[]> = this.initTicks();

  /** Opens a newsletter's popover beside its column, on the left only when the right has no room and the left has more. */
  protected showTip(index: number, event: Event): void {
    const column = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const centre = column.left + column.width / 2;
    const roomRight = document.documentElement.clientWidth - centre;
    this.tip.set({ index, flip: roomRight < HEALTH_METRICS_OVERVIEW_CHART_TIP_ROOM_PX && centre > roomRight });
  }

  protected hideTip(index: number): void {
    if (this.tip()?.index === index) this.tip.set(null);
  }

  /** Watches the plot's width while it is on the page; the server never measures it. */
  private initPlotWidth(): Signal<number | null> {
    if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return signal(null);
    return toSignal(
      toObservable(this.plot).pipe(
        distinctUntilChanged(),
        switchMap((plot) => (plot ? observeWidth(plot.nativeElement) : EMPTY))
      ),
      { initialValue: null }
    );
  }

  /** One label per newsletter, or the first of each month when their slots get too narrow to keep them apart. */
  private initTicks(): Signal<HealthMetricsOverviewNewsletterTickView[]> {
    return computed(() => {
      const chart = this.view()?.chart;
      if (!chart) return [];
      const width = this.plotWidthPx();
      return width !== null && width / chart.ticks.length < HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX ? chart.monthTicks : chart.ticks;
    });
  }
}

function observeWidth(element: HTMLElement): Observable<number> {
  return new Observable<number>((subscriber) => {
    const observer = new ResizeObserver(([entry]) => subscriber.next(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
}
