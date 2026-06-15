// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ButtonComponent } from '@components/button/button.component';
import { RecurringDonation } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-recurring-donation-subscription-summary',
  imports: [ButtonComponent, CurrencyPipe, DatePipe],
  templateUrl: './recurring-donation-subscription-summary.component.html',
  styleUrl: './recurring-donation-subscription-summary.component.scss',
})
export class RecurringDonationSubscriptionSummaryComponent {
  public readonly donation = input.required<RecurringDonation>();

  public readonly cancelDonation = output<void>();
}
