// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';
import { ACCOUNTS, DEFAULT_ACCOUNT } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly storageKey = 'lfx-selected-account';
  public readonly selectedAccount: WritableSignal<Account>;
  public readonly availableAccounts: Account[] = ACCOUNTS;

  public constructor() {
    const stored = this.loadStoredAccount();
    this.selectedAccount = signal<Account>(stored || DEFAULT_ACCOUNT);
  }

  /**
   * Set the selected account and persist to storage
   */
  public setAccount(account: Account): void {
    this.selectedAccount.set(account);
    this.persistAccount(account);
  }

  /**
   * Get the currently selected account ID
   */
  public getAccountId(): string {
    return this.selectedAccount().accountId;
  }

  private persistAccount(account: Account): void {
    localStorage.setItem(this.storageKey, JSON.stringify(account));
  }

  private loadStoredAccount(): Account | null {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored) as Account;
      }
    } catch {
      // Invalid data in localStorage, ignore
    }
    return null;
  }
}
