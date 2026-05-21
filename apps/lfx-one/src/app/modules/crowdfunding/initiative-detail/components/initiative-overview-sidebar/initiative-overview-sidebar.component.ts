// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CardComponent } from '@components/card/card.component';
import { CROWDFUNDING_DONOR_AVATAR_PALETTE } from '@lfx-one/shared/constants';
import { CrowdfundingInitiativeDetail, DonationTransaction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-overview-sidebar',
  imports: [CardComponent, AvatarComponent],
  templateUrl: './initiative-overview-sidebar.component.html',
  styleUrl: './initiative-overview-sidebar.component.scss',
})
export class InitiativeOverviewSidebarComponent {
  public readonly initiative = input.required<CrowdfundingInitiativeDetail>();
  public readonly viewAllFinancials = output<void>();

  protected readonly recentDonationsWithMeta = this.initRecentDonationsWithMeta();

  private initRecentDonationsWithMeta(): Signal<(DonationTransaction & { formattedAmount: string; avatarClass: string })[]> {
    return computed(() =>
      this.initiative()
        .donationsIn.slice(0, 5)
        .map((d) => ({
          ...d,
          formattedAmount: this.formatCurrency(d.amount),
          avatarClass: this.donorAvatarClass(d.who),
        }))
    );
  }

  private formatCurrency(value: number): string {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  }

  private donorAvatarClass(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
    }
    return CROWDFUNDING_DONOR_AVATAR_PALETTE[Math.abs(hash) % CROWDFUNDING_DONOR_AVATAR_PALETTE.length];
  }
}
