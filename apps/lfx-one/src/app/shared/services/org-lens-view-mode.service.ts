// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ORG_LENS_EMPLOYEE_VIEW, ORG_LENS_FULL_VIEW } from '@lfx-one/shared/constants';
import type { OrgLensViewMode } from '@lfx-one/shared/interfaces';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const NO_ORGS: ReadonlySet<string> = new Set();

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

  private readonly addressedEmployeeViewUids: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(NO_ORGS);

  /** Companies the caller reaches only through the all employee view: the role-grants company plus any the resolver marked. */
  public readonly employeeViewOrgUids: Signal<ReadonlySet<string>> = computed(() => {
    const granted = this.roleGrants.employeeViewOrgUid();
    const addressed = this.addressedEmployeeViewUids();
    return granted ? new Set([granted, ...addressed]) : addressed;
  });

  /** The view mode of the selected company. */
  public readonly viewMode: Signal<OrgLensViewMode> = computed(() => this.modeFor(this.accountContext.selectedAccount().uid));

  public readonly isEmployeeView: Signal<boolean> = computed(() => this.viewMode() === ORG_LENS_EMPLOYEE_VIEW);

  /** The view mode for `uid`, for a caller that is not asking about the selection (a selector row, an address being adopted). */
  public modeFor(uid: string | null | undefined): OrgLensViewMode {
    if (!uid || !this.employeeViewOrgUids().has(uid) || this.holdsGrant(uid)) {
      return ORG_LENS_FULL_VIEW;
    }
    return ORG_LENS_EMPLOYEE_VIEW;
  }

  /** Records the resolver's answer for an addressed company; a later non-employee answer clears it. */
  public noteAddressed(uid: string, employeeView: boolean): void {
    const current = this.addressedEmployeeViewUids();
    if (current.has(uid) === employeeView) return;
    const next = new Set(current);
    if (employeeView) {
      next.add(uid);
    } else {
      next.delete(uid);
    }
    this.addressedEmployeeViewUids.set(next);
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
