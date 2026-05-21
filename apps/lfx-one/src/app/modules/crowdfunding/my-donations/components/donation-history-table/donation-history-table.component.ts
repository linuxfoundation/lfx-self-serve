// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { DonationHistoryItem } from '@lfx-one/shared/interfaces';

const PAGE_SIZE = 10;

@Component({
  selector: 'lfx-donation-history-table',
  imports: [ButtonComponent, DecimalPipe],
  templateUrl: './donation-history-table.component.html',
  styleUrl: './donation-history-table.component.scss',
})
export class DonationHistoryTableComponent {
  public readonly items = input.required<DonationHistoryItem[]>();

  protected readonly visibleCount = signal(PAGE_SIZE);
  protected readonly visibleItems = computed(() => this.items().slice(0, this.visibleCount()));
  protected readonly hasMore = computed(() => this.visibleCount() < this.items().length);

  protected loadMore(): void {
    this.visibleCount.update((n) => n + PAGE_SIZE);
  }
}
