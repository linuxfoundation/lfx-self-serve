// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { CROWDFUNDING_FUND_TYPE_ICONS, CROWDFUNDING_FUND_TYPE_LABELS } from '@lfx-one/shared/constants';
import { RecurringDonation } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recurring-donation-initiative-header',
  imports: [ButtonComponent, TagComponent],
  templateUrl: './recurring-donation-initiative-header.component.html',
  styleUrl: './recurring-donation-initiative-header.component.scss',
})
export class RecurringDonationInitiativeHeaderComponent {
  public readonly donation = input.required<RecurringDonation>();

  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.donation().fundType]);
  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.donation().fundType]);
}
