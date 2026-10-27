// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, PLATFORM_ID, Signal, signal, untracked, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, Router } from '@angular/router';
import {
  ACCOUNT_COOKIE_KEY,
  FEATURE_FLAG_READY_TIMEOUT_MS,
  ORG_ACCOUNT_ID_PATTERN,
  ORG_LENS_ROLLUP_ENABLED_FLAG,
  ORG_NOT_FOUND_PATH,
  ORG_ROLLUP_SEGMENT,
} from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse } from '@lfx-one/shared/interfaces';
import { isOrgRollUpSegment, normalizeOrgSegment, orgUrlSegment } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { filter, firstValueFrom, from, Subscription, switchMap, take } from 'rxjs';

import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const PLACEHOLDER_ACCOUNT: Account = {
  accountId: '',
  accountName: '',
  membershipTier: '',
};

/** Display name of the All Organizations roll-up, shown wherever a concrete organization's name would be. */
export const ROLLUP_ACCOUNT_NAME = 'All Organizations';

/** Fewest organizations a roll-up is worth offering over: with one, it is the organization. */
export const ROLLUP_MIN_ORGANIZATIONS = 2;

/**
 * Synthetic selection standing for the All Organizations roll-up (lfx-self-serve#4125). It is not a
 * `b2b_org` row: there is no Salesforce account behind it, so both identifier fields carry the
 * reserved segment instead (see the note on `accountId` below), and `slug` is a confirmed `null` so
 * nothing tries to learn one from the index. The segment is what every address, cookie and
 * `:orgUid` / `:accountId` request built from this selection ends up spelling, and what `isRollUp`
 * keys on.
 */
const ROLLUP_ACCOUNT: Account = {
  // The sentinel sits in BOTH identifier fields. The Org Lens endpoints key on `:orgUid`, but the
  // Events family keys on `:accountId` (#4125's contract covers both), and consumers that filter on
  // a falsy `accountId` would otherwise skip the roll-up and silently keep their previous result.
  accountId: ORG_ROLLUP_SEGMENT,
  accountName: ROLLUP_ACCOUNT_NAME,
  membershipTier: '',
  uid: ORG_ROLLUP_SEGMENT,
  slug: null,
};

