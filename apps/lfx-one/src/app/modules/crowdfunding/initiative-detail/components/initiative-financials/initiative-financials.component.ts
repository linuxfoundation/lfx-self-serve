// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CROWDFUNDING_DONOR_AVATAR_PALETTE } from '@lfx-one/shared/constants';
import { CrowdfundingInitiativeDetail, DonationTransaction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-financials',
  imports: [AvatarComponent],
  templateUrl: './initiative-financials.component.html',
  styleUrl: './initiative-financials.component.scss',
})
export class InitiativeFinancialsComponent {
  public readonly initiative = input.required<CrowdfundingInitiativeDetail>();

  protected readonly totalReceived = computed(() => this.initiative().donationsIn.reduce((sum, d) => sum + d.amount, 0));
  protected readonly totalExpenses = computed(() => this.initiative().donationsOut.reduce((sum, d) => sum + d.amount, 0));
  protected readonly balance = computed(() => this.totalReceived() - this.totalExpenses());

  protected readonly formattedTotalReceived = computed(() => this.formatCurrency(this.totalReceived()));
  protected readonly formattedTotalExpenses = computed(() => this.formatCurrency(this.totalExpenses()));
  protected readonly formattedBalance = computed(() => this.formatCurrency(this.balance()));
  protected readonly donationsInWithMeta = this.initDonationsInWithMeta();
  protected readonly donationsOutWithMeta = this.initDonationsOutWithMeta();

  private initDonationsInWithMeta(): Signal<(DonationTransaction & { formattedAmount: string; avatarClass: string })[]> {
    return computed(() =>
      this.initiative().donationsIn.map((d) => ({
        ...d,
        formattedAmount: this.formatCurrency(d.amount),
        avatarClass: this.donorAvatarClass(d.who),
      }))
    );
  }

  private initDonationsOutWithMeta(): Signal<(DonationTransaction & { formattedAmount: string })[]> {
    return computed(() =>
      this.initiative().donationsOut.map((d) => ({
        ...d,
        formattedAmount: this.formatCurrency(d.amount),
      }))
    );
  }

  private donorAvatarClass(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
    }
    return CROWDFUNDING_DONOR_AVATAR_PALETTE[Math.abs(hash) % CROWDFUNDING_DONOR_AVATAR_PALETTE.length];
  }

  private formatCurrency(value: number): string {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  }
}
