// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { RecurringDonation } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-recurring-donations-list',
  imports: [ButtonComponent, DatePipe, MenuComponent, TagComponent],
  templateUrl: './recurring-donations-list.component.html',
  styleUrl: './recurring-donations-list.component.scss',
})
export class RecurringDonationsListComponent {
  public readonly donations = input.required<RecurringDonation[]>();

  public readonly viewDetail = output<RecurringDonation>();
  public readonly cancelDonation = output<RecurringDonation>();
  /** Emits a subscription whose donor wants their name hidden or shown again on all its charges (lfx-crowdfunding#466). */
  public readonly toggleAnonymity = output<RecurringDonation>();

  private readonly menus = viewChildren<MenuComponent>(MenuComponent);

  protected readonly donationsWithMenuItems = this.initDonationsWithMenuItems();

  protected onCardKeyActivate(event: Event, donation: RecurringDonation): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.viewDetail.emit(donation);
  }

  protected onMenuToggle(event: Event, index: number): void {
    this.menus()[index]?.toggle(event);
  }

  protected menuIndexFor(donationIndex: number): number {
    return this.donationsWithMenuItems()
      .slice(0, donationIndex)
      .filter((e) => e.menuItems.length > 0).length;
  }

  private initDonationsWithMenuItems(): Signal<{ donation: RecurringDonation; menuItems: MenuItem[] }[]> {
    return computed(() =>
      this.donations().map((donation) => ({
        donation,
        menuItems: this.buildMenuItems(donation),
      }))
    );
  }

  private buildMenuItems(donation: RecurringDonation): MenuItem[] {
    // Past charges of a canceled subscription stay listed, so their name visibility can still change.
    const items: MenuItem[] = [
      {
        label: donation.anonymous ? 'Show my name' : 'Hide my name',
        icon: donation.anonymous ? 'fa-light fa-eye' : 'fa-light fa-eye-slash',
        command: () => this.toggleAnonymity.emit(donation),
      },
    ];
    if (donation.status !== 'canceled') {
      items.push({ label: 'Cancel', icon: 'fa-solid fa-xmark', styleClass: 'text-red-600', command: () => this.cancelDonation.emit(donation) });
    }
    return items;
  }
}
