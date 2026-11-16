// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_CHART_TIP_EDGE_PX,
  HEALTH_METRICS_OVERVIEW_CHART_TIP_ROOM_PX,
  HEALTH_METRICS_OVERVIEW_CHART_TIP_WIDTH_PX,
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

import type {
  HealthMetricsOverviewChartTipPlacement,
  HealthMetricsOverviewNewsletterTickView,
  HealthMetricsOverviewNewsletterView,
} from '@lfx-one/shared/interfaces';

/** Newsletters sent in the period: the summary, each newsletter's open and click rate, and how engaged subscribers are. */
@Component({
  selector: 'lfx-overview-newsletter-card',
  imports: [HealthMetricsChartTipComponent, OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-newsletter-card.component.html',
  // Escape closes a popover however it opened, since hovering a column doesn't focus it.
  // A resize or zoom re-places an open popover, so it never keeps a side the screen no longer has room for.
  host: { class: 'flex min-w-0 flex-col', '(document:keydown.escape)': 'dismissTips()', '(window:resize)': 'replaceTips()' },
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
  /** Hover and focus open a popover separately, and it stays while either remains (WCAG 1.4.13); hover shows over focus. */
  private readonly hoverTip = signal<HealthMetricsOverviewChartTipPlacement | null>(null);
  private readonly focusTip = signal<HealthMetricsOverviewChartTipPlacement | null>(null);
  /** The column each open popover belongs to, kept so a resize can place it again. */
  private hoverAnchor: { index: number; column: HTMLElement; pointOffsetPct: string } | null = null;
  private focusAnchor: { index: number; column: HTMLElement; pointOffsetPct: string } | null = null;
  protected readonly tip = computed(() => this.hoverTip() ?? this.focusTip());
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
  /** `null` until measured, so the first paint keeps to the month labels, which can't crowd as much. */
  private readonly plotWidthPx: Signal<number | null> = this.initPlotWidth();
  protected readonly ticks: Signal<HealthMetricsOverviewNewsletterTickView[]> = this.initTicks();

  protected onColumnHover(index: number, event: Event, pointOffsetPct: string): void {
    this.hoverAnchor = { index, column: event.currentTarget as HTMLElement, pointOffsetPct };
    this.hoverTip.set(this.placeTip(this.hoverAnchor));
  }

  protected onColumnFocus(index: number, event: Event, pointOffsetPct: string): void {
    this.focusAnchor = { index, column: event.currentTarget as HTMLElement, pointOffsetPct };
    this.focusTip.set(this.placeTip(this.focusAnchor));
  }

  protected onColumnLeave(index: number): void {
    if (this.hoverAnchor?.index !== index) return;
    this.hoverAnchor = null;
    this.hoverTip.set(null);
  }

  protected onColumnBlur(index: number): void {
    if (this.focusAnchor?.index !== index) return;
    this.focusAnchor = null;
    this.focusTip.set(null);
  }

  protected dismissTips(): void {
    this.hoverAnchor = null;
    this.focusAnchor = null;
    this.hoverTip.set(null);
    this.focusTip.set(null);
  }

  protected replaceTips(): void {
    if (this.hoverAnchor) this.hoverTip.set(this.placeTip(this.hoverAnchor));
    if (this.focusAnchor) this.focusTip.set(this.placeTip(this.focusAnchor));
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

  /**
   * One label per newsletter when the points are far enough apart, or else the first of each month, skipping any that
   * would land on the label before it. Until the plot is measured it keeps to the month labels.
   */
  private initTicks(): Signal<HealthMetricsOverviewNewsletterTickView[]> {
    return computed(() => {
      const chart = this.view()?.chart;
      if (!chart) return [];
      const width = this.plotWidthPx();
      if (width === null) return chart.monthTicks;
      if (width / Math.max(1, chart.ticks.length - 1) >= HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX) return chart.ticks;

      const kept: HealthMetricsOverviewNewsletterTickView[] = [];
      for (const tick of chart.monthTicks) {
        const previous = kept.at(-1);
        const apartPx = previous ? ((Number(tick.xPct) - Number(previous.xPct)) / 100) * width : Infinity;
        if (apartPx >= HEALTH_METRICS_OVERVIEW_NEWSLETTER_LABEL_MIN_PX) kept.push(tick);
      }
      return kept;
    });
  }

  /**
   * Opens a newsletter's popover on the right of its points, or on the left when only the left has room; a screen with
   * room on neither side shifts it to stay inside the screen.
   */
  private placeTip({
    index,
    column: element,
    pointOffsetPct,
  }: {
    index: number;
    column: HTMLElement;
    pointOffsetPct: string;
  }): HealthMetricsOverviewChartTipPlacement {
    const column = element.getBoundingClientRect();
    const offset = Number(pointOffsetPct);
    const point = column.left + (column.width * offset) / 100;
    const viewport = document.documentElement.clientWidth;
    if (viewport - point >= HEALTH_METRICS_OVERVIEW_CHART_TIP_ROOM_PX) return { index, left: `calc(${offset}% + 12px)`, right: null };
    if (point >= HEALTH_METRICS_OVERVIEW_CHART_TIP_ROOM_PX) return { index, left: null, right: `calc(${100 - offset}% + 12px)` };

    const left = Math.max(
      HEALTH_METRICS_OVERVIEW_CHART_TIP_EDGE_PX,
      viewport - HEALTH_METRICS_OVERVIEW_CHART_TIP_EDGE_PX - HEALTH_METRICS_OVERVIEW_CHART_TIP_WIDTH_PX
    );
    return { index, left: `calc(${offset}% + ${Math.round(left - point)}px)`, right: null };
  }
}

function observeWidth(element: HTMLElement): Observable<number> {
  return new Observable<number>((subscriber) => {
    const observer = new ResizeObserver(([entry]) => subscriber.next(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  });
}
