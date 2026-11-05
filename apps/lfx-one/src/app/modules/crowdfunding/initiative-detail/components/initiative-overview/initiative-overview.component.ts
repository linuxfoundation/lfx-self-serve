// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';
import { plainTextToHtml } from '@lfx-one/shared/utils';
import { InitiativeFinanceSummaryComponent } from '../initiative-finance-summary/initiative-finance-summary.component';
import { InitiativeOverviewSidebarComponent } from '../initiative-overview-sidebar/initiative-overview-sidebar.component';

@Component({
  selector: 'lfx-initiative-overview',
  imports: [CardComponent, InitiativeFinanceSummaryComponent, InitiativeOverviewSidebarComponent],
  templateUrl: './initiative-overview.component.html',
  styleUrl: './initiative-overview.component.scss',
})
export class InitiativeOverviewComponent {
  public readonly initiative = input.required<InitiativeDetail>();
  public readonly viewAllFinancials = output<void>();

  // Bound with [innerHTML], which Angular sanitizes. Older plain-text descriptions keep their line breaks.
  protected readonly descriptionHtml = computed(() => plainTextToHtml(this.initiative().description));
}
