// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { ACCOUNT_COOKIE_KEY, ORG_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse } from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const PLACEHOLDER_ACCOUNT: Account = {
  accountId: '',
  accountName: '',
  membershipTier: '',
};

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = ACCOUNT_COOKIE_KEY;

  /** Request-scope dedup (spec 020 D-006) — concurrent calls for the same uid share one in-flight promise; cleared on settle. */
  private readonly canonicalFetchInFlight = new Map<string, Promise<void>>();

  /**
   * Monotonic generation for Snowflake enrichment. `initializeUserOrganizations` runs at bootstrap (transfer-state seeds) and again on
   * every persona re-seed, so two enrichments can be in flight at once — the earlier (stale-seed) response must never overwrite the later.
   */
  private enrichmentGeneration = 0;

  /** Persona-authorised accounts seeded at bootstrap; enriched from Snowflake via getOrgLensAccountContext. */
  private readonly userOrganizations: WritableSignal<Account[]> = signal<Account[]>([]);

  /** Snowflake-resolved Account records keyed by accountId; flat regardless of Salesforce conglomerate hierarchy. */
  private readonly liveAccounts: WritableSignal<Map<string, Account>> = signal(new Map());

  public readonly selectedAccount: WritableSignal<Account>;

  /**
   * Spec 050: uid of the organization the address names — adopted from `/org/{segment}/…` by
   * `orgPathParamGuard` (access-verified for this viewer at resolve time), or the default / restored
   * selection that address is about to be written from (`pinSelection`, lfx-self-serve#2570). While it
   * is the selection, bootstrap paths (the persona refresh re-seeding organizations, the org-items
   * default selection) must not replace it: that is exactly the silent substitution deep links exist
   * to remove — and, for a viewer whose organizations come from grants rather than personas (staff),
   * the persona refresh answers with *no* seeds, which without the pin resets an addressed page to the
   * placeholder mid-render. Released when the user switches (`setAccount` with another uid) or the
   * selection is cleared.
   *
   * The pin outlives the write. A default or restored selection made outside Org Lens (Me or Project
   * lens, where the `'default'` write is a no-op) stays pinned even though no address names it, so
   * the unpinned persona re-seed paths (`[]` → placeholder, cookie-restored selection deferring to
   * seeds) run only before any default / restored / adopted selection exists. Intended: the
   * mid-session reset is the defect wherever it happens — on the Me lens it blanks the selector the
   * same way.
   *
   * Two kinds of pin, one uid (`pinSource`). An **address** pin (resolver hit, FR-020 stub, or a URL
   * that already names the selection) was access-verified for this viewer and is honoured by every
   * bootstrap path, including a later org-items reload — inherited or catalogue-only access need not
   * appear on the first page. A **default** pin (the org-items default or cookie-restored match) came
   * *from* the org-items list, so it holds only against the persona re-seed: a later authoritative
   * org-items reload runs the normal selection path again — re-match, re-default to the first row, or
   * the empty-response handling — and a revoked organization is released there rather than kept for
   * the rest of the session. The data behind the bar is FGA-gated either way.
   */
  private readonly addressedUid: WritableSignal<string | null> = signal<string | null>(null);
  private readonly pinSource: WritableSignal<'address' | 'default' | null> = signal<'address' | 'default' | null>(null);

  /** Spec 050: the `/org/{segment}/…` segment of the current selection — the indexed slug (org-items row or resolver answer) when one is known, else the SFID; null for the placeholder. Never member-service's slug: addresses resolve against the index. */
  public readonly selectedUrlSegment: Signal<string | null> = computed(() => orgUrlSegment(this.selectedAccount()));

  /** True while the selection is pinned — by an address or as a default (see `addressedUid`). Gates the persona re-seed. */
  public readonly isAddressedSelection: Signal<boolean> = computed(() => {
    const uid = this.addressedUid();
    return !!uid && uid === this.selectedAccount().uid;
  });

  /** True while the selection is pinned by an **address** (resolver hit, FR-020 stub, or a URL naming it) — the only pin an org-items reload honours. */
  public readonly isAdoptedFromAddress: Signal<boolean> = computed(() => this.isAddressedSelection() && this.pinSource() === 'address');

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

  /**
   * Whether the caller may see the org-selector / Org Lens surfaces: a direct or inherited (roll-up,
   * LFXV2-3029) writer or auditor grant, at least one persona-seeded account, or the LF-team grant.
   * Single source of truth for every gate that asks whether the caller holds any organization, so
   * those gates cannot drift apart. Inherited grants count: the switcher lists
   * those rows, and a caller holding nothing else must still be able to start the list (spec 053).
   *
   * Staff qualify on the grant alone, with no accounts of their own. That is the whole
   * point: their list starts empty and is filled by search, so gating visibility on a non-empty list
   * would hide the only control that can populate it.
   */
  public readonly hasOrgSelectorAccess: Signal<boolean> = computed(
    () =>
      this.orgRoleGrantsService.writerSet().size > 0 ||
      this.orgRoleGrantsService.auditorSet().size > 0 ||
      // LFXV2-3029: an inherited (roll-up) grant is a held organization too — the switcher lists those
      // rows, and without it a caller holding only inherited grants never starts the list and the page
      // waits on it forever (spec 053 review).
      this.orgRoleGrantsService.inheritedWriterSet().size > 0 ||
      this.orgRoleGrantsService.inheritedAuditorSet().size > 0 ||
      this.availableAccounts().length > 0 ||
      this.orgRoleGrantsService.isStaff()
  );

  public constructor() {
    // Bootstrap on the placeholder; cookie only contributes accountId for later seed reconciliation — display fields never come from the cookie.
    this.selectedAccount = signal<Account>(PLACEHOLDER_ACCOUNT);
  }

  /** Seed persona-authorised orgs and trigger Snowflake enrichment; selection matches by stored accountId only — display attributes always come from seeds or live response. */
  public initializeUserOrganizations(organizations: Account[]): void {
    const seeds = organizations ?? [];
    this.userOrganizations.set(seeds);
    this.liveAccounts.set(new Map());

    // Spec 050: an address-adopted selection outranks seeding. The persona refresh re-runs this after
    // the guard has adopted; for a staff viewer the seeds are empty and would reset the selection to
    // the placeholder, for anyone else a seed or uid stub would replace the resolved record.
    if (this.isAddressedSelection()) {
      if (seeds.length > 0) {
        this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
      }
      return;
    }

    if (seeds.length === 0) {
      this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
      return;
    }

    // Spec 002: the cookie persists the org account id (18-char SFID), stored under the `uid` field.
    // Match a seed by uid when one carries it; otherwise select a stub keyed only by the stored id and
    // let the canonical fetch hydrate display fields. Falls back to the first seed when there is no
    // stored id (or it is a legacy UUID / otherwise invalid).
    const storedUid = this.loadUidFromStorage();
    const matchedSeed = storedUid ? (seeds.find((seed) => seed.uid === storedUid) ?? null) : null;
    if (matchedSeed) {
      this.setAccount(matchedSeed);
    } else if (storedUid) {
      const stub: Account = { ...PLACEHOLDER_ACCOUNT, uid: storedUid };
      this.setAccount(stub);
      void this.refreshCanonicalRecord(stub);
    } else {
      this.setAccount(seeds[0]);
    }

    this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
  }

  /**
   * Spec 050: patches only the URL-identity slug of the current selection, from an indexed row (the
   * org list). A slug-only change must not go through `setAccount`, which rebuilds the selection from
   * the live Snowflake row and would revert display fields the canonical record has since patched
   * (a rename propagated to member-service but not yet to Snowflake would flip back in the sidebar).
   */
  public setIndexedSlug(slug: string | null): void {
    const current = this.selectedAccount();
    const next: Account = { ...current, slug };
    this.selectedAccount.set(next);
    this.persistToStorage(next);
  }

  public setAccount(account: Account): void {
    const live = this.liveAccounts().get(account.accountId);
    const next = live
      ? {
          ...live,
          uid: account.uid ?? live.uid ?? null,
          parentUid: account.parentUid ?? live.parentUid ?? null,
          // Spec 050: the URL-identity slug never comes from the Snowflake row; it is whatever the
          // caller supplied — `null` (member-service published none) and `undefined` (not known yet:
          // persona seed, cookie stub) are both kept as given so the two stay distinguishable.
          slug: account.slug,
        }
      : account;
    // A switch to another organization ends the address's claim on the selection.
    if (this.addressedUid() !== null && this.addressedUid() !== (next.uid ?? null)) {
      this.addressedUid.set(null);
      this.pinSource.set(null);
    }
    this.selectedAccount.set(next);
    this.persistToStorage(next);
  }

  /** Spec 050: select the organization the `/org/{segment}/…` address names (resolver hit, or the uid-only stub of FR-020) and pin it against bootstrap re-seeding — see `addressedUid`. */
  public adoptFromAddress(account: Account): void {
    this.setAccount(account);
    this.addressedUid.set(account.uid ?? null);
    this.pinSource.set(account.uid ? 'address' : null);
  }

  /**
   * Pin the *current* selection without rebuilding it (lfx-self-serve#2570). For the two selections
   * that become the address without going through the resolver: the org-items default (or
   * cookie-restored match) that `navigateToSelectedOrg('default')` is about to write into
   * `/org/{segment}/{page}` — a `'default'` pin — and a `/org/{segment}/…` visit whose segment already
   * names the selection (the path guard's no-round-trip shortcut) — an `'address'` pin, exactly as a
   * resolver hit. See `addressedUid` for what each kind holds against. Not a `setAccount`: that would
   * re-merge the live Snowflake row and revert display fields the canonical record has since patched.
   *
   * An `'address'` pin **upgrades** a `'default'` pin on the same organization, and a `'default'` pin
   * never downgrades an `'address'` one. The upgrade is deliberate (lfx-self-serve#2793): once the
   * default write has produced `/org/A/…`, the address names A and must keep naming what is rendered.
   * Were the default pin kept, an org-items reload whose page lacks A would fall through to
   * `selectDefaultOrg(B)`, whose `'default'` write leaves an addressed page alone — B rendered under
   * `/org/A`, the silent substitution spec 050 forbids. So on an addressed page a revoked selection is
   * kept, not drifted; routing it to `/org/not-found` (what a resolver miss does) is the follow-up.
   * The `'default'` kind therefore only ever governs pages no address names (Me / Project lens, the
   * legacy `/org/{page}` form before its write). No-op on the placeholder.
   */
  public pinSelection(source: 'address' | 'default'): void {
    const uid = this.selectedAccount().uid ?? null;
    if (!uid) {
      return;
    }
    const keepAddress = source === 'default' && this.addressedUid() === uid && this.pinSource() === 'address';
    this.addressedUid.set(uid);
    this.pinSource.set(keepAddress ? 'address' : source);
  }

  public getAccountId(): string {
    return this.selectedAccount().accountId;
  }

  public getStoredUid(): string | null {
    return this.loadUidFromStorage();
  }

  public clearAccount(): void {
    this.addressedUid.set(null);
    this.pinSource.set(null);
    this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
    this.clearStorage();
  }

  /** Async reconciliation of the optimistic indexed snapshot against the member-service canonical record (spec 020 US4 / FR-020); silent on failure with request-scope dedup per D-006. */
  public async refreshCanonicalRecord(account: Account): Promise<void> {
    // Spec 002: the canonical record is keyed solely by the org account id (SFID, held in `uid`).
    // Without an identifier there is nothing to resolve.
    const identifier = account.uid;
    if (!identifier) {
      return;
    }
    const cached = this.canonicalFetchInFlight.get(identifier);
    if (cached) {
      return cached;
    }

    const path = `/api/orgs/uid/${encodeURIComponent(identifier)}`;

    const promise = (async () => {
      try {
        const canonical = await firstValueFrom(this.http.get<OrgCanonicalRecord>(path).pipe(take(1)));
        this.applyCanonicalRecord(canonical);
      } catch (error) {
        // FR-020 — no user-facing toast; the indexed snapshot stays. Surface to console
        // for dev triage; BFF logs already carry the structured warning.
        console.warn('[AccountContextService] Canonical-record fetch failed; keeping indexed snapshot', {
          error,
          uid: account.uid,
          accountId: account.accountId,
        });
      } finally {
        this.canonicalFetchInFlight.delete(identifier);
      }
    })();

    this.canonicalFetchInFlight.set(identifier, promise);
    return promise;
  }

  /**
   * Spec 021 — Public propagation hook for the Org Profile edit flow after a successful PUT (FR-009);
   * patches `selectedAccount` so sidebar + selector reflect the edit without waiting for the next
   * natural fetch. The URL slug is the one field not propagated (spec 050): addresses resolve against
   * the index, so a renamed slug reaches links and address only once the index carries it and an
   * indexed row (resolver on a navigation, org list on bootstrap) has answered with it. Forgetting the
   * old slug here would not help — the next resolve hands the still-indexed old slug straight back.
   */
  public updateCanonicalRecord(canonical: OrgCanonicalRecord): void {
    this.applyCanonicalRecord(canonical);
  }

  private applyCanonicalRecord(canonical: OrgCanonicalRecord): void {
    const current = this.selectedAccount();
    // Only patch when the canonical record corresponds to the still-selected org —
    // a user that switches selection mid-flight should not have a stale canonical
    // response clobber the new selection.
    const matchesByUid = !!canonical.uid && canonical.uid === current.uid;
    const matchesByAccountId = !!canonical.accountId && canonical.accountId === current.accountId;
    if (!matchesByUid && !matchesByAccountId) {
      return;
    }
    const next: Account = {
      ...current,
      accountId: canonical.accountId ?? current.accountId,
      accountName: canonical.name ?? current.accountName,
      logoUrl: canonical.logoUrl ?? current.logoUrl ?? null,
      uid: canonical.uid ?? current.uid ?? null,
      parentUid: canonical.parentUid ?? current.parentUid ?? null,
      // Spec 050: the URL slug is the *index's*, never member-service's. Addresses resolve against
      // the index (`/api/orgs/resolve/:segment` reads query-service), and the canonical record runs
      // ahead of it during lag — a slug taken from here could be one the resolver cannot answer yet.
      // So the canonical record never touches the slug, not even to unset it on a disagreement: the
      // next org-segment navigation asks the resolver, which is the index and hands the indexed slug
      // straight back — an unset would only flip-flop. A rename reaches addresses when the index has
      // caught up, and a reused name resolves to whoever the index says (access-checked either way).
      slug: current.slug,
    };
    this.selectedAccount.set(next);
    // Persist again so a page reload picks up the refreshed accountId (mostly identical to current,
    // but covers the edge case where the indexed snapshot had a stale or null accountId).
    this.persistToStorage(next);
  }

  private refreshFromSnowflake(accountIds: string[]): void {
    // Browser-only: the retired Org Lens flag defaulted to false in SSR (no OpenFeature
    // provider on the server), so enrichment never ran there; running it now would stall SSR
    // serialization on a Snowflake-backed call the browser refetches after hydration anyway.
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const ids = [...new Set(accountIds.filter((id) => !!id))];
    if (ids.length === 0) {
      return;
    }

    // A newer re-seed supersedes this fetch: only the latest generation may write `liveAccounts` and the selection.
    const generation = ++this.enrichmentGeneration;

    this.analyticsService
      .getOrgLensAccountContext(ids)
      .pipe(take(1))
      .subscribe((rows) => {
        if (generation !== this.enrichmentGeneration) {
          return;
        }
        if (rows.length === 0) {
          return;
        }
        const live = this.buildLiveAccounts(rows);
        this.liveAccounts.set(live);

        const current = this.selectedAccount();
        const liveCurrent = live.get(current.accountId);
        if (liveCurrent) {
          this.selectedAccount.set({
            ...liveCurrent,
            uid: current.uid ?? liveCurrent.uid ?? null,
            parentUid: current.parentUid ?? liveCurrent.parentUid ?? null,
            // Never let a Snowflake row overwrite the URL-identity slug (spec 050, DR-007) — nor turn
            // "not known yet" into "none".
            slug: current.slug,
          });
        } else if (!current.accountId && !current.uid) {
          // No selection at all (no cookie uid, no accountId yet) — default to the first seed. A
          // cookie-restored stub already carries a uid, so it is left untouched here and the
          // canonical-by-uid fetch fills its display fields.
          const firstSeed = this.userOrganizations()[0];
          if (firstSeed) {
            const liveSeed = live.get(firstSeed.accountId) ?? firstSeed;
            const next = {
              ...liveSeed,
              uid: firstSeed.uid ?? liveSeed.uid ?? null,
              parentUid: firstSeed.parentUid ?? liveSeed.parentUid ?? null,
              slug: firstSeed.slug,
            };
            this.selectedAccount.set(next);
            this.persistToStorage(next);
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
      logoUrl: row.logoUrl ?? undefined,
      cdevOrgId: row.cdevOrgId ?? undefined,
      membershipTier: row.membershipTierDisplayName ?? '',
    };
  }

  /** Spec 002: persist only the org account id (SFID, in `uid`) — display fields stay in memory and are always re-hydrated from persona seeds + Snowflake + the canonical fetch. */
  private persistToStorage(account: Account): void {
    if (!this.isValidUid(account.uid)) {
      this.clearStorage();
      return;
    }
    this.cookieService.set(this.storageKey, JSON.stringify({ uid: account.uid }), {
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

  /** Returns the validated org account id (SFID) from the cookie's `uid` field, or null. Legacy UUID values fail SFID validation and are ignored. */
  private loadUidFromStorage(): string | null {
    try {
      const stored = this.cookieService.get(this.storageKey);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored) as Partial<Account>;
      return this.isValidUid(parsed?.uid) ? parsed.uid : null;
    } catch {
      return null;
    }
  }

  /** Spec 002: the org uid is the canonical 18-char Salesforce account id; legacy UUIDs (and anything else) are treated as absent/tampered so a stale cookie degrades to the default selection. */
  private isValidUid(uid: unknown): uid is string {
    return typeof uid === 'string' && ORG_ACCOUNT_ID_PATTERN.test(uid);
  }
}
