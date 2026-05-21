// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { DonutChartComponent } from '@components/donut-chart/donut-chart.component';
import { AllocItemWithMeta, CrowdfundingInitiativeDetail } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-finance-summary',
  imports: [CardComponent, DonutChartComponent],
  templateUrl: './initiative-finance-summary.component.html',
  styleUrl: './initiative-finance-summary.component.scss',
})
export class InitiativeFinanceSummaryComponent {
  public readonly initiative = input.required<CrowdfundingInitiativeDetail>();

  protected readonly progressPercent = computed(() => {
    const { raised, goal } = this.initiative();
    if (!goal || goal === 0) return 0;
    return Math.min(100, Math.round((raised / goal) * 100));
  });

  protected readonly formattedBalance = computed(() => this.formatCurrency(this.initiative().balance));
  protected readonly formattedRaised = computed(() => this.formatCurrency(this.initiative().raised));
  protected readonly formattedGoal = this.initFormattedGoal();
  protected readonly formattedMonthlyDelta = computed(() => this.formatCurrency(this.initiative().monthlyDelta));
  protected readonly allocItemsWithMeta = this.initAllocItemsWithMeta();

  private initFormattedGoal(): Signal<string | null> {
    return computed(() => {
      const g = this.initiative().goal;
      return g != null ? this.formatCurrency(g) : null;
    });
  }

  private initAllocItemsWithMeta(): Signal<AllocItemWithMeta[]> {
    return computed(() =>
      this.initiative().alloc.map((item) => {
        const donated = Math.round((item.pct / 100) * item.total);
        const donatedPct = Math.min(100, item.pct);
        const spentPct = item.total > 0 ? Math.min(100, Math.round((item.spent / item.total) * 100)) : 0;
        return {
          ...item,
          donated,
          formattedTotal: this.formatCurrency(item.total),
          formattedDonated: this.formatCurrency(donated),
          formattedSpent: this.formatCurrency(item.spent),
          rings: [
            { value: donatedPct, color: '#006BFF' },
            { value: spentPct, color: '#1e293b' },
          ],
        };
      })
    );
  }

  private formatCurrency(value: number): string {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  }
}
