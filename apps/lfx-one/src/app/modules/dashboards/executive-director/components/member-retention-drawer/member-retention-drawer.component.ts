// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import type { ChartData, ChartOptions } from 'chart.js';
import type { MemberRetentionResponse, MarketingRecommendedAction, MarketingKeyInsight } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-member-retention-drawer',
  imports: [DrawerModule, ChartComponent],
  templateUrl: './member-retention-drawer.component.html',
})
export class MemberRetentionDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<MemberRetentionResponse>({
    renewalRate: 0,
    netRevenueRetention: 0,
    changePercentage: 0,
    trend: 'up',
    target: 85,
    monthlyData: [],
  });

  // === Computed Signals ===
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly retentionChartData: Signal<ChartData<'line'>> = this.initRetentionChartData();

  protected readonly retentionChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(1)}% renewal rate`,
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
          callback: (value) => `${value}%`,
        },
      },
    },
  };

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, changePercentage, target, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return actions;
      }

      // Below target
      if (renewalRate > 0 && renewalRate < target) {
        const gap = (target - renewalRate).toFixed(1);
        actions.push({
          title: 'Close retention gap to target',
          description: `Renewal rate is ${renewalRate}% vs ${target}% target — ${gap} points below. Focus on at-risk member engagement`,
          priority: 'high',
          dueLabel: 'This quarter',
          iconClass: 'fa-light fa-bullseye-arrow',
        });
      }

      // NRR below 100% means revenue shrinking
      if (netRevenueRetention > 0 && netRevenueRetention < 100) {
        actions.push({
          title: 'Improve net revenue retention',
          description: `NRR at ${netRevenueRetention}% — revenue shrinking from existing members. Explore upsell opportunities`,
          priority: 'high',
          dueLabel: 'This quarter',
          iconClass: 'fa-light fa-money-bill-trend-up',
        });
      }

      // Declining trend
      if (changePercentage < -3) {
        actions.push({
          title: 'Address retention decline',
          description: `Renewal rate dropped ${Math.abs(changePercentage)}% — review member satisfaction and renewal outreach timing`,
          priority: 'high',
          dueLabel: 'This month',
          iconClass: 'fa-light fa-chart-line-down',
        });
      }

      if (actions.length === 0) {
        actions.push({
          title: 'Maintain retention excellence',
          description: `${renewalRate}% renewal rate${renewalRate >= target ? ` exceeds ${target}% target` : ''}${netRevenueRetention > 100 ? ` with ${netRevenueRetention}% NRR` : ''}`,
          priority: 'low',
          dueLabel: 'Ongoing',
          iconClass: 'fa-light fa-chart-line-up',
        });
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, target, monthlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return insights;
      }

      // Target comparison
      if (renewalRate >= target) {
        insights.push({ text: `Renewal rate at ${renewalRate}% exceeds ${target}% target`, type: 'driver' });
      } else if (renewalRate > 0) {
        insights.push({ text: `Renewal rate at ${renewalRate}% is below ${target}% target`, type: 'warning' });
      }

      // NRR insight
      if (netRevenueRetention > 100) {
        insights.push({ text: `NRR above 100% at ${netRevenueRetention}% — successful upsell to higher tiers`, type: 'driver' });
      } else if (netRevenueRetention > 0 && netRevenueRetention < 100) {
        insights.push({ text: `NRR at ${netRevenueRetention}% — revenue declining from existing members`, type: 'warning' });
      }

      // Monthly trend
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

  private initRetentionChartData(): Signal<ChartData<'line'>> {
    return computed(() => {
      const { monthlyData, target } = this.data();
      return {
        labels: monthlyData.map((d) => d.month),
        datasets: [
          {
            label: 'Renewal Rate',
            data: monthlyData.map((d) => d.value),
            borderColor: lfxColors.blue[500],
            backgroundColor: `${lfxColors.blue[500]}1A`,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: lfxColors.blue[500],
          },
          {
            label: 'Target',
            data: monthlyData.map(() => target),
            borderColor: lfxColors.gray[400],
            borderDash: [5, 5],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
        ],
      };
    });
  }
}
