// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ACCOUNT_COOKIE_KEY, ACCOUNTS, DEFAULT_ACCOUNT } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly storageKey = ACCOUNT_COOKIE_KEY;

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
   * Merges detected organizations into the predefined ACCOUNTS list so that
   * organizations not in the hardcoded list are still available for selection
   */
  public readonly availableAccounts: Signal<Account[]> = computed(() => {
    const detected = this.userOrganizations();
    if (!this.initialized() || detected.length === 0) {
      return ACCOUNTS;
    }

    // Start with ACCOUNTS, then append any detected orgs not already in the list
    const knownIds = new Set(ACCOUNTS.map((a) => a.accountId));
    const extras = detected.filter((d) => !knownIds.has(d.accountId));
    return extras.length > 0 ? [...ACCOUNTS, ...extras] : ACCOUNTS;
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
    this.initialized.set(true);
    this.userOrganizations.set(organizations ?? []);

    if (organizations && organizations.length > 0) {
      // Validate stored selection against the user's detected organizations.
      // A stored selection from a prior session (or a leaked impersonator cookie)
      // must match one of the currently detected orgs; otherwise fall back to
      // the first detected org so the selector reflects the active context.
      // Resolve to the canonical Account from organizations so we never trust
      // cookie-supplied fields (e.g. accountName) beyond the validated accountId.
      const stored = this.loadFromStorage();
      const matchedOrganization = stored ? (organizations.find((org) => org.accountId === stored.accountId) ?? null) : null;

      if (matchedOrganization) {
        this.selectedAccount.set(matchedOrganization);
      } else {
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
