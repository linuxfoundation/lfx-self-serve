// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { DonutChartComponent } from '@components/donut-chart/donut-chart.component';
import { FundingGoalWithMeta, InitiativeDetail } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-finance-summary',
  imports: [CardComponent, DonutChartComponent],
  templateUrl: './initiative-finance-summary.component.html',
  styleUrl: './initiative-finance-summary.component.scss',
})
export class InitiativeFinanceSummaryComponent {
  public readonly initiative = input.required<InitiativeDetail>();

  protected readonly progressPercent = computed(() => {
    const raised = this.initiative().fundingStatus?.amountRaisedCents ?? 0;
    const goal = this.initiative().fundingStatus?.goalsTotalCents ?? 0;
    if (goal === 0) return 0;
    return Math.min(100, Math.round((raised / goal) * 100));
  });

  protected readonly formattedBalance = computed(() => this.formatCurrency((this.initiative().currentBalanceCents ?? 0) / 100));
  protected readonly formattedRaised = computed(() => this.formatCurrency((this.initiative().fundingStatus?.amountRaisedCents ?? 0) / 100));
  protected readonly formattedGoal = this.initFormattedGoal();
  protected readonly fundingGoalsWithMeta = this.initFundingGoalsWithMeta();

  private initFormattedGoal(): Signal<string | null> {
    return computed(() => {
      const goalCents = this.initiative().fundingStatus?.goalsTotalCents;
      return goalCents != null && goalCents > 0 ? this.formatCurrency(goalCents / 100) : null;
    });
  }

  private initFundingGoalsWithMeta(): Signal<FundingGoalWithMeta[]> {
    return computed(() =>
      (this.initiative().fundingGoals ?? []).map((goal) => {
        const donatedPct = goal.goalCents > 0 ? Math.min(100, Math.round((goal.donatedCents / goal.goalCents) * 100)) : 0;
        const spentPct = goal.goalCents > 0 ? Math.min(100, Math.round((goal.spentCents / goal.goalCents) * 100)) : 0;
        return {
          ...goal,
          formattedGoal: this.formatCurrency(goal.goalCents / 100),
          formattedDonated: this.formatCurrency(goal.donatedCents / 100),
          formattedSpent: this.formatCurrency(goal.spentCents / 100),
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
