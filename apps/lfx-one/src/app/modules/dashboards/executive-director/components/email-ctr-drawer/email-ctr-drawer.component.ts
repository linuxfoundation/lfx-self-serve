// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createBarChartOptions, createHorizontalBarChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type { EmailCtrResponse, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';
import { splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-email-ctr-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, ChartComponent, SkeletonModule, TagComponent, MarketingActionIconPipe],
  templateUrl: './email-ctr-drawer.component.html',
  styleUrl: './email-ctr-drawer.component.scss',
})
export class EmailCtrDrawerComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals (lazy-loaded data) ===
  protected readonly drawerData: Signal<EmailCtrResponse> = this.initDrawerData();
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();
  protected readonly campaignChartData: Signal<ChartData<'bar'>> = this.initCampaignChartData();
  protected readonly reachVsOpensChartData: Signal<ChartData<'bar'>> = this.initReachVsOpensChartData();

  protected readonly chartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}% CTR`,
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
          callback: (value) => `${Number(value).toFixed(1)}%`,
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  });

  protected readonly campaignChartOptions: ChartOptions<'bar'> = createHorizontalBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.x ?? 0).toFixed(2)}% CTR`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[300] },
        ticks: {
          color: lfxColors.gray[500],
          font: { size: 11 },
          callback: (value) => `${Number(value).toFixed(1)}%`,
        },
      },
      y: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[600], font: { size: 12 } },
      },
    },
  });

  protected readonly reachVsOpensChartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: lfxColors.gray[600], font: { size: 11 }, boxWidth: 12, padding: 16 },
      },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toLocaleString()}`,
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
          callback: (value) => {
            const num = Number(value);
            if (num >= 999_950) return `${(num / 1_000_000).toFixed(1)}M`;
            if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
            return String(num);
          },
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  });

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<EmailCtrResponse> {
    const defaultValue: EmailCtrResponse = {
      currentCtr: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      campaignGroups: [],
      monthlySends: [],
      monthlyOpens: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug || ''));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, slug]) => isVisible && !!slug),
        map(([, slug]) => slug),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationSlug) =>
          this.analyticsService.getEmailCtr(foundationSlug).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load email CTR details.',
              });
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyData, monthlyLabels } = this.drawerData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
          },
        ],
      };
    });
  }

  private initCampaignChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { campaignGroups } = this.drawerData();
      const sorted = [...campaignGroups].sort((a, b) => b.avgCtr - a.avgCtr);
      return {
        labels: sorted.map((c) => c.campaignName),
        datasets: [
          {
            data: sorted.map((c) => c.avgCtr),
            backgroundColor: [lfxColors.blue[700], lfxColors.blue[500], lfxColors.blue[400], lfxColors.blue[300], lfxColors.blue[200]],
            borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
            borderSkipped: 'start',
          },
        ],
      };
    });
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { changePercentage, campaignGroups, monthlySends, monthlyOpens } = this.drawerData();
      const actions: MarketingRecommendedAction[] = [];

      if (changePercentage < 0) {
        actions.push({
          title: 'Test new call-to-action formats',
          description: `CTR dropped ${Math.abs(changePercentage)}% — experiment with button placement and copy in the next send`,
          priority: 'high',
          dueLabel: 'Next send',
          actionType: 'optimize',
        });
      }

      if (monthlySends.length >= 2 && monthlyOpens.length >= 2) {
        const latestOpenRate =
          monthlySends[monthlySends.length - 1] > 0 ? (monthlyOpens[monthlyOpens.length - 1] / monthlySends[monthlySends.length - 1]) * 100 : 0;
        const prevOpenRate =
          monthlySends[monthlySends.length - 2] > 0 ? (monthlyOpens[monthlyOpens.length - 2] / monthlySends[monthlySends.length - 2]) * 100 : 0;
        if (latestOpenRate < prevOpenRate) {
          actions.push({
            title: 'Optimize email subject lines',
            description: `Open rate declined from ${prevOpenRate.toFixed(1)}% to ${latestOpenRate.toFixed(1)}% — A/B test subject lines`,
            priority: latestOpenRate < prevOpenRate * 0.9 ? 'high' : 'medium',
            dueLabel: 'Next send',
            actionType: 'content',
          });
        }
      }

      if (campaignGroups.length > 1) {
        const sorted = [...campaignGroups].sort((a, b) => b.avgCtr - a.avgCtr);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        if (best.avgCtr > worst.avgCtr * 1.5) {
          actions.push({
            title: `Replicate "${best.campaignName}" approach`,
            description: `Top campaign has ${best.avgCtr.toFixed(1)}% CTR vs ${worst.avgCtr.toFixed(1)}% for "${worst.campaignName}" — apply winning format`,
            priority: 'medium',
            dueLabel: 'This month',
            actionType: 'optimize',
          });
        }
      }

      if (changePercentage >= 0 && actions.length === 0) {
        actions.push({
          title: 'Maintain current momentum',
          description: `CTR is trending up (+${changePercentage}%) — continue current content strategy`,
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
      const { currentCtr, changePercentage, monthlyData, campaignGroups, monthlySends, monthlyOpens } = this.drawerData();
      const insights: MarketingKeyInsight[] = [];

      if (currentCtr === 0 && monthlyData.length === 0) {
        return insights;
      }

      // CTR trend insight
      if (changePercentage < -10) {
        insights.push({ text: `CTR dropped ${Math.abs(changePercentage)}% vs 6-month avg — significant decline`, type: 'warning' });
      } else if (changePercentage < 0) {
        insights.push({ text: `CTR declined ${Math.abs(changePercentage)}% vs 6-month avg`, type: 'warning' });
      } else if (changePercentage > 10) {
        insights.push({ text: `CTR grew ${changePercentage}% vs 6-month avg — strong improvement`, type: 'driver' });
      } else if (changePercentage > 0) {
        insights.push({ text: `CTR up ${changePercentage}% vs 6-month avg`, type: 'info' });
      }

      // Open rate insight
      if (monthlySends.length > 0 && monthlyOpens.length > 0) {
        const totalSends = monthlySends.reduce((sum, v) => sum + v, 0);
        const totalOpens = monthlyOpens.reduce((sum, v) => sum + v, 0);
        if (totalSends > 0) {
          const avgOpenRate = (totalOpens / totalSends) * 100;
          insights.push({ text: `Average open rate: ${avgOpenRate.toFixed(1)}% across ${totalSends.toLocaleString()} sends`, type: 'info' });
        }
      }

      // Campaign spread insight
      if (campaignGroups.length > 1) {
        const ctrs = campaignGroups.map((c) => c.avgCtr);
        const max = Math.max(...ctrs);
        const min = Math.min(...ctrs);
        if (max > min * 2) {
          insights.push({ text: `Wide CTR spread across campaigns (${min.toFixed(1)}%–${max.toFixed(1)}%)`, type: 'warning' });
        } else {
          insights.push({ text: `CTR consistent across campaigns (${min.toFixed(1)}%–${max.toFixed(1)}%)`, type: 'info' });
        }
      }

      // Monthly trend consistency
      if (monthlyData.length >= 3) {
        const recent3 = monthlyData.slice(-3);
        const isConsistentlyDecreasing = recent3[0] > recent3[1] && recent3[1] > recent3[2];
        const isConsistentlyIncreasing = recent3[0] < recent3[1] && recent3[1] < recent3[2];
        if (isConsistentlyDecreasing) {
          insights.push({ text: 'CTR declining for 3 consecutive months', type: 'warning' });
        } else if (isConsistentlyIncreasing) {
          insights.push({ text: 'CTR improving for 3 consecutive months', type: 'driver' });
        }
      }

      return insights;
    });
  }

  private initReachVsOpensChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlySends, monthlyOpens, monthlyLabels } = this.drawerData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            label: 'Reach (Sends)',
            data: monthlySends,
            backgroundColor: lfxColors.blue[500],
            borderRadius: 4,
          },
          {
            label: 'Opens',
            data: monthlyOpens,
            backgroundColor: lfxColors.blue[300],
            borderRadius: 4,
          },
        ],
      };
    });
  }
}
