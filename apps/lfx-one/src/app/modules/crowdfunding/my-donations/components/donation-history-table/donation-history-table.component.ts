// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MyDonation } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-donation-history-table',
  imports: [ButtonComponent, CurrencyPipe, DatePipe],
  templateUrl: './donation-history-table.component.html',
  styleUrl: './donation-history-table.component.scss',
})
export class DonationHistoryTableComponent {
  public readonly items = input.required<MyDonation[]>();
  public readonly hasMore = input<boolean>(false);

  public readonly loadMore = output<void>();

  protected onLoadMore(): void {
    this.loadMore.emit();
  }
}
