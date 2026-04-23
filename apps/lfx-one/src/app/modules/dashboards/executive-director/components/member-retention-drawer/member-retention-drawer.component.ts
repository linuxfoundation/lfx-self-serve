// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { DrawerModule } from 'primeng/drawer';

import type { MarketingKeyInsight, MarketingRecommendedAction, MemberRetentionResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-member-retention-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, TagComponent, MarketingActionIconPipe],
  templateUrl: './member-retention-drawer.component.html',
  styleUrl: './member-retention-drawer.component.scss',
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
  private readonly split: Signal<MarketingSplitByPriority> = computed(() => splitByPriority(this.recommendedActions(), this.keyInsights()));

  protected readonly attentionActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().attentionActions);

  protected readonly attentionInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().attentionInsights);

  protected readonly performingActions: Signal<MarketingRecommendedAction[]> = computed(() => this.split().performingActions);

  protected readonly performingInsights: Signal<MarketingKeyInsight[]> = computed(() => this.split().performingInsights);

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, changePercentage, monthlyData } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return actions;
      }

      // NRR below 98% means meaningful revenue shrinking — ignore noise above 98%
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

      // Declining trend
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

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { renewalRate, netRevenueRetention, monthlyData } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (renewalRate === 0 && monthlyData.length === 0) {
        return insights;
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
}
