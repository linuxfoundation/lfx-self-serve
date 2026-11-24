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
  /** True while a name-visibility change is being saved. */
  public readonly anonymitySaving = input<boolean>(false);

  public readonly cancelDonation = output<void>();
  /** The donor asked to hide or show their name on every charge of this subscription (lfx-crowdfunding#466). */
  public readonly toggleAnonymity = output<void>();
}
