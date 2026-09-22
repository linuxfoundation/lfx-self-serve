// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateName, OrgLensLookupBlocker } from '@lfx-one/shared/interfaces';

import { AccountContextService } from './account-context.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';
import { filter, skipWhile, take } from 'rxjs';

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
 *   5. caller holds nothing                                     → `no-organization`
 *   6. otherwise (a selection is pending)                       → `null`
 *
 * Rule 1 before 2/3 is the #2216 blocking fix ("direct grants must not fail when only group expansion
 * fails") — a held-but-degraded caller keeps their page and the switcher shows the FR-010 notice
 * instead (DR-002). Rule 4 before 5 is the epic's never-fall-through rule (FR-011): a failed team check
 * must not read as the employee no-access copy.
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

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Phase 2 of `retry()` is in flight. `orgNavigation.loading` is one flag for every list fetch —
   * bootstrap, switcher search, next page — so on its own it would mark Retry busy while the viewer
   * merely types in the switcher; this narrows it to the list refresh Retry itself started. Cleared by
   * an explicit per-retry subscription (see `retry()`), not by an effect writing back into a signal.
   *
   * Deliberate edge: if a switcher search supersedes Retry's own list fetch, `orgNavigation.loading`
   * stays true until the search settles, so Retry reads busy for that search too. It self-heals when
   * the search answers; pinning the marker to a fetch generation would need `OrgNavigationService` to
   * expose one, which is not worth widening its API for a transient disabled button.
   */
  private readonly listRetryInFlight = signal(false);

  /** List loading as a stream, created in the injection context so `retry()` can await its settling. */
  private readonly listLoading$ = toObservable(this.orgNavigation.loading);

  /** Both one-shot bootstrap loads have answered; before this, pages render a skeleton, never a state. */
  public readonly settled: Signal<boolean> = computed(() => this.roleGrants.loaded() && this.persona.personaLoaded());

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
  public readonly retrying: Signal<boolean> = computed(() => this.roleGrants.loading() || (this.listRetryInFlight() && this.orgNavigation.loading()));

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
    this.roleGrants.refresh(true).subscribe(() => {
      if (this.orgNavigation.loaded() || this.orgNavigation.loading()) {
        this.listRetryInFlight.set(true);
        this.orgNavigation.refreshList(this.accountContext.selectedAccount().uid || this.accountContext.getStoredUid());
        // Clear the marker once this refresh has been seen loading and then settled.
        this.listLoading$
          .pipe(
            skipWhile((loading) => !loading),
            // filter + take(1), not first(): first() throws EmptyError if teardown completes the source
            // before the refresh settles; take(1) just completes.
            filter((loading) => !loading),
            take(1),
            takeUntilDestroyed(this.destroyRef)
          )
          .subscribe(() => this.listRetryInFlight.set(false));
      }
    });
  }
}
