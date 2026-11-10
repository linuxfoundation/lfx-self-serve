// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyDonation } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-donation-history-table',
  imports: [ButtonComponent, EmptyStateComponent, MenuComponent, TagComponent, CurrencyPipe, DatePipe],
  templateUrl: './donation-history-table.component.html',
  styleUrl: './donation-history-table.component.scss',
})
export class DonationHistoryTableComponent {
  public readonly items = input.required<MyDonation[]>();
  public readonly hasMore = input<boolean>(false);
  public readonly loadingMore = input<boolean>(false);
  public readonly exploreUrl = input.required<string>();

  public readonly loadMore = output<void>();
  /** Emits a row whose donor wants their name hidden or shown again (lfx-crowdfunding#466). */
  public readonly toggleAnonymity = output<MyDonation>();

  /** Each toggleable row gets its own popup menu, so opening another row's menu takes one click. */
  protected readonly rowMenuItems: Signal<Map<string, MenuItem[]>> = this.initRowMenuItems();

  protected onLoadMore(): void {
    this.loadMore.emit();
  }

  // ─── Private Initializers ─────────────────────────────────────────────────
  private initRowMenuItems(): Signal<Map<string, MenuItem[]>> {
    return computed(
      () =>
        new Map(
          this.items().map((item) => [
            item.id,
            [
              {
                label: item.anonymous ? 'Show my name' : 'Hide my name',
                icon: item.anonymous ? 'fa-light fa-eye' : 'fa-light fa-eye-slash',
                command: () => this.toggleAnonymity.emit(item),
              },
            ],
          ])
        )
    );
  }
}
