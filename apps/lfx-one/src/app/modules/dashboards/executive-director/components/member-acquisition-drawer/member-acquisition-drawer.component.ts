// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createBarChartOptions, createLineChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber, hexToRgba, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { FormatMoneyPipe } from '@pipes/format-money.pipe';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  MemberAcquisitionResponse,
  MemberRetentionResponse,
  MarketingRecommendedAction,
  MarketingKeyInsight,
  RevenueImpactResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-member-acquisition-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, TagComponent, FormatMoneyPipe],
  templateUrl: './member-acquisition-drawer.component.html',
  styleUrl: './member-acquisition-drawer.component.scss',
})
export class MemberAcquisitionDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<MemberAcquisitionResponse>({
    totalMembers: 0,
    totalMembersMonthlyData: [],
    totalMembersMonthlyLabels: [],
    newMembersThisQuarter: 0,
    newMemberRevenue: 0,
    changePercentage: 0,
    trend: 'up',
    quarterlyData: [],
  });

  public readonly retentionData = input<MemberRetentionResponse>({
    renewalRate: 0,
    netRevenueRetention: 0,
    changePercentage: 0,
    trend: 'up',
    target: 85,
    monthlyData: [],
  });

  public readonly revenueImpactData = input<RevenueImpactResponse>({
    pipelineInfluenced: 0,
    revenueAttributed: 0,
    matchRate: 0,
    changePercentage: 0,
    trend: 'up',
    attributionModels: { linear: 0, firstTouch: 0, lastTouch: 0 },
    engagementTypes: [],
    paidMedia: { roas: 0, impressions: 0, adSpend: 0, adRevenue: 0, monthlyTrend: [] },
    attributionChannels: [],
    projectBreakdown: [],
    eventRegistrationAttribution: { channelBreakdown: [], monthlyTrend: [] },
  });

  // === Computed Signals ===
  protected readonly formattedTotalMembers: Signal<string> = computed(() => formatNumber(this.data().totalMembers));
  protected readonly formattedNewMemberRevenue: Signal<string> = computed(() => '$' + formatNumber(this.data().newMemberRevenue));
  protected readonly totalMembersChartData: Signal<ChartData<'line'>> = this.initTotalMembersChartData();
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly retentionActions: Signal<MarketingRecommendedAction[]> = this.initRetentionActions();
  protected readonly retentionInsights: Signal<MarketingKeyInsight[]> = this.initRetentionInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() =>
    splitByPriority([...this.recommendedActions(), ...this.retentionActions()], [...this.keyInsights(), ...this.retentionInsights()])
  );
  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);
  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);
  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);
  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly acquisitionChartData: Signal<ChartData<'bar'>> = this.initAcquisitionChartData();

  protected readonly acquisitionChartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${ctx.parsed.y} new members`,
        },
      },
    },
  });

  protected readonly totalMembersChartOptions: ChartOptions<'line'> = createLineChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${formatNumber(ctx.parsed.y ?? 0)} members`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: { color: lfxColors.gray[500], font: { size: 11 } },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => formatNumber(Number(value)),
        },
      },
    },
  });

  protected readonly formatNumber = formatNumber;

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initTotalMembersChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { totalMembersMonthlyData, totalMembersMonthlyLabels } = this.data();
      return {
        labels: totalMembersMonthlyLabels,
        datasets: [
          {
            data: totalMembersMonthlyData,
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: lfxColors.blue[500],
          },
        ],
      };
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { newMembersThisQuarter, changePercentage, quarterlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (newMembersThisQuarter === 0 && quarterlyData.length === 0) {
        return actions;
      }

      // Acquisition decline — tier on magnitude
      if (changePercentage <= -15) {
        actions.push({
          title: 'Reverse acquisition decline',
          description: `New member signups dropped ${Math.abs(changePercentage).toFixed(1)}% QoQ — review top-of-funnel channels, conversion paths, and outbound pipeline`,
          priority: 'high',

          actionType: 'decline',
        });
      } else if (changePercentage <= -5) {
        actions.push({
          title: 'Acquisition softening',
          description: `New member signups down ${Math.abs(changePercentage).toFixed(1)}% QoQ — watch next quarter's pipeline and renewal mix`,
          priority: 'medium',

          actionType: 'investigate',
        });
      }

      // Revenue per new member — the tier-mix signal for an ED
      if (quarterlyData.length >= 2) {
        const recent = quarterlyData[quarterlyData.length - 1];
        const previous = quarterlyData[quarterlyData.length - 2];
        const recentPerMember = recent.newMembers > 0 ? recent.revenue / recent.newMembers : 0;
        const previousPerMember = previous.newMembers > 0 ? previous.revenue / previous.newMembers : 0;
        if (previousPerMember > 0 && recentPerMember > 0) {
          const delta = recentPerMember - previousPerMember;
          const declinePct = ((previousPerMember - recentPerMember) / previousPerMember) * 100;
          if (declinePct >= 15) {
            actions.push({
              title: 'Membership tier mix shifting down',
              description: `Revenue per new member fell ${declinePct.toFixed(0)}% (${formatCurrency(Math.abs(delta))}/member) — winning deals are smaller. Review tier positioning and sales qualification`,
              priority: 'high',
              actionType: 'revenue',
            });
          } else if (declinePct >= 5) {
            actions.push({
              title: 'Watch tier mix trend',
              description: `Revenue per new member down ${declinePct.toFixed(0)}% QoQ — not yet urgent, but track whether next quarter's deals are smaller still`,
              priority: 'medium',

              actionType: 'revenue',
            });
          }
        }
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { newMembersThisQuarter, newMemberRevenue, changePercentage, quarterlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (newMembersThisQuarter === 0 && quarterlyData.length === 0) {
        return insights;
      }

      // Acquisition QoQ
      if (changePercentage >= 10) {
        insights.push({
          text: `New member acquisition up ${changePercentage.toFixed(1)}% QoQ — ${newMembersThisQuarter} new members, ${formatCurrency(newMemberRevenue)} revenue`,
          type: 'driver',
        });
      } else if (changePercentage <= -10) {
        insights.push({ text: `New member acquisition down ${Math.abs(changePercentage).toFixed(1)}% QoQ`, type: 'warning' });
      }

      // Revenue-per-member trend (the tier-mix signal)
      if (quarterlyData.length >= 2) {
        const recent = quarterlyData[quarterlyData.length - 1];
        const previous = quarterlyData[quarterlyData.length - 2];
        const recentPerMember = recent.newMembers > 0 ? recent.revenue / recent.newMembers : 0;
        const previousPerMember = previous.newMembers > 0 ? previous.revenue / previous.newMembers : 0;
        if (previousPerMember > 0 && recentPerMember > previousPerMember) {
          const growthPct = ((recentPerMember - previousPerMember) / previousPerMember) * 100;
          insights.push({
            text: `Revenue per new member up ${growthPct.toFixed(0)}% QoQ to ${formatCurrency(recentPerMember)} — tier mix improving`,
            type: 'driver',
          });
        }
      }

      // 3 consecutive quarters of revenue growth — strongest performing-well signal
      if (quarterlyData.length >= 3) {
        const recent3 = quarterlyData.slice(-3);
        const revenueGrowing = recent3[0].revenue < recent3[1].revenue && recent3[1].revenue < recent3[2].revenue;
        if (revenueGrowing && recent3[0].revenue > 0) {
          const totalGrowth = ((recent3[2].revenue - recent3[0].revenue) / recent3[0].revenue) * 100;
          insights.push({ text: `New member revenue grew ${totalGrowth.toFixed(0)}% over 3 quarters — scale efficient channels`, type: 'driver' });
        }
      }

      // Best quarter in dataset
      if (quarterlyData.length >= 4) {
        const max = Math.max(...quarterlyData.map((q) => q.newMembers));
        const current = quarterlyData[quarterlyData.length - 1];
        if (current.newMembers === max && current.newMembers > 0) {
          insights.push({ text: `${current.quarter} is the strongest acquisition quarter on record`, type: 'driver' });
        }
      }

      return insights;
    });
  }

  private initAcquisitionChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { quarterlyData } = this.data();
      return {
        labels: quarterlyData.map((d) => d.quarter),
        datasets: [
          {
            data: quarterlyData.map((d) => d.newMembers),
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      };
    });
  }

  private initRetentionInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, monthlyData } = this.retentionData();
      const insights: MarketingKeyInsight[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return insights;
      }

      if (netRevenueRetention > 100) {
        insights.push({ text: `NRR above 100% at ${netRevenueRetention}% — successful upsell to higher tiers`, type: 'driver' });
      } else if (netRevenueRetention > 0 && netRevenueRetention < 100) {
        insights.push({ text: `NRR at ${netRevenueRetention}% — revenue declining from existing members`, type: 'warning' });
      }

      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isGrowing = recent3[0].value < recent3[1].value && recent3[1].value < recent3[2].value;
        const isShrinking = recent3[0].value > recent3[1].value && recent3[1].value > recent3[2].value;
        if (isGrowing) {
          insights.push({ text: 'Renewal rate improving for 3 consecutive months', type: 'driver' });
        } else if (isShrinking) {
          insights.push({ text: 'Renewal rate declining for 3 consecutive months', type: 'warning' });
        } else {
          insights.push({ text: 'Steady retention trend — no significant churn spikes detected', type: 'info' });
        }
      }

      return insights;
    });
  }

  private initRetentionActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, changePercentage, monthlyData } = this.retentionData();
      const actions: MarketingRecommendedAction[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return actions;
      }

      if (netRevenueRetention > 0 && netRevenueRetention < 90) {
        actions.push({
          title: 'Improve net revenue retention',
          description: `NRR at ${netRevenueRetention}% — significant revenue loss from existing members. Review downgrades and churn`,
          priority: 'high',

          actionType: 'revenue',
        });
      } else if (netRevenueRetention >= 90 && netRevenueRetention < 98) {
        actions.push({
          title: 'Monitor net revenue retention',
          description: `NRR at ${netRevenueRetention}% — revenue contraction from existing members. Explore upsell opportunities`,
          priority: 'medium',

          actionType: 'revenue',
        });
      }

      if (changePercentage < -3) {
        actions.push({
          title: 'Address retention decline',
          description: `Renewal rate dropped ${Math.abs(changePercentage)}% — review member satisfaction and renewal outreach timing`,
          priority: 'high',

          actionType: 'decline',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Maintain retention excellence',
          description: `${renewalRate}% renewal rate${netRevenueRetention > 100 ? ` with ${netRevenueRetention}% NRR` : ''}`,
          priority: 'low',

          actionType: 'growth',
        });
      }

      return actions;
    });
  }
}
