// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';

import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EventGrowthResponse, EventGrowthTopEventView, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-event-growth-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, ChartComponent, DecimalPipe, DrawerModule, MarketingActionIconPipe, TagComponent],
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

  // === WritableSignals ===
  protected readonly topEventsSortBy = signal<'attendees' | 'revenue'>('attendees');

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
      const key = this.topEventsSortBy();
      return [...this.data().topEvents]
        .sort((a, b) => (key === 'revenue' ? b.revenue - a.revenue : b.attendees - a.attendees))
        .map((event) => ({ ...event, formattedRevenue: EventGrowthDrawerComponent.formatMoney(event.revenue) }));
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
          dueLabel: 'This month',
          actionType: 'decline',
        });
      } else if (attendeeYoyChange <= -3) {
        actions.push({
          title: 'Attendance softening',
          description: `Attendance down ${Math.abs(attendeeYoyChange).toFixed(1)}% YoY — watch next event's registration pace`,
          priority: 'medium',
          dueLabel: 'Next event',
          actionType: 'investigate',
        });
      }

      if (revenueYoyChange <= -5) {
        const revenuePerAttendeeText = revenuePerAttendee > 0 ? ` at ${EventGrowthDrawerComponent.formatMoney(revenuePerAttendee)} per attendee` : '';
        actions.push({
          title: 'Event revenue declining',
          description: `Total event revenue down ${Math.abs(revenueYoyChange).toFixed(1)}% YoY${revenuePerAttendeeText} — review sponsorship packages and ticket pricing`,
          priority: 'medium',
          dueLabel: 'This quarter',
          actionType: 'revenue',
        });
      }

      if (topEvents.length > 0 && totalAttendees > 0) {
        const topShare = (topEvents[0].attendees / totalAttendees) * 100;
        if (topShare > 50) {
          actions.push({
            title: 'One event carries the portfolio',
            description: `${topEvents[0].name} drives ${topShare.toFixed(0)}% of total attendance — a single weak year on this event would hit the whole portfolio`,
            priority: 'medium',
            dueLabel: 'Next planning cycle',
            actionType: 'engagement',
          });
        }
      }

      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const falling = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (falling && !actions.some((a) => a.actionType === 'decline')) {
          actions.push({
            title: 'Attendance falling 3 months straight',
            description: `Monthly attendance fell from ${formatNumber(recent3[0].value)} to ${formatNumber(recent3[2].value)} — pattern, not a single bad event`,
            priority: 'high',
            dueLabel: 'This month',
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
        insights.push({
          text: `${topEvents[0].name} leads with ${formatNumber(topEvents[0].attendees)} attendees (${EventGrowthDrawerComponent.formatMoney(topEvents[0].revenue)} revenue)`,
          type: 'info',
        });
      }

      return insights;
    });
  }

  private static formatMoney(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value).toLocaleString()}`;
  }
}
