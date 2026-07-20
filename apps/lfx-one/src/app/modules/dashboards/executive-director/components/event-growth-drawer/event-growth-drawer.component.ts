// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { EVENT_GROWTH_TOP_EVENTS_LIMIT, lfxColors } from '@lfx-one/shared/constants';
import { formatCompact, formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EventGrowthResponse, EventGrowthTopEventView, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-growth-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, ChartComponent, DatePipe, DecimalPipe, DrawerModule, TagComponent],
  templateUrl: './event-growth-drawer.component.html',
})
export class EventGrowthDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<EventGrowthResponse>({
    totalAttendees: 0,
    totalRegistrants: 0,
    totalEvents: 0,
    totalRevenue: 0,
    revenuePerAttendee: 0,
    attendeeYoyChange: 0,
    registrantYoyChange: 0,
    revenueYoyChange: 0,
    trend: 'up',
    monthlyData: [],
    topEvents: [],
  });

  // === Static Config ===
  protected readonly monthlyChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => {
            const num = Number(value);
            if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
            return String(num);
          },
        },
      },
    },
  };

  // === Computed year label ===
  protected readonly currentYear = new Date().getUTCFullYear();
  /** Server-side cap on the events list — the template discloses it when hit. */
  protected readonly topEventsLimit = EVENT_GROWTH_TOP_EVENTS_LIMIT;

  // === Computed Signals ===
  protected readonly sortedTopEvents: Signal<EventGrowthTopEventView[]> = this.initSortedTopEvents();
  protected readonly formattedRevenue: Signal<string> = computed(() => EventGrowthDrawerComponent.formatMoney(this.data().totalRevenue));
  protected readonly formattedRegistrantYoyChange: Signal<string> = computed(() => {
    const v = this.data().registrantYoyChange;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  });
  protected readonly formattedRevenueYoyChange: Signal<string> = computed(() => {
    const v = this.data().revenueYoyChange;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  });
  protected readonly monthlyChartData: Signal<ChartData<'bar'>> = this.initMonthlyChartData();
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);

  protected onClose(): void {
    this.visible.set(false);
  }

  private initSortedTopEvents(): Signal<EventGrowthTopEventView[]> {
    return computed(() => {
      const today = new Date().toISOString().slice(0, 10);
      return [...this.data().topEvents]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((event) => ({
          ...event,
          formattedRevenue: EventGrowthDrawerComponent.formatMoney(event.revenue, event.currencyCode),
          isPast: !!event.date && event.date < today,
        }));
    });
  }

  private initMonthlyChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyData } = this.data();
      const quarterBuckets = new Map<string, number>();
      for (const d of monthlyData) {
        const [year, month] = d.month.split('-');
        const qi = Math.ceil(Number(month) / 3);
        const key = `Q${qi} ${year}`;
        quarterBuckets.set(key, (quarterBuckets.get(key) ?? 0) + d.value);
      }
      return {
        labels: Array.from(quarterBuckets.keys()),
        datasets: [
          {
            data: Array.from(quarterBuckets.values()),
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
            barPercentage: 0.6,
          },
        ],
      };
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { totalAttendees, totalEvents, totalRevenue, revenuePerAttendee, attendeeYoyChange, revenueYoyChange, topEvents, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (totalAttendees === 0 && totalEvents === 0) {
        return actions;
      }

      if (attendeeYoyChange <= -10) {
        actions.push({
          title: 'Reverse attendance decline',
          description: `Attendance dropped ${Math.abs(attendeeYoyChange).toFixed(1)}% YoY — review event mix, promotion windows, and channel performance`,
          priority: 'high',

          actionType: 'decline',
        });
      } else if (attendeeYoyChange <= -3) {
        actions.push({
          title: 'Attendance softening',
          description: `Attendance down ${Math.abs(attendeeYoyChange).toFixed(1)}% YoY — watch next event's registration pace`,
          priority: 'medium',

          actionType: 'investigate',
        });
      }

      if (revenueYoyChange <= -5) {
        const revenuePerAttendeeText = revenuePerAttendee > 0 ? ` at ${EventGrowthDrawerComponent.formatMoney(revenuePerAttendee)} per attendee` : '';
        actions.push({
          title: 'Event revenue declining',
          description: `Total event revenue down ${Math.abs(revenueYoyChange).toFixed(1)}% YoY${revenuePerAttendeeText} — review sponsorship packages and ticket pricing`,
          priority: 'medium',

          actionType: 'revenue',
        });
      }

      if (topEvents.length > 0 && totalAttendees > 0) {
        const leadEvent = topEvents.reduce((max, e) => (e.attendees > max.attendees ? e : max), topEvents[0]);
        const topShare = (leadEvent.attendees / totalAttendees) * 100;
        if (topShare > 50) {
          actions.push({
            title: 'One event carries the portfolio',
            description: `${leadEvent.name} drives ${topShare.toFixed(0)}% of total attendance — a single weak year on this event would hit the whole portfolio`,
            priority: 'medium',

            actionType: 'engagement',
          });
        }
      }

      // Decline detection must only compare COMPLETED quarters. The quarterly
      // series is keyed by EVENT start date, so the current and future quarters
      // hold events whose registrations are still coming in — a completed
      // quarter will always dwarf them, which would flag a "sustained decline"
      // for any foundation with upcoming events (e.g. a first-year foundation
      // with one big past quarter and a future pipeline).
      const currentQuarterStart = EventGrowthDrawerComponent.quarterStartKey(new Date());
      const completedQuarters = monthlyData.filter((d) => d.month < currentQuarterStart);
      if (completedQuarters.length >= 3) {
        const recent3 = completedQuarters.slice(-3);
        // The series has no buckets for quarters with zero events, so the last
        // three entries can span non-adjacent quarters (annual or sparse event
        // portfolios). "3 quarters straight" is only claimable when they are
        // truly consecutive.
        const indices = recent3.map((d) => EventGrowthDrawerComponent.quarterIndex(d.month));
        const consecutive = indices[1] === indices[0] + 1 && indices[2] === indices[1] + 1;
        const falling = consecutive && recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (falling && !actions.some((a) => a.actionType === 'decline')) {
          actions.push({
            title: 'Registrations falling 3 quarters straight',
            description: `Quarterly registrations fell from ${formatNumber(recent3[0].value)} to ${formatNumber(recent3[2].value)} — sustained decline, not a single bad event`,
            priority: 'high',

            actionType: 'decline',
          });
        }
      }

      // Silence when healthy — ED doesn't need filler actions
      void totalRevenue;

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalAttendees, totalEvents, totalRevenue, revenuePerAttendee, attendeeYoyChange, revenueYoyChange, topEvents } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (totalAttendees === 0) {
        return insights;
      }

      if (attendeeYoyChange >= 10) {
        insights.push({
          text: `Attendance up ${attendeeYoyChange.toFixed(1)}% YoY — ${formatNumber(totalAttendees)} attendees across ${totalEvents} events`,
          type: 'driver',
        });
      } else if (attendeeYoyChange <= -5) {
        insights.push({ text: `Attendance down ${Math.abs(attendeeYoyChange).toFixed(1)}% YoY`, type: 'warning' });
      }

      if (revenueYoyChange >= 10) {
        insights.push({
          text: `Event revenue up ${revenueYoyChange.toFixed(1)}% YoY to ${EventGrowthDrawerComponent.formatMoney(totalRevenue)}`,
          type: 'driver',
        });
      }

      if (revenuePerAttendee > 0) {
        insights.push({ text: `Revenue per attendee at ${EventGrowthDrawerComponent.formatMoney(revenuePerAttendee)}`, type: 'info' });
      }

      if (topEvents.length > 0) {
        const leadEvent = topEvents.reduce((max, e) => (e.attendees > max.attendees ? e : max), topEvents[0]);
        insights.push({
          text: `${leadEvent.name} leads with ${formatNumber(leadEvent.attendees)} attendees (${EventGrowthDrawerComponent.formatMoney(leadEvent.revenue, leadEvent.currencyCode)} revenue)`,
          type: 'info',
        });
      }

      return insights;
    });
  }

  /**
   * Quarter-start key ('YYYY-MM') for the quarter containing the given date —
   * matches the key format of the quarterly series (EVENT quarter start month),
   * so string comparison identifies completed vs current/future quarters.
   */
  private static quarterStartKey(date: Date): string {
    const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 1;
    return `${date.getUTCFullYear()}-${String(quarterStartMonth).padStart(2, '0')}`;
  }

  /**
   * Linear quarter index for a 'YYYY-MM' key (year * 4 + quarter ordinal) —
   * adjacent calendar quarters differ by exactly 1, so consecutiveness checks
   * are simple integer arithmetic.
   */
  private static quarterIndex(monthKey: string): number {
    const [year, month] = monthKey.split('-').map(Number);
    return year * 4 + Math.floor((month - 1) / 3);
  }

  /**
   * Compact money formatter in the currency's native SYMBOL (₹4.1M, ₩12.6M,
   * ¥1.9M, €49.2K, $238.9K) — matching how PCC's event health-metrics tables
   * display multi-currency revenue. Per-event revenue is denominated in the
   * event's LOCAL currency, so labeling everything `$` would be wrong.
   * Locale is pinned to en-US so SSR (Node) and the browser render identical
   * text — hydration flags a mismatch otherwise.
   */
  private static formatMoney(value: number, currencyCode: string = 'USD'): string {
    const code = currencyCode || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        notation: 'compact',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(value);
    } catch {
      // Unknown/invalid ISO code — degrade to a code prefix via the shared
      // compact formatter, so thresholds, rounding, and negative handling stay
      // identical to every other compact number in the app.
      return formatCompact(Math.abs(value), value < 0 ? '-' : '', `${code} `);
    }
  }
}
