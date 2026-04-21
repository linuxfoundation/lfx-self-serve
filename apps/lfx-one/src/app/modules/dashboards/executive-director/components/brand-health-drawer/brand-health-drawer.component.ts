// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { formatNumber, hexToRgba, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { BrandHealthResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-brand-health-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, ChartComponent, DecimalPipe, DrawerModule, MarketingActionIconPipe, NgTemplateOutlet, TagComponent],
  templateUrl: './brand-health-drawer.component.html',
})
export class BrandHealthDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<BrandHealthResponse>({
    totalMentions: 0,
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    sentimentMomChangePp: 0,
    mentionMomChangePct: 0,
    trend: 'up',
    monthlyMentions: [],
    topProjects: [],
    topPositiveMentions: [],
    topNegativeMentions: [],
  });

  // === Static Config ===
  protected readonly mentionsTrendOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true, mode: 'index', intersect: false },
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

  // === Computed Signals ===
  protected readonly mentionsTrendData: Signal<ChartData<'line'>> = this.initMentionsTrendData();
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);

  protected readonly formattedSentimentMom: Signal<string> = computed(() => {
    const v = this.data().sentimentMomChangePp;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  });

  protected onClose(): void {
    this.visible.set(false);
  }

  private initMentionsTrendData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyMentions } = this.data();
      return {
        labels: monthlyMentions.map((d) => d.month),
        datasets: [
          {
            data: monthlyMentions.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: lfxColors.blue[500],
          },
        ],
      };
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { totalMentions, sentiment, sentimentMomChangePp } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (totalMentions === 0) {
        return actions;
      }

      if (sentiment.negative > 20) {
        actions.push({
          title: 'Address negative sentiment spike',
          description: `${sentiment.negative.toFixed(1)}% of mentions are negative — investigate top themes and coordinate response`,
          priority: 'high',
          dueLabel: 'This month',
          actionType: 'decline',
        });
      }

      if (sentimentMomChangePp < -2) {
        actions.push({
          title: 'Sentiment trending down',
          description: `Positive sentiment dropped ${Math.abs(sentimentMomChangePp).toFixed(1)}pp month-over-month — review recent coverage drivers`,
          priority: 'medium',
          dueLabel: 'This month',
          actionType: 'engagement',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Maintain brand sentiment momentum',
          description: `${formatNumber(totalMentions)} mentions with ${sentiment.positive.toFixed(0)}% positive sentiment`,
          priority: 'low',
          dueLabel: 'Ongoing',
          actionType: 'growth',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { totalMentions, sentiment, sentimentMomChangePp, topProjects } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (totalMentions === 0) {
        return insights;
      }

      if (sentiment.positive > 60) {
        insights.push({ text: `Strong positive sentiment at ${sentiment.positive.toFixed(0)}% of mentions`, type: 'driver' });
      }

      if (sentimentMomChangePp > 2) {
        insights.push({ text: `Positive sentiment up ${sentimentMomChangePp.toFixed(1)}pp month-over-month`, type: 'driver' });
      } else if (sentimentMomChangePp < -2) {
        insights.push({ text: `Positive sentiment down ${Math.abs(sentimentMomChangePp).toFixed(1)}pp month-over-month`, type: 'warning' });
      }

      if (topProjects.length > 0) {
        insights.push({
          text: `${topProjects[0].name} drives the most mentions (${formatNumber(topProjects[0].mentions)})`,
          type: 'info',
        });
      }

      return insights;
    });
  }
}
