// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { RecurringDonation } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-recurring-donations-list',
  imports: [ButtonComponent, MenuComponent],
  templateUrl: './recurring-donations-list.component.html',
  styleUrl: './recurring-donations-list.component.scss',
})
export class RecurringDonationsListComponent {
  public readonly donations = input.required<RecurringDonation[]>();
  public readonly cancelledCount = input<number>(0);

  public readonly viewCancelled = output<void>();
  public readonly changeAmount = output<RecurringDonation>();
  public readonly pauseDonation = output<RecurringDonation>();
  public readonly resumeDonation = output<RecurringDonation>();
  public readonly cancelDonation = output<RecurringDonation>();

  private readonly menus = viewChildren<MenuComponent>(MenuComponent);

  protected readonly donationsWithMenuItems = this.initDonationsWithMenuItems();

  protected onMenuToggle(event: Event, index: number): void {
    this.menus()[index]?.toggle(event);
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
    if (donation.status === 'paused') {
      return [
        { label: 'Resume', icon: 'fa-solid fa-play', command: () => this.resumeDonation.emit(donation) },
        { separator: true },
        { label: 'Cancel', icon: 'fa-solid fa-xmark', styleClass: 'text-red-600', command: () => this.cancelDonation.emit(donation) },
      ];
    }
    return [
      { label: 'Change amount', icon: 'fa-solid fa-pen-to-square', command: () => this.changeAmount.emit(donation) },
      { label: 'Pause', icon: 'fa-solid fa-pause', command: () => this.pauseDonation.emit(donation) },
      { separator: true },
      { label: 'Cancel', icon: 'fa-solid fa-xmark', styleClass: 'text-red-600', command: () => this.cancelDonation.emit(donation) },
    ];
  }
}
