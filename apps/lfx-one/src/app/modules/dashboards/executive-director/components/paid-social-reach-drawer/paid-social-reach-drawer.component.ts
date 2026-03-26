// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { TagComponent } from '@components/tag/tag.component';
import { createBarChartOptions, DASHBOARD_TOOLTIP_CONFIG, lfxColors, MARKETING_ACTION_ICON_MAP } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';

import type { ChartData, ChartOptions } from 'chart.js';
import type { SocialReachResponse, MarketingRecommendedAction, MarketingKeyInsight, MarketingActionType } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-paid-social-reach-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DrawerModule, ChartComponent, SkeletonModule, TagComponent],
  templateUrl: './paid-social-reach-drawer.component.html',
  styleUrl: './paid-social-reach-drawer.component.scss',
})
export class PaidSocialReachDrawerComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals (lazy-loaded data) ===
  protected readonly drawerData: Signal<SocialReachResponse> = this.initDrawerData();
  protected readonly formattedTotalReach: Signal<string> = computed(() => formatNumber(this.drawerData().totalReach));
  protected readonly formattedTotalRevenue: Signal<string> = computed(() => formatCurrency(this.drawerData().totalRevenue));
  protected readonly recommendedActions: Signal<MarketingRecommendedAction[]> = this.initRecommendedActions();
  protected readonly keyInsights: Signal<MarketingKeyInsight[]> = this.initKeyInsights();
  protected readonly chartData: Signal<ChartData<'bar'>> = this.initChartData();
  protected readonly roasChartData: Signal<ChartData<'bar'>> = this.initRoasChartData();
  protected readonly hasRoasData: Signal<boolean> = computed(() => {
    const roas = this.drawerData().monthlyRoas;
    return !!roas && roas.some((v) => v > 0);
  });

  protected readonly chartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y ?? 0;
            if (val >= 1_000_000) return ` ${(val / 1_000_000).toFixed(1)}M impressions`;
            if (val >= 1_000) return ` ${(val / 1_000).toFixed(1)}K impressions`;
            return ` ${val.toLocaleString()} impressions`;
          },
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

  protected readonly roasChartOptions: ChartOptions<'bar'> = createBarChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...DASHBOARD_TOOLTIP_CONFIG,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}x ROAS`,
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
          callback: (value) => `${Number(value).toFixed(1)}x`,
        },
      },
    },
    datasets: {
      bar: { barPercentage: 0.7, categoryPercentage: 0.9 },
    },
  });

  protected readonly formatNumber = formatNumber;
  protected readonly formatCurrency = formatCurrency;

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected actionIcon(type: MarketingActionType): string {
    return MARKETING_ACTION_ICON_MAP[type];
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<SocialReachResponse> {
    const defaultValue: SocialReachResponse = {
      totalReach: 0,
      roas: 0,
      totalSpend: 0,
      totalRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      monthlyData: [],
      monthlyLabels: [],
      monthlyRoas: [],
      channelGroups: [],
    };

    const visible$ = toObservable(this.visible);
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.name || ''));

    return toSignal(
      combineLatest([visible$, foundation$]).pipe(
        filter(([isVisible, name]) => isVisible && !!name),
        map(([, name]) => name),
        tap(() => this.drawerLoading.set(true)),
        switchMap((foundationName) =>
          this.analyticsService.getSocialReach(foundationName).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load paid social reach details.',
              });
              return of(defaultValue);
            })
          )
        )
      ),
      { initialValue: defaultValue }
    );
  }

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { roas, changePercentage, totalSpend, totalRevenue } = this.drawerData();
      const actions: MarketingRecommendedAction[] = [];

      if (roas > 0 && roas < 1) {
        actions.push({
          title: 'Review ad spend efficiency',
          description: `ROAS is ${roas.toFixed(2)}x — spending more than earning. Pause underperforming campaigns`,
          priority: 'high',
          dueLabel: 'This week',
          actionType: 'decline',
        });
      } else if (changePercentage < -10) {
        actions.push({
          title: 'Investigate reach decline',
          description: `Impressions dropped ${Math.abs(changePercentage)}% — review targeting and bid strategy`,
          priority: 'high',
          dueLabel: 'Next campaign',
          actionType: 'investigate',
        });
      }

      if (actions.length === 0) {
        if (roas > 1) {
          actions.push({
            title: 'Scale current campaigns',
            description: `ROAS at ${roas.toFixed(2)}x with ${formatCurrency(totalRevenue)} revenue on ${formatCurrency(totalSpend)} spend — room to grow`,
            priority: 'low',
            dueLabel: 'Ongoing',
            actionType: 'growth',
          });
        } else {
          actions.push({
            title: 'Monitor campaign performance',
            description: `${formatNumber(this.drawerData().totalReach)} total impressions — tracking performance`,
            priority: 'low',
            dueLabel: 'Ongoing',
            actionType: 'growth',
          });
        }
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { roas, totalReach, totalSpend, totalRevenue, changePercentage, monthlyRoas } = this.drawerData();
      const insights: MarketingKeyInsight[] = [];

      if (totalReach === 0) {
        return insights;
      }

      // ROAS insight
      if (roas >= 3) {
        insights.push({
          text: `Strong ROAS at ${roas.toFixed(2)}x — ${formatCurrency(totalRevenue)} revenue on ${formatCurrency(totalSpend)} spend`,
          type: 'driver',
        });
      } else if (roas >= 1) {
        insights.push({ text: `ROAS at ${roas.toFixed(2)}x — profitable but room for optimization`, type: 'info' });
      } else if (totalSpend > 0) {
        insights.push({
          text: `ROAS below break-even at ${roas.toFixed(2)}x — spending ${formatCurrency(totalSpend)} for ${formatCurrency(totalRevenue)} revenue`,
          type: 'warning',
        });
      }

      // Impression trend
      if (changePercentage !== 0) {
        if (changePercentage > 0) {
          insights.push({ text: `Impressions grew ${changePercentage}% month-over-month`, type: 'driver' });
        } else {
          insights.push({ text: `Impressions declined ${Math.abs(changePercentage)}% month-over-month`, type: 'warning' });
        }
      }

      // ROAS trend
      if (monthlyRoas && monthlyRoas.length >= 3) {
        const recent3 = monthlyRoas.slice(-3);
        const isDecreasing = recent3[0] > recent3[1] && recent3[1] > recent3[2];
        const isIncreasing = recent3[0] < recent3[1] && recent3[1] < recent3[2];
        if (isDecreasing) {
          insights.push({ text: 'ROAS declining for 3 consecutive months', type: 'warning' });
        } else if (isIncreasing) {
          insights.push({ text: 'ROAS improving for 3 consecutive months', type: 'driver' });
        }
      }

      return insights;
    });
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

  private initRoasChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { monthlyRoas, monthlyLabels } = this.drawerData();
      return {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyRoas || [],
            backgroundColor: lfxColors.emerald[500],
            borderRadius: 4,
          },
        ],
      };
    });
  }
}
