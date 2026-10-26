// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensContractorProbe, OrgLensContractorVerdict, OrgLensEmptyStateName, OrgLensLookupBlocker } from '@lfx-one/shared/interfaces';
import { concat, distinctUntilChanged, map, of, switchMap, take } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgLensEmployerAffiliationService } from './org-lens-employer-affiliation.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

/**
 * Spec 053 — the single page-level classifier for Org Lens empty states (FR-016 precedence).
 *
 * Mirrors the server gate (`org-lens-read-access.helper.ts`): a resolved entry is authoritative, and an
 * incomplete roll-up must not veto an organization that is present. So the order is
 *
 *   1. caller holds the selected organization (or is in a company-wide team, or reaches it only as its
 *      CLA Manager — M3)                                       → render the page (`null`)
 *   2. lookup failed outright (roster never loaded)             → `could-not-load`
 *   3. lookup partial (or the M3 CLA-manager lookup failed)
 *      AND caller holds nothing loaded                          → `could-not-load`
 *   4. staff check failed                                       → `staff-check-failed`
 *   5. LF contractor refused what is in front of them           → `contractor-no-grant` (#2961)
 *   6. caller holds nothing, and their own employer holds no
 *      active LF membership                                     → `affiliated-non-member` (#4314)
 *   7. caller holds nothing, and the employer lookup failed      → `could-not-load` (#4314)
 *   8. caller holds nothing                                     → `no-organization`
 *   9. otherwise (a selection is pending)                       → `null`
 *
 * Rule 5 keys on the server's answer, never the roster: with an organization selected (persona seed,
 * cookie) it asks the read gate (`OrgRoleGrantsService.readCheck`), which also admits FGA-only readers
 * such as key-contact auditors that no list shows, and an organization it admits renders the page even
 * when the roster lists nothing; with nothing selected it is "holds nothing".
 *
 * Rule 6 before 7 is #4314: "add an affiliation" is only an answer for someone who has none. A caller
 * who already has one, at a company with no active membership in any LF-hosted foundation, is told that
 * instead — there is no Org Lens behind the CTA and no administrator to ask. It keys on a *resolved*
 * answer from `OrgLensEmployerAffiliationService`: no employer, a member employer, or a lookup that
 * failed all fall through, so an unknown never renders as "not a member". CLA state does not enter into
 * it — a CLA-only caller is already admitted by rule 1.
 *
 * Rule 7 is the other half of that: with the employer lookup failed, "add an affiliation" is a guess
 * too, since the caller may well have one. The honest render is the outage state with Retry, which
 * re-runs the employer probe alongside the grants lookup. Only a lookup that answered "no employer"
 * reaches rule 8.
 *
 * Rule 1 before 2/3 is the #2216 blocking fix ("direct grants must not fail when only group expansion
 * fails") — a held-but-degraded caller keeps their page and the switcher shows the FR-010 notice
 * instead (DR-002). Rule 4 before 5–6 is the epic's never-fall-through rule (FR-011): a failed team check
 * must not read as the contractor or employee copy.
 *
 * The addressed-but-unheld states (FR-007 / FR-008) are not decided here: `orgPathParamGuard` already
 * lands every unheld or unknown address on `/org/not-found`, which picks between them (research R6) —
 * after asking `classifyLookup` for rules 2–4, so the two surfaces cannot drift on the outage rules.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensEmptyStateService {
  private readonly accountContext = inject(AccountContextService);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly persona = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claOnlyAccess = inject(OrgClaOnlyAccessService);
  private readonly employerAffiliation = inject(OrgLensEmployerAffiliationService);

  /**
   * Generation of the list fetch the last `retry()` started, or `null` before any. `orgNavigation.loading`
   * is one flag for every list fetch — bootstrap, switcher search, next page — so on its own it would
   * mark Retry busy while the viewer merely types in the switcher. Matching the active generation
   * narrows it to Retry's own first page: a later search or reset bumps the generation and releases it,
   * a scroll after that page landed does not re-arm it, and there is no latch to clear.
   */
  private readonly retryGeneration = signal<number | null>(null);

  /**
   * #2961 — the organization a contractor has in front of them but does not hold: the only case where
   * the page must ask the server whether it is readable. `null` for everyone else.
   */
  private readonly contractorProbeUid: Signal<string | null> = computed(() => {
    if (!this.roleGrants.loaded() || !this.roleGrants.isContractor() || this.selectedHeld() || this.selectedClaOnly()) {
      return null;
    }
    return this.accountContext.selectedAccount().uid || null;
  });

  /** The read gate's answer for `contractorProbeUid`; `admitted` is `undefined` until it lands. */
  private readonly contractorProbe: Signal<OrgLensContractorProbe | null> = toSignal(
    toObservable(this.contractorProbeUid).pipe(
      distinctUntilChanged(),
      switchMap((uid) =>
        uid
          ? concat(of<OrgLensContractorProbe>({ uid, admitted: undefined }), this.roleGrants.readCheck(uid).pipe(map((admitted) => ({ uid, admitted }))))
          : of(null)
      )
    ),
    { initialValue: null }
  );

  /** The probe is owed an answer for the current organization and has not given it. */
  private readonly contractorProbePending: Signal<boolean> = computed(() => {
    const uid = this.contractorProbeUid();
    const probe = this.contractorProbe();
    return uid !== null && !(probe?.uid === uid && probe.admitted !== undefined);
  });

  /**
   * #4314 — the employer probe is owed an answer *that the page decision will read*. Only the callers
   * who reach rules 6–8 do: someone who holds the selection, reaches it as its CLA manager, or whom the
   * read gate admitted renders their page at rules 1 and 5, and no employer answer can change that.
   * Waiting on the probe for them would hold an already-admitted contractor on a skeleton while CDP
   * and Snowflake run, for an answer that is then discarded.
   */
  private readonly employerAnswerOwed: Signal<boolean> = computed(() => {
    if (!this.employerAffiliation.pending()) {
      return false;
    }
    if (this.selectedHeld() || this.selectedClaOnly()) {
      return false;
    }
    return this.contractorVerdict(this.accountContext.hasOrgSelectorAccess()) !== 'admitted';
  });

  /** Both one-shot bootstrap loads have answered (and a contractor's read check, when one is owed); before this, pages render a skeleton, never a state. */
  public readonly settled: Signal<boolean> = computed(
    () => this.roleGrants.loaded() && this.persona.personaLoaded() && !this.contractorProbePending() && !this.employerAnswerOwed()
  );

  /**
   * The page can leave its skeleton: `settled`, and the caller's org list has loaded when they have one.
   * A caller with no switcher access never starts that list (an admitted contractor with no roster row
   * or persona seed, #2961), so waiting on it would hold them on the skeleton forever. Used by the pages
   * that wait for the default selection from that list (overview, projects, ROI and its project detail,
   * meetings, groups, EasyCLA) and by `/org/not-found`; the other Org pages never waited for the list and gate on `settled`.
   */
  public readonly pageReady: Signal<boolean> = computed(() => this.settled() && (!this.accountContext.hasOrgSelectorAccess() || this.orgNavigation.loaded()));

  /** The selected organization is in the caller's resolved set (direct, inherited, or company-wide team entitlement). */
  public readonly selectedHeld: Signal<boolean> = computed(() => {
    if (this.roleGrants.isStaff()) {
      return true;
    }
    const uid = this.accountContext.selectedAccount().uid;
    if (!uid) {
      return false;
    }
    return (
      this.roleGrants.writerSet().has(uid) ||
      this.roleGrants.auditorSet().has(uid) ||
      this.roleGrants.inheritedWriterSet().has(uid) ||
      this.roleGrants.inheritedAuditorSet().has(uid)
    );
  });

  /**
   * M3 — the selected organization is reached as its CLA Manager. The lens-wide read gate (and so the
   * contractor probe) refuses it by design; the CLA routes admit it, and `orgClaOnlyPageGuard` keeps
   * every other page of it on EasyCLA, so the page renders.
   */
  private readonly selectedClaOnly: Signal<boolean> = computed(() => this.claOnlyAccess.isClaOnly(this.accountContext.selectedAccount().uid));

  /** FR-010 — the list is a lower bound but the page still renders: show the switcher notice, not a page state. */
  public readonly listIncomplete: Signal<boolean> = computed(() => this.settled() && this.roleGrants.lookupOutcome() === 'partial' && this.selectedHeld());

  /** The page-level state to render, or `null` when the page itself should render. */
  public readonly pageState: Signal<OrgLensEmptyStateName | null> = computed(() => {
    if (!this.settled()) {
      return null;
    }
    if (this.selectedHeld() || this.selectedClaOnly()) {
      return null;
    }
    const holdsAnything = this.accountContext.hasOrgSelectorAccess();
    const blocker = this.classifyLookup(holdsAnything);
    if (blocker) {
      return blocker;
    }
    const contractor = this.contractorVerdict(holdsAnything);
    if (contractor === 'refused') {
      return 'contractor-no-grant';
    }
    // The read gate admitted the organization in front of them (an FGA-only reader such as a key-contact
    // auditor may have no roster row or persona seed): its answer wins over the roster-based rule 6.
    if (contractor === 'admitted') {
      return null;
    }
    if (!holdsAnything) {
      if (this.employerAffiliation.affiliatedToNonMember()) {
        return 'affiliated-non-member';
      }
      if (this.employerAffiliation.lookupFailed()) {
        return 'could-not-load';
      }
      return 'no-organization';
    }
    return null;
  });

  /**
   * #4314 — the employer name `affiliated-non-member` interpolates, for pages to pass straight into the
   * empty state's `values`. `null` for every other state, so a page can bind it unconditionally.
   */
  public readonly employerName: Signal<string | null> = computed(() =>
    this.pageState() === 'affiliated-non-member' ? this.employerAffiliation.employerName() : null
  );

  /** Convenience for templates that only need "is a page-level state replacing the page". */
  public readonly hasPageState: Signal<boolean> = computed(() => this.pageState() !== null);

  /**
   * The shared Retry is in flight — bind to the state's `retrying` so the control cannot be re-fired.
   * Covers both phases of `retry()`: the role-grants refresh and the org-list refresh it chains — but
   * only the list refresh Retry itself started, since `orgNavigation.loading()` also covers switcher
   * search and pagination.
   */
  public readonly retrying: Signal<boolean> = computed(() => {
    if (this.roleGrants.loading()) {
      return true;
    }
    const retryGeneration = this.retryGeneration();
    // Busy only while Retry's own first page is the active fetch and has not landed: a later search
    // or reset moves the generation on, and scrolling after it landed reuses the generation but not
    // the first page.
    return retryGeneration !== null && retryGeneration === this.orgNavigation.generation() && this.orgNavigation.firstPageLandedGeneration() < retryGeneration;
  });

  /**
   * FR-016 rules 2–4 — the outage head every page-level decision shares. `holdsAnything` is the
   * caller's evidence of holding *something* (the page: switcher access; the dead end: its grant sets
   * or list rows, unfiltered), which is what turns a partial roster from "the switcher's notice" into
   * an outage.
   * Reads signals, so it is reactive inside a `computed`.
   *
   * Rule 2 is deliberately unguarded by `holdsAnything`: with the roster never loaded, `selectedHeld`
   * cannot be true and the server read gate answers 503 `ROLE_GRANTS_UNAVAILABLE` to every section
   * anyway — one page-level outage with Retry is the honest render, not six section-level copies of
   * it. `holdsAnything` (persona-seeded accounts) is not evidence of a grant, so it cannot admit the page.
   */
  public classifyLookup(holdsAnything: boolean): OrgLensLookupBlocker | null {
    const outcome = this.roleGrants.lookupOutcome();
    // M3 — a failed `cla-manager` scopes read leaves a caller with no grant unclassified, like a partial roster.
    const lowerBound = outcome === 'partial' || this.claOnlyAccess.lookupFailed();
    if (outcome === 'failed' || (lowerBound && !holdsAnything)) {
      return 'could-not-load';
    }
    if (this.roleGrants.staffCheck() === 'failed') {
      return 'staff-check-failed';
    }
    return null;
  }

  /**
   * Retry action of `could-not-load` / `staff-check-failed` (page, dead end, switcher notice): re-ask
   * the caller's employer affiliation (#4314), re-run the role-grants lookup past the BFF cache and, once it answers, re-fetch the org list from its
   * first page when one was fetched or is being fetched — the list is filtered server-side by the same
   * lookup, so refreshing only one of the two would leave the other stale, and a Retry pressed while
   * the first list fetch is still in flight must not skip it. The list refresh carries no bootstrap
   * semantics (`refreshList`, not `resetAndReload`): it can never clear or re-point the selection. A
   * list never requested is left to the switcher's own enabled-transition bootstrap.
   */
  public retry(): void {
    // #4314 — the employer probe is the other half of what rule 6/7 read, and it has its own failure.
    this.employerAffiliation.refresh();
    this.roleGrants
      .refresh(true)
      .pipe(take(1))
      .subscribe(() => {
        if (this.orgNavigation.loaded() || this.orgNavigation.loading()) {
          this.retryGeneration.set(this.orgNavigation.refreshList(this.accountContext.selectedAccount().uid || this.accountContext.getStoredUid()));
        }
      });
  }

  /**
   * #2961 — the server's verdict for an LF contractor: `refused` when the selected organization failed
   * the read gate, or nothing is selected and they hold nothing; `admitted` when the gate let the selected
   * organization through; `null` when there is no verdict (not a contractor, or an answer still owed —
   * `settled` covers that). The probe answer counts only for the organization it was asked about.
   */
  private contractorVerdict(holdsAnything: boolean): OrgLensContractorVerdict | null {
    if (!this.roleGrants.isContractor()) {
      return null;
    }
    const uid = this.contractorProbeUid();
    if (!uid) {
      return holdsAnything ? null : 'refused';
    }
    const probe = this.contractorProbe();
    if (probe?.uid !== uid || probe.admitted === undefined) {
      return null;
    }
    return probe.admitted ? 'admitted' : 'refused';
  }
}