@Injectable({
  providedIn: 'root',
})
export class AccountContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** At most one deferred address re-point; a later demotion supersedes an earlier pending one. */
  private pendingRepoint: Subscription | null = null;
  private readonly orgClaOnlyAccess = inject(OrgClaOnlyAccessService);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = ACCOUNT_COOKIE_KEY;

  /** Request-scope dedup (spec 020 D-006) — concurrent calls for the same uid share one in-flight promise; cleared on settle. */
  private readonly canonicalFetchInFlight = new Map<string, Promise<void>>();

  /**
   * Monotonic generation for Snowflake enrichment. `initializeUserOrganizations` runs at bootstrap (transfer-state seeds) and again on
   * every persona re-seed, so two enrichments can be in flight at once — the earlier (stale-seed) response must never overwrite the later.
   * Every (re-)seed advances this, including empty ones that start no fetch, so a late response for a superseded seed list is always dropped.
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

  /** True while the All Organizations roll-up is the selection — every page reads combined data and every write is gated off (#4125). */
  public readonly isRollUp: Signal<boolean> = computed(() => isOrgRollUpSegment(this.selectedAccount().uid));

  /**
   * How many distinct organizations the caller holds — what the roll-up would combine.
   *
   * Derived client-side from the same sources `hasOrgSelectorAccess` consults: persona-seeded
   * accounts plus direct and inherited grant sets, de-duplicated by uid. Deliberately **not** the
   * selector's `items()`, which is paged and would count a first page rather than a holding.
   *
   * Interim. lfx-self-serve#4126 exposes the caller's resolved roll-up set from the BFF, which is
   * the authority — it walks `b2b_org.is_parent` / `parent_uid` the way the access layer already
   * does, and can see organizations no persona seed carries. Swap this computed for that response
   * when it lands; nothing outside this service reads the sources directly.
   */
  public readonly rollUpOrganizationCount: Signal<number> = computed(() => {
    const uids = new Set<string>();
    // The persona seeds, NOT `availableAccounts()`. That signal swaps each seed for its enriched
    // Snowflake row, and `toAccount` does not carry `uid` — so counting it would drop every
    // enriched organization and hide the roll-up row the moment enrichment succeeded.
    for (const account of this.userOrganizations()) {
      if (account.uid) {
        uids.add(account.uid);
      }
    }
    for (const set of [
      this.orgRoleGrantsService.writerSet(),
      this.orgRoleGrantsService.auditorSet(),
      this.orgRoleGrantsService.inheritedWriterSet(),
      this.orgRoleGrantsService.inheritedAuditorSet(),
    ]) {
      for (const uid of set) {
        uids.add(uid);
      }
    }
    return uids.size;
  });

  /** Dark-launch gate — off until the BFF accepts the sentinel (#4127). See `ORG_LENS_ROLLUP_ENABLED_FLAG`. */
  private readonly rollUpFlag: Signal<boolean> = this.featureFlagService.getBooleanFlag(ORG_LENS_ROLLUP_ENABLED_FLAG);

  /** Set once the wait for the flag provider has run out — see `rollUpFlagResolved`. */
  private readonly rollUpFlagWaitElapsed: WritableSignal<boolean> = signal(false);

  /**
   * Whether `rollUpFlag()` is worth believing yet.
   *
   * `getBooleanFlag` answers its default (false) until the provider streams real values, so an
   * unresolved flag must not read as a disabled one — `AppComponent` seeds organizations before it
   * initializes the flag service, and treating that window as "off" overwrote a restored `all`
   * cookie (#4415 review 3).
   *
   * Bounded, though. `providerReady` stays false for the whole session if LaunchDarkly is
   * unreachable or the authenticated `identify()` fails and recovery fails too, and an unbounded
   * wait would admit `/org/all` indefinitely — for a single-organization caller, and even with the
   * flag genuinely off (#4415 review 4). So the window closes on the first of: the provider
   * reaching READY, the service reporting `initialized`, or `FEATURE_FLAG_READY_TIMEOUT_MS`
   * elapsing (the same budget `waitForReady` gives every flag-gated guard).
   *
   * Closing it without a READY provider means the flag reads its default, false — the feature stays
   * dark through an outage, which is what a dark-launch gate is for, and the safer direction given
   * the BFF does not accept the sentinel yet.
   */
  private readonly rollUpFlagResolved: Signal<boolean> = computed(
    () => this.featureFlagService.providerReady() || this.featureFlagService.initialized() || this.rollUpFlagWaitElapsed()
  );

  /** Whether the roll-up is offered at all: the flag is on and the caller holds two or more organizations (#4132). */
  public readonly canSelectRollUp: Signal<boolean> = computed(
    () => this.rollUpFlagResolved() && this.rollUpFlag() && this.rollUpOrganizationCount() >= ROLLUP_MIN_ORGANIZATIONS
  );

  /**
   * True while eligibility cannot be judged: `rollUpOrganizationCount()` is a lower bound, so a
   * caller who does qualify can still count as one organization. A conglomerate's sibling
   * organizations arrive as *inherited* grants rather than persona seeds, which is what makes the
   * difference. Callers restoring or adopting a roll-up admit it optimistically here and let the
   * constructor's reconciliation effect (`demoteFromRollUp`) settle it.
   *
   * Two windows, not one. The obvious one is `!loaded()`. The other is a lookup that finished
   * *badly*: `OrgRoleGrantsService.refresh()` sets `loaded` true in its `catchError` branch too,
   * having cleared every grant set — its own comment says the grants are then "unknown, not empty",
   * and it raises `degraded` / `lookupOutcome: 'failed'` to say so. Reading that as a settled answer
   * would demote a genuine conglomerate admin on a transient BFF outage and persist the concrete uid
   * over their `all` cookie, so the choice would not come back when the outage cleared. Anything but
   * `'ok'` therefore stays pending: a `'partial'` roll-up expansion is a lower bound for the same
   * reason. Staying in the roll-up through a degraded lookup is recoverable; silently overwriting
   * the cookie is not.
   */
  public readonly rollUpEligibilityPending: Signal<boolean> = computed(() => {
    // The flag value itself is not trustworthy yet. `AppComponent` calls
    // `initializeUserOrganizations()` (line ~146) before `featureFlagService.initialize()` (~164),
    // and `getBooleanFlag` answers false until the provider streams real values — so a restored
    // `{ uid: 'all' }` cookie read as "feature off" and was overwritten with the first seed before
    // anyone had asked LaunchDarkly. `providerReady` is the distinction between "off" and "not yet".
    if (!this.rollUpFlagResolved()) {
      return true;
    }
    // A settled "off" is a real answer: nothing to wait for, and a stale roll-up should be demoted.
    if (!this.rollUpFlag()) {
      return false;
    }
    return !this.orgRoleGrantsService.loaded() || this.orgRoleGrantsService.lookupOutcome() !== 'ok';
  });

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
   * LFXV2-3029) writer or auditor grant, at least one persona-seeded account, or company-wide team membership (`isStaff`).
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
      this.orgRoleGrantsService.isStaff() ||
      // M3: a CLA Manager with no grant still needs the selector to reach their company's EasyCLA tab.
      this.orgClaOnlyAccess.claOnlyOrgUids().size > 0
  );

  public constructor() {
    // Bootstrap on the placeholder; cookie only contributes accountId for later seed reconciliation — display fields never come from the cookie.
    this.selectedAccount = signal<Account>(PLACEHOLDER_ACCOUNT);

    // Bound the unresolved-flag window (see `rollUpFlagResolved`). Browser-only: SSR renders once
    // and never sits in this window waiting.
    if (isPlatformBrowser(this.platformId)) {
      const timer = setTimeout(() => this.rollUpFlagWaitElapsed.set(true), FEATURE_FLAG_READY_TIMEOUT_MS);
      this.destroyRef.onDestroy(() => clearTimeout(timer));
    }

    // Settle an optimistically admitted roll-up once the grant sets land. A cookie restore or a
    // `/org/all` deep link is admitted while `OrgRoleGrantsService` is still loading — the count is
    // a lower bound until then, and demoting on it would drop a genuine conglomerate admin into one
    // company. Nothing else re-runs afterwards: `applyRollUpSelection` pins the selection, so every
    // later `initializeUserOrganizations` returns through its `isAddressedSelection()` branch, and
    // the path guard does not re-run on a page it already activated. Without this effect a caller
    // whose access has since shrunk to one organization would stay in roll-up mode for the session.
    effect(() => {
      // `isRollUp()` first, and it reads nothing but the selection. There is no eligibility question
      // to answer while a concrete organization is selected, and asking anyway would pull the flag
      // provider and the grant sets into every consumer that merely holds this service.
      if (!this.isRollUp()) {
        return;
      }
      const pending = this.rollUpEligibilityPending();
      const eligible = this.canSelectRollUp();
      untracked(() => {
        if (pending || eligible) {
          return;
        }
        this.demoteFromRollUp();
      });
    });
  }

  /** Seed persona-authorised orgs and trigger Snowflake enrichment; selection matches by stored accountId only — display attributes always come from seeds or live response. */
  public initializeUserOrganizations(organizations: Account[]): void {
    const seeds = organizations ?? [];
    // Every (re-)seed supersedes any in-flight enrichment — including empty ones, which return
    // early without starting a fetch (as does the addressed-selection branch below). Without this,
    // a late bootstrap response would repopulate `liveAccounts` and could patch the selection with
    // stale fields. A fetching re-seed advances the generation once more when its fetch starts;
    // only order matters, gaps are irrelevant.
    this.enrichmentGeneration++;
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

    // Read before the empty-seeds bail-out: a caller whose sibling organizations come from
    // *inherited* grants rather than persona seeds has no seeds at all, and bailing out first would
    // drop their restored roll-up to the placeholder.
    const storedUid = this.loadUidFromStorage();

    // A cookie-restored roll-up (#4133). Restored optimistically while the grant sets are still
    // loading: a conglomerate's sibling organizations commonly arrive as *inherited* grants rather
    // than persona seeds, so `canSelectRollUp()` under-counts until `OrgRoleGrantsService` settles,
    // and demoting on that transient count would drop the caller into one company and overwrite the
    // cookie that said otherwise. Once the grants have loaded the count is trustworthy, and a caller
    // who no longer holds two organizations falls through to the ordinary default selection below.
    if (isOrgRollUpSegment(storedUid) && (this.canSelectRollUp() || this.rollUpEligibilityPending())) {
      this.applyRollUpSelection();
      this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
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
    // Past the roll-up branch above, a sentinel cookie belongs to a caller who no longer qualifies.
    // It must not reach the uid-stub path below, which would select `{ uid: 'all' }` as though it
    // were an organization and leave `isRollUp()` true after the demotion.
    const concreteStoredUid = isOrgRollUpSegment(storedUid) ? null : storedUid;
    const matchedSeed = concreteStoredUid ? (seeds.find((seed) => seed.uid === concreteStoredUid) ?? null) : null;
    if (matchedSeed) {
      this.setAccount(matchedSeed);
    } else if (concreteStoredUid) {
      const stub: Account = { ...PLACEHOLDER_ACCOUNT, uid: concreteStoredUid };
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

  /**
   * Select the All Organizations roll-up (#4125). Pinned as an `'address'` selection for the same
   * reason a resolver hit is: from here on the address is `/org/all/…` and only the roll-up may
   * render under it, so neither an org-items reload nor a persona re-seed may default it back to a
   * single organization.
   *
   * No-op when the caller holds fewer than `ROLLUP_MIN_ORGANIZATIONS`, so a stale cookie or a hand-typed
   * `/org/all` cannot put a single-org caller into a mode built for several.
   */
  public selectRollUp(options?: { admitWhilePending?: boolean }): boolean {
    const admissible = this.canSelectRollUp() || (options?.admitWhilePending === true && this.rollUpEligibilityPending());
    if (!admissible) {
      return false;
    }
    this.applyRollUpSelection();
    return true;
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
    // The roll-up names a set, not a `b2b_org` row: there is no canonical record to reconcile, and
    // asking would put the reserved segment through an `:orgUid` endpoint that has no business
    // accepting it (#4125).
    if (isOrgRollUpSegment(identifier)) {
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

  /**
   * Leave roll-up mode for the one organization the caller still holds (or the placeholder when
   * they hold none), releasing the pin the roll-up took so the ordinary selection paths own the
   * choice again.
   *
   * The address is re-pointed off `/org/all/…` in place by `repointAddressAfterDemotion`
   * (`replaceUrl`, keeping page, query and fragment). An earlier revision deliberately left that to
   * `orgPathParamGuard`'s next run, on the grounds that navigating from a service effect would
   * fight the router — but that left the page showing one organization's data under a combined-view
   * address until the viewer happened to navigate. The re-point handles the concern instead of
   * avoiding it: it waits for the router to be idle before correcting.
   */
  private demoteFromRollUp(): void {
    this.addressedUid.set(null);
    this.pinSource.set(null);

    const fallback = this.demotionFallback();
    if (!fallback) {
      this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
      this.clearStorage();
      this.repointAddressAfterDemotion(null);
      return;
    }

    this.setAccount(fallback);
    // A uid-only stub (a grant with no seed behind it) has no display fields yet.
    if (!fallback.accountName) {
      void this.refreshCanonicalRecord(fallback);
    }
    this.repointAddressAfterDemotion(fallback);
  }

  /**
   * The organization a demoted caller lands on. Persona seeds first, since they carry display
   * fields — but eligibility counts direct and inherited grants too, and the caller this feature
   * targets can hold organizations with no seed at all. Falling back to seeds alone dropped such a
   * caller to the placeholder and cleared their cookie even though they still held an organization.
   */
  private demotionFallback(): Account | null {
    const seed = this.userOrganizations()[0];
    if (seed) {
      return seed;
    }
    for (const set of [
      this.orgRoleGrantsService.writerSet(),
      this.orgRoleGrantsService.auditorSet(),
      this.orgRoleGrantsService.inheritedWriterSet(),
      this.orgRoleGrantsService.inheritedAuditorSet(),
    ]) {
      for (const uid of set) {
        // Same shape the cookie-restore path uses for an id with no seed behind it.
        return { ...PLACEHOLDER_ACCOUNT, uid };
      }
    }
    return null;
  }

  /**
   * Leave the `/org/all/…` address when the selection is no longer the roll-up. Without this the
   * page keeps a combined-view address while its consumers read one organization's data — the
   * mismatch spec 050 exists to prevent, just in the other direction. The page, query and fragment
   * are kept; only the organization segment changes.
   *
   * `replaceUrl`, not a push: the roll-up address was never valid for this caller, so it is a
   * correction rather than a step they could sensibly go Back to. Browser-only — SSR issues no
   * redirects (FR-021) — and a no-op off `/org/all/…`, which is every page the guard already
   * re-points on its own next run.
   */
  private repointAddressAfterDemotion(next: Account | null): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // One pending re-point at most, and never while a navigation is in flight. Reading `router.url`
    // mid-navigation sees the address being *left*, not the one being entered — so arriving at
    // `/org/all/people` would miss the correction, and leaving a roll-up page would cancel the
    // viewer's own navigation to a concrete organization. Mirrors `OrgNavigationService`'s
    // `writeDefaultAddress`, including its re-check once the router settles.
    this.pendingRepoint?.unsubscribe();
    this.pendingRepoint = null;

    if (!this.router.getCurrentNavigation()) {
      this.repointNow(next);
      return;
    }
    this.pendingRepoint = this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError || event instanceof NavigationSkipped
        ),
        switchMap(() => from(Promise.resolve())),
        filter(() => !this.router.getCurrentNavigation()),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.pendingRepoint = null;
        // Re-read the selection: the settled navigation may have adopted an organization of its own
        // (the path guard on a concrete address), in which case there is nothing to correct.
        if (this.isRollUp()) {
          return;
        }
        this.repointNow(this.selectedAccount());
      });
  }

  /** The re-point itself, once the router is idle. A no-op off `/org/all/…`. */
  private repointNow(next: Account | null): void {
    const tree = this.router.parseUrl(this.router.url);
    const primary = tree.root.children['primary'];
    const segments = primary?.segments ?? [];
    // `normalizeOrgSegment`, because the guards admit `/org/All/people` — the match guard lowercases
    // before testing and the roll-up branch returns without canonicalizing — so a mixed-case address
    // would otherwise keep its combined-view URL after demotion.
    if (segments.length < 2 || segments[0].path !== 'org' || !isOrgRollUpSegment(normalizeOrgSegment(segments[1].path))) {
      return;
    }
    const segment = next ? orgUrlSegment(next) : null;
    if (!segment) {
      void this.router.navigate([ORG_NOT_FOUND_PATH], { replaceUrl: true });
      return;
    }
    primary.segments[1].path = segment;
    primary.segments[1].parameters = {};
    void this.router.navigateByUrl(tree, { replaceUrl: true });
  }

  /** Writes the roll-up selection and pins it as an address selection. The eligibility gate lives in the callers. */
  private applyRollUpSelection(): void {
    this.selectedAccount.set(ROLLUP_ACCOUNT);
    this.persistToStorage(ROLLUP_ACCOUNT);
    this.addressedUid.set(ORG_ROLLUP_SEGMENT);
    this.pinSource.set('address');
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

  /**
   * Spec 002: the org uid is the canonical 18-char Salesforce account id; legacy UUIDs (and anything
   * else) are treated as absent/tampered so a stale cookie degrades to the default selection.
   *
   * The reserved roll-up segment is accepted as well, so `{ uid: 'all' }` survives a refresh instead
   * of being discarded as a legacy id (#4133). Widened here, in the cookie round-trip, rather than in
   * `ORG_ACCOUNT_ID_PATTERN` itself: that constant is the request-boundary validator for roughly
   * fifteen server call sites (`assertOrgUid`, `requireOrgLensAccess`, the analytics access helper,
   * crowdfunding, the slug resolver's `prefer`), and widening it would make every one of them accept
   * the sentinel before lfx-self-serve#4127 has taught any of them to authorize it. Restoring the
   * cookie still goes through `canSelectRollUp`, so a restored sentinel only takes effect for a
   * caller who actually holds two or more organizations.
   */
  private isValidUid(uid: unknown): uid is string {
    return typeof uid === 'string' && (ORG_ACCOUNT_ID_PATTERN.test(uid) || isOrgRollUpSegment(uid));
  }
}
