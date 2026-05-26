// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { CrowdfundingInitiativesStats } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-initiatives-stats-bar',
  imports: [CardComponent],
  templateUrl: './initiatives-stats-bar.component.html',
  styleUrl: './initiatives-stats-bar.component.scss',
})
export class InitiativesStatsBarComponent {
  public readonly stats = input.required<CrowdfundingInitiativesStats>();

  protected readonly formattedTotalRaised = computed(() => formatCurrency(this.stats().totalRaised));
  protected readonly formattedMonthlyGain = computed(() => formatCurrency(this.stats().monthlyGain));
}
