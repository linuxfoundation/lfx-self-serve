// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import {
  CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES,
  CROWDFUNDING_FUND_TYPE_COLOR_CLASSES,
  CROWDFUNDING_FUND_TYPE_ICONS,
  CROWDFUNDING_FUND_TYPE_LABELS,
} from '@lfx-one/shared/constants';
import { InitiativeBase } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-initiative-card',
  imports: [AvatarComponent],
  templateUrl: './initiative-card.component.html',
  styleUrl: './initiative-card.component.scss',
})
export class InitiativeCardComponent {
  public readonly initiative = input.required<InitiativeBase>();
  public readonly cardClick = output<string>();

  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.initiative().initiativeType]);
  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.initiative().initiativeType]);
  protected readonly fundTypeColorClass = computed(() => CROWDFUNDING_FUND_TYPE_COLOR_CLASSES[this.initiative().initiativeType]);
  protected readonly avatarStyleClass = computed(() => CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES[this.initiative().initiativeType]);

  protected readonly progressPercent = this.initProgressPercent();

  protected readonly isClickable = computed(() => this.initiative().status !== 'pending');

  protected readonly formattedRaised = computed(() => formatCurrency((this.initiative().fundingStatus?.amountRaisedCents ?? 0) / 100));
  protected readonly formattedGoal: Signal<string | null> = this.initFormattedGoal();

  protected onCardClick(): void {
    if (this.isClickable()) {
      this.cardClick.emit(this.initiative().slug);
    }
  }

  private initFormattedGoal(): Signal<string | null> {
    return computed(() => {
      const goalCents = this.initiative().fundingStatus?.goalsTotalCents;
      return goalCents != null && goalCents > 0 ? formatCurrency(goalCents / 100) : null;
    });
  }

  private initProgressPercent(): Signal<number> {
    return computed(() => {
      const fs = this.initiative().fundingStatus;
      const raised = fs?.amountRaisedCents ?? 0;
      const goal = fs?.goalsTotalCents ?? 0;
      if (goal === 0) return 0;
      return Math.min(100, Math.round((raised / goal) * 100));
    });
  }
}
