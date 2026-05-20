// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ACCOUNT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { Account, OrgLensAccountContextResponse } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';

const PLACEHOLDER_ACCOUNT: Account = {
  accountId: '',
  accountName: '',
  accountSlug: '',
  membershipTier: '',
};

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly storageKey = ACCOUNT_COOKIE_KEY;

  /**
   * Seed organizations from the persona service — the accounts the
   * current user is authorised to see. Display attributes (slug, logo,
   * tier) are resolved from Snowflake via getOrgLensAccountContext.
   */
  private readonly userOrganizations: WritableSignal<Account[]> = signal<Account[]>([]);

  private readonly initialized: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Snowflake-resolved Account records keyed by accountId. Flat — the
   * UI renders one entry per account regardless of any Salesforce
   * conglomerate hierarchy that may exist behind the scenes.
   */
  private readonly liveAccounts: WritableSignal<Map<string, Account>> = signal(new Map());

  public readonly selectedAccount: WritableSignal<Account>;

  /**
   * Accounts visible in the org-selector — one row per persona-authorised
   * account, enriched with Snowflake display attributes once available,
   * falling back to bare seed records while live data is loading so the
   * selector is never empty between bootstrap and the first response.
   */
  public readonly availableAccounts: Signal<Account[]> = computed(() => {
    const seeds = this.userOrganizations();
    const live = this.liveAccounts();

    if (live.size === 0) {
      return seeds;
    }

    const seen = new Set<string>();
    const result: Account[] = [];
    for (const seed of seeds) {
      if (seen.has(seed.accountId)) {
        continue;
      }
      seen.add(seed.accountId);
      result.push(live.get(seed.accountId) ?? seed);
    }
    return result;
  });

  public constructor() {
    const stored = this.loadFromStorage();
    this.selectedAccount = signal<Account>(stored ?? PLACEHOLDER_ACCOUNT);
  }

  /**
   * Initialize user organizations from auth context (SSR state transfer).
   *
   * Sets the seed list from the persona service, then fetches
   * /api/analytics/org-lens-account-context to enrich each seed with
   * its Snowflake display attributes (slug, logo, cdev mapping, tier).
   * Selection is reconciled against the seeds and re-enriched once the
   * live data arrives.
   */
  public initializeUserOrganizations(organizations: Account[]): void {
    this.initialized.set(true);
    const seeds = organizations ?? [];
    this.userOrganizations.set(seeds);

    if (seeds.length > 0) {
      const stored = this.loadFromStorage();
      const matchedSeed = stored ? (seeds.find((seed) => seed.accountId === stored.accountId) ?? null) : null;
      if (matchedSeed) {
        this.setAccount(matchedSeed);
      } else {
        this.setAccount(seeds[0]);
      }
    }

    this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
  }

  public setAccount(account: Account): void {
    const live = this.liveAccounts().get(account.accountId);
    const next = live ?? account;
    this.selectedAccount.set(next);
    this.persistToStorage(next);
  }

  public getAccountId(): string {
    return this.selectedAccount().accountId;
  }

  private refreshFromSnowflake(accountIds: string[]): void {
    const ids = [...new Set(accountIds.filter((id) => !!id))];
    if (ids.length === 0) {
      return;
    }

    this.analyticsService.getOrgLensAccountContext(ids).subscribe((rows) => {
      if (rows.length === 0) {
        return;
      }
      const live = this.buildLiveAccounts(rows);
      this.liveAccounts.set(live);

      const current = this.selectedAccount();
      const liveCurrent = live.get(current.accountId);
      if (liveCurrent) {
        this.selectedAccount.set(liveCurrent);
      } else if (!current.accountId) {
        const firstSeed = this.userOrganizations()[0];
        if (firstSeed) {
          const liveSeed = live.get(firstSeed.accountId) ?? firstSeed;
          this.selectedAccount.set(liveSeed);
          this.persistToStorage(liveSeed);
        }
      }
    });
  }

  private buildLiveAccounts(rows: OrgLensAccountContextResponse[]): Map<string, Account> {
    const accounts = new Map<string, Account>();
    for (const row of rows) {
      const account = this.toAccount(row);
      accounts.set(account.accountId, account);
    }
    return accounts;
  }

  private toAccount(row: OrgLensAccountContextResponse): Account {
    return {
      accountId: row.accountId,
      accountName: row.accountName,
      accountSlug: row.accountSlug ?? '',
      logoUrl: row.logoUrl ?? undefined,
      cdevOrgId: row.cdevOrgId ?? undefined,
      membershipTier: row.membershipTierDisplayName ?? '',
    };
  }

  private persistToStorage(account: Account): void {
    this.cookieService.set(this.storageKey, JSON.stringify(account), {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    this.cookieRegistry.registerCookie(this.storageKey);
  }

  private loadFromStorage(): Account | null {
    try {
      const stored = this.cookieService.get(this.storageKey);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored) as Account;
      if (!this.isValidAccountId(parsed?.accountId)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  // Salesforce account ids are 15- or 18-char alphanumeric strings.
  // Reject anything else so a tampered cookie can't seed selectedAccount with
  // an invalid id before persona init reconciles.
  private isValidAccountId(id: unknown): id is string {
    return typeof id === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id);
  }
}
