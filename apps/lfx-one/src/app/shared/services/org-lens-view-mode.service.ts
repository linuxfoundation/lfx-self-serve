// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { ORG_LENS_EMPLOYEE_VIEW, ORG_LENS_FULL_VIEW } from '@lfx-one/shared/constants';
import type { OrgLensViewMode } from '@lfx-one/shared/interfaces';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

/**
 * The Company Lens view mode (epic #5845) for the selected company: `'employee'` for the reduced, read-only all employee
 * view, `'full'` for everyone else. Nav items, route guards and components ask it here; it is UX only — the server
 * redacts and refuses regardless (`blockEmployeeView`, `stripPersonalFields`).
 *
 * `'employee'` only when the selected company is one the server said the caller reaches that way (the role-grants
 * `employeeView` company, or an address the resolver marked `employeeView`) AND the caller holds a real grant on it
 * nowhere in the sets the server computed, and is not LF staff. A grant therefore always wins, mirroring the gate's
 * "existing paths first" order, and the roll-up is never an employee view.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensViewModeService {
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly accountContext = inject(AccountContextService);

  /** Companies the caller reaches only through the all employee view: the role-grants company plus any an address or selector row marked. */
  public readonly employeeViewOrgUids: Signal<ReadonlySet<string>> = this.roleGrants.employeeViewOrgUids;

  /** Companies the caller reads at full width through the authorizer alone (never in a grant set). */
  public readonly fullAccessOrgUids: Signal<ReadonlySet<string>> = this.roleGrants.fullAccessOrgUids;

  /** The selected company is one the caller reads in full through the authorizer alone, so the page renders. */
  public readonly isFullAccessReader: Signal<boolean> = computed(() => this.fullAccessOrgUids().has(this.accountContext.selectedAccount().uid ?? ''));

  /** The view mode of the selected company. */
  public readonly viewMode: Signal<OrgLensViewMode> = computed(() => this.modeFor(this.accountContext.selectedAccount().uid));

  public readonly isEmployeeView: Signal<boolean> = computed(() => this.viewMode() === ORG_LENS_EMPLOYEE_VIEW);

  /** The view mode for `uid`, for a caller that is not asking about the selection (a selector row, an address being adopted). */
  public modeFor(uid: string | null | undefined): OrgLensViewMode {
    if (!uid || !this.employeeViewOrgUids().has(uid) || this.holdsGrant(uid) || this.fullAccessOrgUids().has(uid)) {
      return ORG_LENS_FULL_VIEW;
    }
    return ORG_LENS_EMPLOYEE_VIEW;
  }

  /** Records the resolver's (or a selector row's) full-access answer for a company; a later non-full-access answer clears it. */
  public noteFullAccessAddressed(uid: string, fullAccess: boolean): void {
    this.roleGrants.noteFullAccessAddressed(uid, fullAccess);
  }

  /** Records the resolver's (or a selector row's) answer for a company; a later non-employee answer clears it. */
  public noteAddressed(uid: string, employeeView: boolean): void {
    this.roleGrants.noteEmployeeViewAddressed(uid, employeeView);
  }

  private holdsGrant(uid: string): boolean {
    return (
      this.roleGrants.isStaff() ||
      this.roleGrants.writerSet().has(uid) ||
      this.roleGrants.auditorSet().has(uid) ||
      this.roleGrants.inheritedWriterSet().has(uid) ||
      this.roleGrants.inheritedAuditorSet().has(uid)
    );
  }
}
