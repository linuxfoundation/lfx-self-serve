// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ACCOUNTS, DEFAULT_ACCOUNT } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly storageKey = 'lfx-selected-account';

  /**
   * User's organizations from committee memberships (filtered from ACCOUNTS)
   * If empty, falls back to all available accounts
   */
  private readonly userOrganizations: WritableSignal<Account[]> = signal<Account[]>([]);

  /**
   * Whether user organizations have been initialized from auth context
   */
  private readonly initialized: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * The currently selected account
   */
  public readonly selectedAccount: WritableSignal<Account>;

  /**
   * Returns available accounts for the user
   * If user has specific organizations from committee memberships, returns only those
   * Otherwise returns all predefined accounts
   */
  public readonly availableAccounts: Signal<Account[]> = computed(() => {
    const orgs = this.userOrganizations();
    if (this.initialized() && orgs.length > 0) {
      return orgs;
    }
    return ACCOUNTS;
  });

  public constructor() {
    const stored = this.loadFromStorage();
    this.selectedAccount = signal<Account>(stored || DEFAULT_ACCOUNT);
  }

  /**
   * Initialize user organizations from auth context (SSR state transfer)
   * Called during app initialization with organizations matched from committee memberships
   */
  public initializeUserOrganizations(organizations: Account[]): void {
    if (organizations && organizations.length > 0) {
      this.userOrganizations.set(organizations);
      this.initialized.set(true);

      // If stored account is not in user's organizations, select the first available
      const stored = this.loadFromStorage();
      const isStoredValid = stored && organizations.some((org) => org.accountId === stored.accountId);

      if (isStoredValid && stored) {
        this.selectedAccount.set(stored);
      } else {
        // Select first organization and persist
        this.setAccount(organizations[0]);
      }
    }
  }

  /**
   * Set the selected account and persist to storage
   */
  public setAccount(account: Account): void {
    this.selectedAccount.set(account);
    this.persistToStorage(account);
  }

  /**
   * Get the currently selected account ID
   */
  public getAccountId(): string {
    return this.selectedAccount().accountId;
  }

  private persistToStorage(account: Account): void {
    // Store in cookie (SSR-compatible)
    this.cookieService.set(this.storageKey, JSON.stringify(account), {
      expires: 30, // 30 days
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    // Register cookie for tracking
    this.cookieRegistry.registerCookie(this.storageKey);
  }

  private loadFromStorage(): Account | null {
    try {
      const stored = this.cookieService.get(this.storageKey);
      if (stored) {
        return JSON.parse(stored) as Account;
      }
    } catch {
      // Invalid data in cookie, ignore
    }
    return null;
  }
}
