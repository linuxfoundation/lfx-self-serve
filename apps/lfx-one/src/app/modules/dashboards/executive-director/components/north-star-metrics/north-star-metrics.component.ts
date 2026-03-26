// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal, Signal } from '@angular/core';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { NORTH_STAR_METRICS, NO_TOOLTIP_CHART_OPTIONS } from '@lfx-one/shared/constants';
import { lfxColors } from '@lfx-one/shared/constants';
import {
  DashboardDrawerType,
  DashboardMetricCard,
  EngagedCommunitySizeResponse,
  FlywheelConversionResponse,
  MemberAcquisitionResponse,
  MemberRetentionResponse,
} from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';

import { EngagedCommunityDrawerComponent } from '../engaged-community-drawer/engaged-community-drawer.component';
import { FlywheelConversionDrawerComponent } from '../flywheel-conversion-drawer/flywheel-conversion-drawer.component';
import { MemberAcquisitionDrawerComponent } from '../member-acquisition-drawer/member-acquisition-drawer.component';
import { MemberRetentionDrawerComponent } from '../member-retention-drawer/member-retention-drawer.component';

@Component({
  selector: 'lfx-north-star-metrics',
  imports: [
    MetricCardComponent,
    EngagedCommunityDrawerComponent,
    MemberAcquisitionDrawerComponent,
    MemberRetentionDrawerComponent,
    FlywheelConversionDrawerComponent,
  ],
  templateUrl: './north-star-metrics.component.html',
})
export class NorthStarMetricsComponent {
  // === WritableSignals ===
  public readonly activeDrawer = signal<DashboardDrawerType | null>(null);

  // === Constants ===
  protected readonly DashboardDrawerType = DashboardDrawerType;

  // === Mock Data — TODO: Replace with real Snowflake API data (no endpoints yet) ===
  protected readonly engagedCommunityData: EngagedCommunitySizeResponse = {
    totalMembers: 47_200,
    changePercentage: 12.4,
    trend: 'up',
    breakdown: {
      newsletterSubscribers: 28_500,
      communityMembers: 14_200,
      workingGroupMembers: 8_300,
    },
    monthlyData: [
      { month: 'Oct 2025', value: 38_000 },
      { month: 'Nov 2025', value: 40_100 },
      { month: 'Dec 2025', value: 41_800 },
      { month: 'Jan 2026', value: 43_500 },
      { month: 'Feb 2026', value: 45_200 },
      { month: 'Mar 2026', value: 47_200 },
    ],
  };

  protected readonly memberAcquisitionData: MemberAcquisitionResponse = {
    newMembersThisQuarter: 34,
    costPerAcquisition: 2_450,
    changePercentage: 8.2,
    trend: 'up',
    quarterlyData: [
      { quarter: 'Q2 2025', newMembers: 22, cac: 3_100 },
      { quarter: 'Q3 2025', newMembers: 28, cac: 2_800 },
      { quarter: 'Q4 2025', newMembers: 31, cac: 2_650 },
      { quarter: 'Q1 2026', newMembers: 34, cac: 2_450 },
    ],
  };

  protected readonly memberRetentionData: MemberRetentionResponse = {
    renewalRate: 88.5,
    netRevenueRetention: 104.2,
    changePercentage: 2.1,
    trend: 'up',
    target: 85,
    monthlyData: [
      { month: 'Oct 2025', value: 85.2 },
      { month: 'Nov 2025', value: 86.1 },
      { month: 'Dec 2025', value: 86.8 },
      { month: 'Jan 2026', value: 87.4 },
      { month: 'Feb 2026', value: 88.0 },
      { month: 'Mar 2026', value: 88.5 },
    ],
  };

  protected readonly flywheelConversionData: FlywheelConversionResponse = {
    conversionRate: 23.4,
    changePercentage: 5.7,
    trend: 'up',
    funnel: {
      eventAttendees: 4_200,
      convertedToNewsletter: 680,
      convertedToCommunity: 310,
      convertedToWorkingGroup: 120,
    },
    monthlyData: [
      { month: 'Oct 2025', value: 18.2 },
      { month: 'Nov 2025', value: 19.8 },
      { month: 'Dec 2025', value: 20.5 },
      { month: 'Jan 2026', value: 21.3 },
      { month: 'Feb 2026', value: 22.1 },
      { month: 'Mar 2026', value: 23.4 },
    ],
  };

  // === Computed Signals ===
  protected readonly northStarCards: Signal<DashboardMetricCard[]> = this.initNorthStarCards();

  // === Public Methods ===
  public handleCardClick(drawerType: DashboardDrawerType): void {
    this.activeDrawer.set(drawerType);
  }

  public handleDrawerClose(): void {
    this.activeDrawer.set(null);
  }

  // === Private Initializers ===
  private initNorthStarCards(): Signal<DashboardMetricCard[]> {
    return computed(() =>
      NORTH_STAR_METRICS.map((card) => {
        if (card.title === 'Engaged Community') {
          return this.transformEngagedCommunity(card);
        }
        if (card.title === 'Member Acq. Rate & CAC') {
          return this.transformMemberAcquisition(card);
        }
        if (card.title === 'Member Retention & NRR') {
          return this.transformMemberRetention(card);
        }
        if (card.title === 'Flywheel Conv. Rate') {
          return this.transformFlywheelConversion(card);
        }
        return card;
      })
    );
  }

  // === Private Helpers ===
  private transformEngagedCommunity(card: DashboardMetricCard): DashboardMetricCard {
    const data = this.engagedCommunityData;
    return {
      ...card,
      loading: false,
      value: this.formatNumber(data.totalMembers),
      subtitle: 'Deduplicated · Newsletter + Community + WG',
      changePercentage: `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%`,
      trend: data.trend,
      chartData: {
        labels: data.monthlyData.map((d) => d.month),
        datasets: [
          {
            data: data.monthlyData.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformMemberAcquisition(card: DashboardMetricCard): DashboardMetricCard {
    const data = this.memberAcquisitionData;
    return {
      ...card,
      loading: false,
      value: `${data.newMembersThisQuarter}`,
      subtitle: `This quarter · $${this.formatNumber(data.costPerAcquisition)} CAC`,
      changePercentage: `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%`,
      trend: data.trend,
      chartData: {
        labels: data.quarterlyData.map((d) => d.quarter),
        datasets: [
          {
            data: data.quarterlyData.map((d) => d.newMembers),
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformMemberRetention(card: DashboardMetricCard): DashboardMetricCard {
    const data = this.memberRetentionData;
    return {
      ...card,
      loading: false,
      value: `${data.renewalRate}%`,
      subtitle: `Target >${data.target}% · ${data.netRevenueRetention}% NRR`,
      changePercentage: `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%`,
      trend: data.trend,
      chartData: {
        labels: data.monthlyData.map((d) => d.month),
        datasets: [
          {
            data: data.monthlyData.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private transformFlywheelConversion(card: DashboardMetricCard): DashboardMetricCard {
    const data = this.flywheelConversionData;
    return {
      ...card,
      loading: false,
      value: `${data.conversionRate}%`,
      subtitle: 'Event → Newsletter/Community/WG (90d)',
      changePercentage: `${data.changePercentage > 0 ? '+' : ''}${data.changePercentage}%`,
      trend: data.trend,
      chartData: {
        labels: data.monthlyData.map((d) => d.month),
        datasets: [
          {
            data: data.monthlyData.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: hexToRgba(lfxColors.blue[500], 0.1),
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      chartOptions: NO_TOOLTIP_CHART_OPTIONS,
    };
  }

  private formatNumber(num: number): string {
    if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  }
}
