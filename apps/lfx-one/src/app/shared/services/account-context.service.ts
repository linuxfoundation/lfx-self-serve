// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, Router } from '@angular/router';
import { ACCOUNT_COOKIE_KEY, ORG_ACCOUNT_ID_PATTERN, ORG_NOT_FOUND_PATH, ROLLUP_MIN_ORGANIZATIONS } from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse, OrgRollUpFamily } from '@lfx-one/shared/interfaces';
import { isOrgRollUpSegment, normalizeOrgSegment, orgRollUpAccount, orgRollUpRootUid, orgUrlSegment } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { filter, firstValueFrom, from, Subscription, switchMap, take } from 'rxjs';

import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { OrgRollUpFamiliesService } from './org-roll-up-families.service';
import { OrgRollUpFlagService } from './org-roll-up-flag.service';

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
  private readonly rollUpFamiliesService = inject(OrgRollUpFamiliesService);
  private readonly rollUpFlag = inject(OrgRollUpFlagService);
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

  /** The top Salesforce account id of the family whose roll-up is the selection, or null when a concrete organization (or nothing) is selected (#4125). */
  public readonly selectedRollUpRootUid: Signal<string | null> = computed(() => orgRollUpRootUid(this.selectedAccount().uid));

  /** True while a family roll-up is the selection — every page reads combined data and every write is gated off (#4125). */
  public readonly isRollUp: Signal<boolean> = computed(() => this.selectedRollUpRootUid() !== null);

  /**
   * The caller's organizations grouped by Salesforce family — one roll-up per family (#4125). Every
   * family the caller holds anything in, including one-organization families, which are not offered
   * as a roll-up (`eligibleRollUpFamilies`).
   *
   * The server's families (`OrgRollUpFamiliesService`, lfx-self-serve#4126) — it resolves each
   * organization to its family's top account, which the grant sets alone cannot. Empty while that
   * answer is pending or failed: unknown, not empty, and `grantsUnsettled` holds every demotion
   * until it lands.
   */
  public readonly rollUpFamilies: Signal<OrgRollUpFamily[]> = computed(() =>
    this.rollUpFamiliesService.hasServerFamilies() ? this.rollUpFamiliesService.families() : []
  );

  /**
   * True once the families answer landed as a lower bound or unknown — the switcher shows its
   * incomplete-list notice, whose Retry re-runs the grants and so the families. Only while the
   * roll-up flag is on: with it off the families feed nothing on screen, so their failure is not
   * the viewer's concern.
   */
  public readonly rollUpFamiliesIncomplete: Signal<boolean> = computed(() => this.rollUpFlag.enabled() && this.rollUpFamiliesService.incomplete());
  /** True while the families cannot settle roll-up eligibility — the window admission rides out, so held-ness must ride it out too. */
  public readonly rollUpFamiliesUnsettled: Signal<boolean> = this.rollUpFamiliesService.unsettled;
  /** Gated like `rollUpFamiliesIncomplete`: the switcher's Retry stays busy through the refetch only when the roll-up is offered at all. */
  public readonly rollUpFamiliesLoading: Signal<boolean> = computed(() => this.rollUpFlag.enabled() && this.rollUpFamiliesService.loading());

  /**
   * The families a roll-up is offered for: those where the caller holds at least
   * `ROLLUP_MIN_ORGANIZATIONS` organizations (#4132), from a settled answer only. A partial answer
   * can name a provisional top account, and an answer to an earlier grants load can name a family
   * the reload shrank or removed; a pick made on either would demote once the current answer lands.
   * A selection made before stays admitted: `rollUpEligibilityUnsettled` holds it meanwhile.
   *
   * None at all unless the `org-lens-rollup-enabled` flag is known to be on for this viewer.
   */
  public readonly eligibleRollUpFamilies: Signal<OrgRollUpFamily[]> = computed(() =>
    !this.rollUpFlag.enabled() || this.rollUpFamiliesService.unsettled()
      ? []
      : this.rollUpFamilies().filter((family) => family.orgUids.length >= ROLLUP_MIN_ORGANIZATIONS)
  );

  /** The family behind the selected roll-up, or null when no roll-up is selected or its family is not known (yet). */
  public readonly selectedRollUpFamily: Signal<OrgRollUpFamily | null> = computed(() => {
    const rootUid = this.selectedRollUpRootUid();
    return rootUid ? (this.rollUpFamilies().find((family) => family.rootUid === rootUid) ?? null) : null;
  });

  /** How many organizations the selected roll-up combines — 0 while its family is not known (yet). */
  public readonly rollUpOrganizationCount: Signal<number> = computed(() => this.selectedRollUpFamily()?.orgUids.length ?? 0);

  /**
   * True when the roll-up is the selection and the caller has stopped qualifying for it — the one
   * condition that demotes.
   *
   * `isRollUp()` is read first and short-circuits: there is no eligibility question while a concrete
   * organization is selected, and asking anyway would pull the grant sets into every consumer that
   * merely holds this service.
   *
   * The exact complement of what `selectRollUp` admits, so admission and reconciliation cannot
   * answer the same question differently — the defect of #4415 review 12.
   */
  private readonly rollUpShouldDemote: Signal<boolean> = computed(() => {
    const rootUid = this.selectedRollUpRootUid();
    return rootUid !== null && !this.rollUpEligibilityUnsettled() && !this.canSelectRollUpFor(rootUid);
  });

  /** Whether any roll-up is offered: the caller holds two or more organizations in at least one family (#4132). */
  public readonly canSelectRollUp: Signal<boolean> = computed(() => this.eligibleRollUpFamilies().length > 0);

  /**
   * True while the grant sets are not a usable answer — still loading, or loaded from a lookup that
   * failed or came back partial, which `OrgRoleGrantsService` reports as grants "unknown, not
   * empty". Anything derived from them (the roll-up count, the demotion fallback) is a lower bound
   * until this clears, so it is also the window in which roll-up eligibility cannot be judged.
   *
   * `rollUpFamilies()` under-counts while it holds: a conglomerate's sibling organizations arrive as
   * *inherited* grants rather than persona seeds, so a caller who does qualify can still count as
   * one organization in that family. Callers restoring or adopting a roll-up therefore admit it
   * optimistically and let the constructor's reconciliation settle it.
   *
   * Two windows, not one. The obvious one is `!loaded()`. The other is a lookup that finished
   * *badly*: `OrgRoleGrantsService.refresh()` sets `loaded` true in its `catchError` branch too,
   * having cleared every grant set — its own comment says the grants are then "unknown, not empty",
   * and it raises `degraded` / `lookupOutcome: 'failed'` to say so. Reading that as a settled answer
   * would demote a genuine conglomerate admin on a transient BFF outage and persist the concrete uid
   * over their roll-up cookie, so the choice would not come back when the outage cleared. Anything but
   * `'ok'` therefore stays unsettled: a `'partial'` roll-up expansion is a lower bound for the same
   * reason.
   *
   * The families answer is held to the same rule (`OrgRollUpFamiliesService.unsettled`): it lands
   * after the grants, and judging a family's size before it does would demote a caller whose
   * family is simply not known yet.
   */
  public readonly grantsUnsettled: Signal<boolean> = computed(
    () => !this.orgRoleGrantsService.loaded() || this.orgRoleGrantsService.lookupOutcome() !== 'ok' || this.rollUpFamiliesService.unsettled()
  );

  /**
   * The window in which a roll-up already selected — restored from the cookie or adopted from an
   * address — is neither confirmed nor demoted: the grants are unsettled, or the
   * `org-lens-rollup-enabled` flag has not answered for the signed-in viewer yet. LaunchDarkly
   * answers for an anonymous context first, so treating that answer as "off" would demote a viewer
   * the flag targets.
   */
  private readonly rollUpEligibilityUnsettled: Signal<boolean> = computed(() => this.grantsUnsettled() || this.rollUpFlag.unsettled());

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

    // Settle an optimistically admitted roll-up once the grant sets land. A cookie restore or a
    // `/org/family-…` deep link is admitted while `OrgRoleGrantsService` is still loading — the count is
    // a lower bound until then, and demoting on it would drop a genuine conglomerate admin into one
    // company. Nothing else re-runs afterwards: `applyRollUpSelection` pins the selection, so every
    // later `initializeUserOrganizations` returns through its `isAddressedSelection()` branch, and
    // the path guard does not re-run on a page it already activated. Without this a caller whose
    // access has since shrunk to one organization would stay in roll-up mode for the session.
    //
    // `toObservable` rather than `effect()`: this writes state, which the frontend checklist
    // reserves effects out of (§5, "No effect()"), and a lifecycle-managed subscription is the
    // pattern `OrgNavigationService.whenGrantsSettled` already uses for a deferred decision.
    toObservable(this.rollUpShouldDemote)
      .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.demoteFromRollUp());

    // A restored or deep-linked roll-up is admitted before its family is known, under the generic
    // name. Once the family lands, rename the selection itself — not just the switcher label — so
    // every page heading reads the same name. The address pin and the cookie hold only the uid.
    toObservable(this.selectedRollUpFamily)
      .pipe(
        filter((family): family is OrgRollUpFamily => family !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((family) => this.renameSelectedRollUp(family));
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

    // A cookie-restored family roll-up (#4133). Restored optimistically while the grant sets are
    // still loading: a conglomerate's sibling organizations commonly arrive as *inherited* grants
    // rather than persona seeds, so `canSelectRollUpFor()` under-counts until `OrgRoleGrantsService`
    // settles, and demoting on that transient count would drop the caller into one company and
    // overwrite the cookie that said otherwise. Once the grants have loaded the count is
    // trustworthy, and a caller who no longer holds two organizations in that family falls through
    // to the ordinary default selection below.
    const storedRootUid = orgRollUpRootUid(storedUid);
    if (storedRootUid && (this.canSelectRollUpFor(storedRootUid) || this.rollUpEligibilityUnsettled())) {
      this.applyRollUpSelection(storedRootUid);
      this.refreshFromSnowflake(seeds.map((seed) => seed.accountId));
      return;
    }

    if (seeds.length === 0) {
      // Reached with a stored roll-up only once the grants have settled below the minimum, since
      // the branch above admits every unsettled visit. Leaving the sentinel in the cookie would
      // restore the combined view on the next bootstrap's unsettled window and flicker through it
      // before reconciliation demoted again, so it is replaced with whatever the caller does hold
      // — inherited grants included — or cleared (#4415, Cursor).
      if (isOrgRollUpSegment(storedUid)) {
        const fallback = this.rollUpFallbackOrganization(storedRootUid);
        if (fallback) {
          this.setAccount(fallback);
          // A grant with no seed behind it is a uid-only stub, so the trigger would render a blank
          // name until the canonical record lands (#4415, Cursor). Not `applyDemotionFallback`:
          // that also pins the selection as an ADDRESS one, and no address names this — a cookie
          // restore deliberately keeps the legacy link form until the organization is confirmed,
          // which `orgLensLandingLink` reads off `isAddressedSelection`.
          if (!fallback.accountName) {
            void this.refreshCanonicalRecord(fallback);
          }
          return;
        }
        this.clearStorage();
      }
      this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
      return;
    }

    // Spec 002: the cookie persists the org account id (18-char SFID), stored under the `uid` field.
    // Match a seed by uid when one carries it; otherwise select a stub keyed only by the stored id and
    // let the canonical fetch hydrate display fields. Falls back to the first seed when there is no
    // stored id (or it is a legacy UUID / otherwise invalid).
    // Past the roll-up branch above, a sentinel cookie belongs to a caller who no longer qualifies.
    // It must not reach the uid-stub path below, which would select `{ uid: 'family-…' }` as though it
    // were an organization and leave `isRollUp()` true after the demotion.
    const concreteStoredUid = isOrgRollUpSegment(storedUid) ? null : storedUid;
    const matchedSeed = concreteStoredUid ? (seeds.find((seed) => seed.uid === concreteStoredUid) ?? null) : null;
    if (matchedSeed) {
      this.setAccount(matchedSeed);
    } else if (concreteStoredUid) {
      // `accountId` as well as `uid`: a grant uid IS the 18-char Salesforce account id, and the
      // pages key on `accountId` — Events drops a null one before its `switchMap`, so a stub
      // without it leaves the previous results on screen (#4415, Copilot).
      const stub: Account = { ...PLACEHOLDER_ACCOUNT, uid: concreteStoredUid, accountId: concreteStoredUid };
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
   * Select the roll-up of the family whose top Salesforce account id is `rootUid` (#4125). Pinned as
   * an `'address'` selection for the same reason a resolver hit is: from here on the address is
   * `/org/family-{rootUid}/…` and only that roll-up may render under it, so neither an org-items
   * reload nor a persona re-seed may default it back to a single organization.
   *
   * No-op when the caller holds fewer than `ROLLUP_MIN_ORGANIZATIONS` in that family, so a stale
   * cookie or a hand-typed address cannot put a caller into a mode built for several.
   */
  public selectRollUp(rootUid: string, options?: { admitWhilePending?: boolean }): boolean {
    // `admitWhilePending` is for an ADDRESS — a `/org/family-…` deep link the guard is activating.
    // The count is a lower bound while the grants are unsettled, so refusing then would send a
    // genuine conglomerate admin to `/org/not-found`: a dead end later grants cannot repair,
    // because reconciliation stops once the roll-up is deselected and no default may leave
    // not-found. Admitting is self-correcting instead — `rollUpShouldDemote` is the exact
    // complement of this condition, so the moment the grants land either they confirm the roll-up
    // or reconciliation demotes and re-points (#4415 reviews 10 and 12).
    const admissible = this.canSelectRollUpFor(rootUid) || (options?.admitWhilePending === true && this.rollUpEligibilityUnsettled());
    if (!admissible) {
      return false;
    }
    this.applyRollUpSelection(rootUid);
    return true;
  }

  /** Whether the roll-up of the family topped by `rootUid` is offered: the caller holds at least `ROLLUP_MIN_ORGANIZATIONS` organizations in it. */
  public canSelectRollUpFor(rootUid: string | null | undefined): boolean {
    return !!rootUid && this.eligibleRollUpFamilies().some((family) => family.rootUid === rootUid);
  }

  /**
   * The organization to fall back on when the roll-up is not available to this caller — on a
   * demotion, or when `orgPathParamGuard` turns an ineligible `/org/family-…` address into a
   * concrete one.
   *
   * An organization in the same family (`rootUid`) first, so leaving a roll-up lands inside the
   * family it combined rather than in an unrelated company the caller also holds.
   *
   * Persona seeds first, since they carry display fields; otherwise a uid from the grant sets as a
   * stub for the canonical fetch to hydrate. Eligibility counts direct and inherited grants, so a
   * caller can hold an organization with no seed behind it at all — seeds alone sent them to the
   * placeholder (and, from the guard, to `/org/not-found`) while they still held one.
   *
   * Public because the guard needs the same answer: it previously fell back to `selectedAccount()`
   * alone, which for a grant-only caller is the placeholder (#4415 review 7).
   */
  public rollUpFallbackOrganization(rootUid?: string | null): Account | null {
    const familyUids = rootUid ? (this.rollUpFamilies().find((family) => family.rootUid === rootUid)?.orgUids ?? []) : [];
    const familySeed = this.userOrganizations().find((account) => !!account.uid && familyUids.includes(account.uid));
    if (familySeed) {
      return familySeed;
    }
    if (familyUids.length > 0) {
      // `accountId` too, for the same reason as the grant-set stub below.
      return { ...PLACEHOLDER_ACCOUNT, uid: familyUids[0], accountId: familyUids[0] };
    }
    const seed = this.userOrganizations()[0];
    if (seed) {
      return seed;
    }
    for (const set of [
      this.orgRoleGrantsService.writerSet(),
      this.orgRoleGrantsService.auditorSet(),
      this.orgRoleGrantsService.inheritedWriterSet(),
      this.orgRoleGrantsService.inheritedAuditorSet(),
      // Last, and never grouped into `rollUpFamilies`: a CLA-only organization is a real
      // address but not something the roll-up combines (M3). Without it a caller whose Org Lens
      // grants lapsed while their CLA-manager company remained would fall back to `null` and land
      // on `/org/not-found`, even though `canAddressOrganization` keeps that same organization when
      // they are already addressing it — the EasyCLA page guard redirects it from there (#4415, Copilot).
      this.orgClaOnlyAccess.claOnlyOrgUids(),
    ]) {
      for (const uid of set) {
        // Same shape the cookie-restore path uses for an id with no seed behind it, `accountId`
        // included: demoting off the roll-up with Events open must actually re-fetch, and that
        // pipeline filters out a null `accountId` before its `switchMap`, so an empty one would
        // leave the combined results sitting under the concrete organization's address
        // (#4415, Copilot).
        return { ...PLACEHOLDER_ACCOUNT, uid, accountId: uid };
      }
    }
    return null;
  }

  /**
   * Leave an addressed `/org/family-{rootUid}/…` this caller may not have, and answer with the
   * organization the address should name instead — `orgPathParamGuard`'s half of `demoteFromRollUp`.
   *
   * The result is adopted as an ADDRESS selection, not a bare `setAccount`. The address is about to
   * name it, so a persona re-seed or an empty org-items first page must not replace or clear it
   * before that navigation settles — the same reason a resolver hit pins.
   */
  public demoteAddressedRollUp(rootUid: string): Account | null {
    const current = this.selectedAccount();
    // The current selection counts only when it is a CONCRETE organization the caller still holds.
    //
    // Concrete, because `orgUrlSegment` is truthy for the roll-up itself (it answers the sentinel),
    // so reusing it would leave the caller on the very combined-view address this is trying to
    // leave, with `canonicalizeAddress` a no-op.
    //
    // Held, because addressable is not the same as entitled: a stale selection of A, with the
    // settled grants naming only B, would otherwise be pinned AND persisted as the demotion target
    // — an organization this caller does not have, in the cookie, over the one they do. The server
    // still fails closed, so the pages would simply be empty rather than wrong (#4415, Copilot).
    //
    // Only reached from `orgPathParamGuard` once the grants and the roll-up flag have settled —
    // `admitWhilePending` admits every unsettled visit — so the held set is authoritative here, not
    // a lower bound.
    const concrete = !isOrgRollUpSegment(current.uid) && orgUrlSegment(current) && this.canAddressOrganization(current.uid) ? current : null;
    // The addressed family first: a link to family A lands in A while the caller still holds an
    // organization there, whatever company they happened to be viewing before.
    const familyUids = this.rollUpFamilies().find((family) => family.rootUid === rootUid)?.orgUids ?? [];
    let next: Account | null = concrete && familyUids.includes(concrete.uid ?? '') ? concrete : null;
    if (!next && familyUids.length > 0) {
      next = this.rollUpFallbackOrganization(rootUid);
    }
    next ??= concrete ?? this.rollUpFallbackOrganization(rootUid);
    if (!next || !orgUrlSegment(next)) {
      return null;
    }

    this.applyDemotionFallback(next);
    return next;
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

  /**
   * The organization an org-items fetch should pin into its first page — the current selection, else
   * the stored one — or `null` when there is none to pin.
   *
   * Never the roll-up sentinel. `selected_uid` names a `b2b_org` row for the server to guarantee is
   * present; a roll-up segment names none, and both the selection and the cookie can hold it. Sent anyway it is
   * at best ignored and at worst rejected at the request boundary, which fails the whole list and
   * leaves the panel showing the pinned roll-up row and no organizations — with no way to switch
   * away from the very mode that caused it (#4415, Cursor).
   */
  public orgListPinUid(): string | null {
    const uid = this.selectedAccount().uid || this.getStoredUid();
    return uid && !isOrgRollUpSegment(uid) ? uid : null;
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
   * Only ever reached once the grants have settled below `ROLLUP_MIN_ORGANIZATIONS` — the roll-up is
   * now *wrong* for this caller, not merely unavailable — so the stored choice is updated like any
   * other switch rather than held.
   *
   * The address is re-pointed off `/org/family-…/…` in place by `repointAddressAfterDemotion`
   * (`replaceUrl`, keeping page, query and fragment). An earlier revision deliberately left that to
   * `orgPathParamGuard`'s next run, on the grounds that navigating from a service effect would
   * fight the router — but that left the page showing one organization's data under a combined-view
   * address until the viewer happened to navigate. The re-point handles the concern instead of
   * avoiding it: it waits for the router to be idle before correcting.
   */
  private demoteFromRollUp(): void {
    const rootUid = this.selectedRollUpRootUid();
    this.addressedUid.set(null);
    this.pinSource.set(null);

    const fallback = this.rollUpFallbackOrganization(rootUid);
    if (!fallback) {
      this.selectedAccount.set(PLACEHOLDER_ACCOUNT);
      this.clearStorage();
      this.repointAddressAfterDemotion(null);
      return;
    }

    this.applyDemotionFallback(fallback);
    this.repointAddressAfterDemotion(fallback);
  }

  /**
   * Whether this caller may be left addressing `uid`.
   *
   * Deliberately wider than `rollUpFamilies`, which holds only what a roll-up would *combine*: this asks what the caller can reach at all, so it mirrors `hasOrgSelectorAccess`'s
   * sources rather than the roll-up's. A CLA-only organization is not part of a roll-up but is a
   * real address (M3: the EasyCLA tab), and a staff viewer reaches every organization with no grant
   * of their own — gating either on the roll-up's narrower set would send them to `/org/not-found`
   * from a page they were legitimately on.
   */
  private canAddressOrganization(uid: string | null | undefined): boolean {
    if (!uid) {
      return false;
    }
    if (this.orgRoleGrantsService.isStaff() || this.orgClaOnlyAccess.claOnlyOrgUids().has(uid)) {
      return true;
    }
    if (this.userOrganizations().some((account) => account.uid === uid)) {
      return true;
    }
    return [
      this.orgRoleGrantsService.writerSet(),
      this.orgRoleGrantsService.auditorSet(),
      this.orgRoleGrantsService.inheritedWriterSet(),
      this.orgRoleGrantsService.inheritedAuditorSet(),
    ].some((set) => set.has(uid));
  }

  /**
   * Select the organization a demotion lands on, identically for both demotion paths.
   *
   * The pin is the part that is easy to leave out, and it was: the effect-driven demotion applied
   * its fallback with a bare `setAccount`, so for a grant-only caller an empty persona re-seed
   * arriving between the demotion and the router settling reset the selection to the placeholder —
   * and the deferred re-point then read that placeholder and sent them to `/org/not-found` despite
   * the grant they still held (#4415 review 11). Pinned as an address selection, exactly as a
   * resolver hit, nothing may replace it before the navigation lands.
   */
  private applyDemotionFallback(next: Account): void {
    this.setAccount(next);
    this.addressedUid.set(next.uid ?? null);
    this.pinSource.set(next.uid ? 'address' : null);
    // A uid-only stub (a grant with no seed behind it) has no display fields yet.
    if (!next.accountName) {
      void this.refreshCanonicalRecord(next);
    }
  }

  /**
   * Leave the `/org/family-…/…` address when the selection is no longer the roll-up. Without this the
   * page keeps a combined-view address while its consumers read one organization's data — the
   * mismatch spec 050 exists to prevent, just in the other direction. The page, query and fragment
   * are kept; only the organization segment changes.
   *
   * `replaceUrl`, not a push: the roll-up address was never valid for this caller, so it is a
   * correction rather than a step they could sensibly go Back to. Browser-only — SSR issues no
   * redirects (FR-021) — and a no-op off `/org/family-…/…`, which is every page the guard already
   * re-points on its own next run.
   */
  private repointAddressAfterDemotion(next: Account | null): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // One pending re-point at most, and never while a navigation is in flight. Reading `router.url`
    // mid-navigation sees the address being *left*, not the one being entered — so arriving at
    // `/org/family-…/people` would miss the correction, and leaving a roll-up page would cancel the
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

  /** The re-point itself, once the router is idle. A no-op off `/org/family-…/…`. */
  private repointNow(next: Account | null): void {
    const tree = this.router.parseUrl(this.router.url);
    const primary = tree.root.children['primary'];
    const segments = primary?.segments ?? [];
    // `normalizeOrgSegment`, because the guards admit `/org/Family-…/people` — the match guard
    // normalizes before testing and the roll-up branch returns without canonicalizing — so a
    // mixed-case prefix would otherwise keep its combined-view URL after demotion.
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

  /** Writes the family roll-up selection and pins it as an address selection. The eligibility gate lives in the callers. */
  private applyRollUpSelection(rootUid: string): void {
    const family = this.rollUpFamilies().find((candidate) => candidate.rootUid === rootUid);
    const account = orgRollUpAccount(rootUid, family?.name);
    this.selectedAccount.set(account);
    this.persistToStorage(account);
    this.addressedUid.set(account.uid ?? null);
    this.pinSource.set('address');
  }

  /** Rewrites the selected roll-up's display name to its family's, when the selection is still that family's roll-up. */
  private renameSelectedRollUp(family: OrgRollUpFamily): void {
    const current = this.selectedAccount();
    const named = orgRollUpAccount(family.rootUid, family.name);
    if (current.uid !== named.uid || current.accountName === named.accountName) {
      return;
    }
    this.selectedAccount.set({ ...current, accountName: named.accountName });
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
   * A family roll-up segment is accepted as well, so `{ uid: 'family-…' }` survives a refresh
   * instead of being discarded as a legacy id (#4133). Widened here, in the cookie round-trip, rather than in
   * `ORG_ACCOUNT_ID_PATTERN` itself: that constant is the request-boundary validator for roughly
   * fifteen server call sites (`assertOrgUid`, `requireOrgLensAccess`, the analytics access helper,
   * crowdfunding, the slug resolver's `prefer`), and widening it would make every one of them accept
   * the sentinel before lfx-self-serve#4127 has taught any of them to authorize it. Restoring the
   * cookie still goes through `canSelectRollUpFor`, so a restored roll-up only takes effect for a
   * caller who actually holds two or more organizations in that family.
   */
  private isValidUid(uid: unknown): uid is string {
    return typeof uid === 'string' && (ORG_ACCOUNT_ID_PATTERN.test(uid) || isOrgRollUpSegment(uid));
  }
}
