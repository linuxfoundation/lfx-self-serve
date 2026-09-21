// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';

import { AccountContextService } from './account-context.service';
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
 *   5. caller holds nothing                                     → `no-organization`
 *   6. otherwise (a selection is pending)                       → `null`
 *
 * Rule 1 before 2/3 is the #2216 blocking fix ("direct grants must not fail when only group expansion
 * fails") — a held-but-degraded caller keeps their page and the switcher shows the FR-010 notice
 * instead (DR-002). Rule 4 before 5 is the epic's never-fall-through rule (FR-011): a failed team check
 * must not read as the employee no-access copy.
 *
 * The addressed-but-unheld states (FR-007 / FR-008) are not decided here: `orgPathParamGuard` already
 * lands every unheld or unknown address on `/org/not-found`, which picks between them (research R6).
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensEmptyStateService {
  private readonly accountContext = inject(AccountContextService);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly persona = inject(PersonaService);

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
    const outcome = this.roleGrants.lookupOutcome();
    const holdsAnything = this.accountContext.hasOrgSelectorAccess();
    // Rule 2 is deliberately unguarded by `holdsAnything`: with the roster never loaded, `selectedHeld`
    // cannot be true and the server read gate answers 503 `ROLE_GRANTS_UNAVAILABLE` to every section
    // anyway — one page-level outage with Retry is the honest render, not six section-level copies of
    // it. `holdsAnything` (persona-seeded accounts) is not evidence of a grant, so it cannot admit the page.
    if (outcome === 'failed') {
      return 'could-not-load';
    }
    if (outcome === 'partial' && !holdsAnything) {
      return 'could-not-load';
    }
    if (this.roleGrants.staffCheck() === 'failed') {
      return 'staff-check-failed';
    }
    if (!holdsAnything) {
      return 'no-organization';
    }
    return null;
  });

  /** Convenience for templates that only need "is a page-level state replacing the page". */
  public readonly hasPageState: Signal<boolean> = computed(() => this.pageState() !== null);

  /** Re-run the lookup (Retry action of `could-not-load` / `staff-check-failed`). */
  public retry(): void {
    this.roleGrants.refresh().subscribe();
  }
}
