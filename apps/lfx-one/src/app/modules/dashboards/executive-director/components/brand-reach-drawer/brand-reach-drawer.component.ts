// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { MARKETING_SOCIAL_PLATFORM_MAP } from '@lfx-one/shared/constants';
import { formatNumber, splitByPriority, type MarketingSplitByPriority } from '@lfx-one/shared/utils';
import { MarketingActionIconPipe } from '@pipes/marketing-action-icon.pipe';
import { DrawerModule } from 'primeng/drawer';

import type { BrandReachResponse, BrandReachSocialPlatformView, MarketingKeyInsight, MarketingRecommendedAction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-brand-reach-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, DecimalPipe, DrawerModule, MarketingActionIconPipe, TagComponent],
  templateUrl: './brand-reach-drawer.component.html',
})
export class BrandReachDrawerComponent {
  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Inputs ===
  public readonly data = input<BrandReachResponse>({
    totalSocialFollowers: 0,
    totalMonthlySessions: 0,
    activePlatforms: 0,
    changePercentage: 0,
    sessionMomChangePct: 0,
    trend: 'up',
    socialPlatforms: [],
    websiteDomains: [],
    weeklyTrend: [],
  });

  // === Computed Signals ===
  protected readonly socialPlatformViews: Signal<BrandReachSocialPlatformView[]> = computed(() =>
    this.data().socialPlatforms.map((platform) => {
      const presentation = MARKETING_SOCIAL_PLATFORM_MAP[platform.platformType] ?? MARKETING_SOCIAL_PLATFORM_MAP.other;
      return {
        ...platform,
        icon: presentation.icon,
        colorClass: presentation.colorClass,
      };
    })
  );

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

  private initRecommendedActions(): Signal<MarketingRecommendedAction[]> {
    return computed(() => {
      const { activePlatforms, socialPlatforms, totalSocialFollowers, websiteDomains, totalMonthlySessions } = this.data();
      const actions: MarketingRecommendedAction[] = [];

      if (activePlatforms === 0 && socialPlatforms.length === 0 && websiteDomains.length === 0) {
        return actions;
      }

      // Platform concentration — the risk ED must act on
      if (totalSocialFollowers > 0 && socialPlatforms.length > 0) {
        const top = [...socialPlatforms].sort((a, b) => b.followers - a.followers)[0];
        const topShare = (top.followers / totalSocialFollowers) * 100;
        if (topShare > 70) {
          actions.push({
            title: 'Reduce platform concentration risk',
            description: `${top.name} holds ${topShare.toFixed(0)}% of ${formatNumber(totalSocialFollowers)} followers — a platform policy change could halve reach. Grow the next 2 largest channels`,
            priority: 'high',
            dueLabel: 'This quarter',
            actionType: 'decline',
          });
        } else if (topShare > 55) {
          actions.push({
            title: 'Watch platform concentration',
            description: `${top.name} is ${topShare.toFixed(0)}% of total followers — diversify before it crosses 70%`,
            priority: 'medium',
            dueLabel: 'Next quarter',
            actionType: 'engagement',
          });
        }
      }

      // Under-diversified footprint — reduce single-network risk
      if (activePlatforms > 0 && activePlatforms < 3) {
        actions.push({
          title: 'Expand platform footprint',
          description: `Active on only ${activePlatforms} platform${activePlatforms === 1 ? '' : 's'} — evaluate adding complementary networks to reduce single-network risk`,
          priority: 'medium',
          dueLabel: 'This quarter',
          actionType: 'engagement',
        });
      }

      // Web-traffic concentration — a single domain getting the majority is fragile
      if (totalMonthlySessions > 0 && websiteDomains.length >= 2) {
        const topDomain = [...websiteDomains].sort((a, b) => b.sessions - a.sessions)[0];
        const topDomainShare = (topDomain.sessions / totalMonthlySessions) * 100;
        if (topDomainShare > 75) {
          actions.push({
            title: 'Web traffic over-reliant on one domain',
            description: `${topDomain.domain} drives ${topDomainShare.toFixed(0)}% of sessions — invest in secondary properties and cross-linking`,
            priority: 'medium',
            dueLabel: 'This quarter',
            actionType: 'engagement',
          });
        }
      }

      return actions;
    });
  }

  private initKeyInsights(): Signal<MarketingKeyInsight[]> {
    return computed(() => {
      const { activePlatforms, socialPlatforms, totalSocialFollowers, totalMonthlySessions, websiteDomains } = this.data();
      const insights: MarketingKeyInsight[] = [];

      if (activePlatforms === 0 && socialPlatforms.length === 0 && websiteDomains.length === 0) {
        return insights;
      }

      // Social leader
      if (totalSocialFollowers > 0 && socialPlatforms.length > 0) {
        const top = [...socialPlatforms].sort((a, b) => b.followers - a.followers)[0];
        const topShare = (top.followers / totalSocialFollowers) * 100;
        insights.push({
          text: `${top.name} leads with ${formatNumber(top.followers)} followers (${topShare.toFixed(0)}% of total)`,
          type: 'info',
        });
      }

      // Balanced mix — the true performing-well signal
      if (socialPlatforms.length >= 3 && totalSocialFollowers > 0) {
        const allBalanced = socialPlatforms.every((p) => (p.followers / totalSocialFollowers) * 100 < 50);
        if (allBalanced) {
          insights.push({ text: `Balanced social mix across ${activePlatforms} platforms — no channel above 50%`, type: 'driver' });
        }
      }

      // Strong multi-platform presence with justification
      if (activePlatforms >= 5) {
        insights.push({ text: `Strong multi-platform presence (${activePlatforms} active channels)`, type: 'driver' });
      }

      // Web traffic leader
      if (totalMonthlySessions > 0 && websiteDomains.length > 0) {
        const topDomain = [...websiteDomains].sort((a, b) => b.sessions - a.sessions)[0];
        insights.push({
          text: `${topDomain.domain} drives ${formatNumber(topDomain.sessions)} monthly sessions`,
          type: 'info',
        });
      }

      return insights;
    });
  }
}
