// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ButtonComponent } from '@components/button/button.component';
import { CrowdfundingTransaction } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recurring-donation-charge-history',
  imports: [ButtonComponent, CurrencyPipe, DatePipe],
  templateUrl: './recurring-donation-charge-history.component.html',
  styleUrl: './recurring-donation-charge-history.component.scss',
})
export class RecurringDonationChargeHistoryComponent {
  public readonly chargeHistory = input.required<CrowdfundingTransaction[]>();
  public readonly hasMore = input.required<boolean>();

  public readonly loadMore = output<void>();
}
