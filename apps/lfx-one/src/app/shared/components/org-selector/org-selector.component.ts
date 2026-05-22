// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, model, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Account } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { UserService } from '@services/user.service';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';

@Component({
  selector: 'lfx-org-selector',
  imports: [ReactiveFormsModule, PopoverModule, InputTextModule, AutoFocus],
  templateUrl: './org-selector.component.html',
  styleUrl: './org-selector.component.scss',
})
export class OrgSelectorComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly userService = inject(UserService);

  public readonly isPanelOpen = model<boolean>(false);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  private readonly searchValue = toSignal(this.searchControl.valueChanges, { initialValue: '' });
  private readonly searchTerm: Signal<string> = computed(() => (this.searchValue() ?? '').trim().toLowerCase());

  protected readonly panelStyleClass = computed(() =>
    this.userService.impersonating() ? 'org-selector-panel org-selector-panel--with-banner' : 'org-selector-panel'
  );

  protected readonly selectedAccount: Signal<Account> = this.accountContextService.selectedAccount;
  protected readonly selectedAccountId: Signal<string> = computed(() => this.selectedAccount().accountId);
  protected readonly availableAccounts: Signal<Account[]> = this.accountContextService.availableAccounts;

  protected readonly displayName: Signal<string> = computed(() => this.selectedAccount().accountName || 'Select Organization');

  protected readonly displayLogo: Signal<string> = computed(() => this.selectedAccount().logoUrl ?? '');

  protected readonly visibleAccounts: Signal<Account[]> = computed(() => {
    const term = this.searchTerm();
    const accounts = this.availableAccounts();
    if (!term) {
      return accounts;
    }
    return accounts.filter((account) => account.accountName.toLowerCase().includes(term));
  });

  protected selectItem(account: Account, popover: Popover): void {
    this.accountContextService.setAccount(account);
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }

  protected onPopoverShow(): void {
    this.isPanelOpen.set(true);
  }

  protected onPopoverHide(): void {
    this.isPanelOpen.set(false);
    this.searchControl.setValue('', { emitEvent: true });
  }
}
