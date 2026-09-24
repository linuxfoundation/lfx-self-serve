// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateName, OrgLensLookupBlocker } from '@lfx-one/shared/interfaces';
import { concat, distinctUntilChanged, map, of, switchMap, take } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

/**
 * Spec 053 — the single page-level classifier for Org Lens empty states (FR-016 precedence).
 *
 * Mirrors the server gate (`org-lens-read-access.helper.ts`): a resolved entry is authoritative, and an
 * incomplete roll-up must not veto an organization that is present. So the order is
 *
 *   1. caller holds the selected organization (or is LF team)  → render the page (`null`)
 *   2. lookup failed outright (roster never loaded)             → `could-not-load`
 *   3. lookup partial AND caller holds nothing loaded           → `could-not-load`
 *   4. staff check failed                                       → `staff-check-failed`
 *   5. LF contractor refused what is in front of them           → `contractor-no-grant` (#2961)
 *   6. caller holds nothing                                     → `no-organization`
 *   7. otherwise (a selection is pending)                       → `null`
 *
 * Rule 5 keys on the server's answer, never the roster: with an organization selected (persona seed,
 * cookie) it asks the read gate (`OrgRoleGrantsService.readCheck`), which also admits FGA-only readers
 * such as key-contact auditors that no list shows, and an organization it admits renders the page even
 * when the roster lists nothing; with nothing selected it is "holds nothing".
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
    if (!this.roleGrants.loaded() || !this.roleGrants.isContractor() || this.selectedHeld()) {
      return null;
    }
    return this.accountContext.selectedAccount().uid || null;
  });

  /** The read gate's answer for `contractorProbeUid`; `admitted` is `undefined` until it lands. */
  private readonly contractorProbe: Signal<{ uid: string; admitted: boolean | undefined } | null> = toSignal(
    toObservable(this.contractorProbeUid).pipe(
      distinctUntilChanged(),
      switchMap((uid) =>
        uid ? concat(of({ uid, admitted: undefined }), this.roleGrants.readCheck(uid).pipe(map((admitted) => ({ uid, admitted })))) : of(null)
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

  /** Both one-shot bootstrap loads have answered (and a contractor's read check, when one is owed); before this, pages render a skeleton, never a state. */
  public readonly settled: Signal<boolean> = computed(() => this.roleGrants.loaded() && this.persona.personaLoaded() && !this.contractorProbePending());

  /** The selected organization is in the caller's resolved set (direct, inherited, or LF-team entitlement). */
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

  /** FR-010 — the list is a lower bound but the page still renders: show the switcher notice, not a page state. */
  public readonly listIncomplete: Signal<boolean> = computed(() => this.settled() && this.roleGrants.lookupOutcome() === 'partial' && this.selectedHeld());

  /** The page-level state to render, or `null` when the page itself should render. */
  public readonly pageState: Signal<OrgLensEmptyStateName | null> = computed(() => {
    if (!this.settled()) {
      return null;
    }
    if (this.selectedHeld()) {
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
      return 'no-organization';
    }
    return null;
  });

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
    if (outcome === 'failed' || (outcome === 'partial' && !holdsAnything)) {
      return 'could-not-load';
    }
    if (this.roleGrants.staffCheck() === 'failed') {
      return 'staff-check-failed';
    }
    return null;
  }

  /**
   * Retry action of `could-not-load` / `staff-check-failed` (page, dead end, switcher notice): re-run
   * the role-grants lookup past the BFF cache and, once it answers, re-fetch the org list from its
   * first page when one was fetched or is being fetched — the list is filtered server-side by the same
   * lookup, so refreshing only one of the two would leave the other stale, and a Retry pressed while
   * the first list fetch is still in flight must not skip it. The list refresh carries no bootstrap
   * semantics (`refreshList`, not `resetAndReload`): it can never clear or re-point the selection. A
   * list never requested is left to the switcher's own enabled-transition bootstrap.
   */
  public retry(): void {
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
  private contractorVerdict(holdsAnything: boolean): 'refused' | 'admitted' | null {
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
