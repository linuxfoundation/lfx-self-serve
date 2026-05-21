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
import { CrowdfundingInitiative } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-card',
  imports: [AvatarComponent],
  templateUrl: './initiative-card.component.html',
  styleUrl: './initiative-card.component.scss',
})
export class InitiativeCardComponent {
  public readonly initiative = input.required<CrowdfundingInitiative>();
  public readonly cardClick = output<string>();

  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.initiative().fundType]);
  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.initiative().fundType]);
  protected readonly fundTypeColorClass = computed(() => CROWDFUNDING_FUND_TYPE_COLOR_CLASSES[this.initiative().fundType]);
  protected readonly avatarStyleClass = computed(() => CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES[this.initiative().fundType]);

  protected readonly progressPercent = this.initProgressPercent();

  protected readonly isClickable = computed(() => this.initiative().status !== 'pending');

  protected readonly formattedRaised = computed(() => this.formatCurrency(this.initiative().raised));
  protected readonly formattedGoal = computed(() => {
    const g = this.initiative().goal;
    return g != null ? this.formatCurrency(g) : null;
  });

  protected onCardClick(): void {
    if (this.isClickable()) {
      this.cardClick.emit(this.initiative().id);
    }
  }

  private formatCurrency(value: number): string {
    return `$${value.toLocaleString()}`;
  }

  private initProgressPercent(): Signal<number> {
    return computed(() => {
      const { raised, goal } = this.initiative();
      if (!goal || goal === 0) return 0;
      return Math.min(100, Math.round((raised / goal) * 100));
    });
  }
}
