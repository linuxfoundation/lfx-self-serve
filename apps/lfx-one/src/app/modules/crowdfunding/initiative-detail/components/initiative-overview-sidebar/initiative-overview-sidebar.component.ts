// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CardComponent } from '@components/card/card.component';
import { CROWDFUNDING_DONOR_AVATAR_PALETTE } from '@lfx-one/shared/constants';
import { CrowdfundingTransaction, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { switchMap } from 'rxjs';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';

@Component({
  selector: 'lfx-initiative-overview-sidebar',
  imports: [CardComponent, AvatarComponent, DatePipe],
  templateUrl: './initiative-overview-sidebar.component.html',
  styleUrl: './initiative-overview-sidebar.component.scss',
})
export class InitiativeOverviewSidebarComponent {
  private readonly crowdfundingService = inject(CrowdfundingService);

  public readonly initiative = input.required<InitiativeDetail>();
  public readonly viewAllFinancials = output<void>();

  protected readonly recentDonationsWithMeta = this.initRecentDonationsWithMeta();

  private initRecentDonationsWithMeta(): Signal<(CrowdfundingTransaction & { formattedAmount: string; avatarClass: string })[]> {
    const transactions = toSignal(
      toObservable(this.initiative).pipe(
        switchMap((initiative) => this.crowdfundingService.getInitiativeTransactions(initiative.slug, { type: 'donations', size: 5 }))
      ),
      { initialValue: { data: [], totalCount: 0, from: 0, size: 0 } }
    );

    return computed(() =>
      transactions().data.map((t) => ({
        ...t,
        formattedAmount: formatCurrency(t.amountCents / 100),
        avatarClass: this.donorAvatarClass(t.donorName ?? ''),
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
}
