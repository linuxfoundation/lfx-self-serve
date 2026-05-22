// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ACCOUNT_COOKIE_KEY, ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { Account, OrgLensAccountContextResponse } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { take } from 'rxjs/operators';

import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';

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
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly storageKey = ACCOUNT_COOKIE_KEY;

  /** Persona-authorised accounts seeded at bootstrap; enriched from Snowflake via getOrgLensAccountContext. */
  private readonly userOrganizations: WritableSignal<Account[]> = signal<Account[]>([]);

  /** Snowflake-resolved Account records keyed by accountId; flat regardless of Salesforce conglomerate hierarchy. */
  private readonly liveAccounts: WritableSignal<Map<string, Account>> = signal(new Map());

  public readonly selectedAccount: WritableSignal<Account>;

  /** Org-selector rows — persona seeds enriched with live Snowflake attributes; never empty between bootstrap and first response. */
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
    // Bootstrap on the placeholder; cookie only contributes accountId for later seed reconciliation — display fields never come from the cookie.
    this.selectedAccount = signal<Account>(PLACEHOLDER_ACCOUNT);
  }

  /** Seed persona-authorised orgs and trigger Snowflake enrichment; selection matches by stored accountId only — display attributes always come from seeds or live response. */
  public initializeUserOrganizations(organizations: Account[]): void {
    const seeds = organizations ?? [];
    this.userOrganizations.set(seeds);
    this.liveAccounts.set(new Map());

    if (seeds.length === 0) {
      this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
      this.clearStorage();
      return;
    }

    const storedId = this.loadAccountIdFromStorage();
    const matchedSeed = storedId ? (seeds.find((seed) => seed.accountId === storedId) ?? null) : null;
    this.setAccount(matchedSeed ?? seeds[0]);

    if (this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false)()) {
      this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
    }
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

    this.analyticsService
      .getOrgLensAccountContext(ids)
      .pipe(take(1))
      .subscribe((rows) => {
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

  /** Persist only the accountId — display fields stay in memory and are always re-hydrated from persona seeds + Snowflake. */
  private persistToStorage(account: Account): void {
    if (!this.isValidAccountId(account.accountId)) {
      this.clearStorage();
      return;
    }
    this.cookieService.set(this.storageKey, JSON.stringify({ accountId: account.accountId }), {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    this.cookieRegistry.registerCookie(this.storageKey);
  }

  private clearStorage(): void {
    this.cookieService.delete(this.storageKey, '/');
  }

  /** Returns the validated accountId from the cookie, or null. Display fields are ignored on purpose. */
  private loadAccountIdFromStorage(): string | null {
    try {
      const stored = this.cookieService.get(this.storageKey);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored) as Partial<Account>;
      return this.isValidAccountId(parsed?.accountId) ? parsed.accountId : null;
    } catch {
      return null;
    }
  }

  /** Salesforce account ids are 15- or 18-char alphanumeric strings; anything else is treated as tampered. */
  private isValidAccountId(id: unknown): id is string {
    return typeof id === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id);
  }
}
