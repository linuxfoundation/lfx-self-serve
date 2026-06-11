// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, firstValueFrom, map, of, skip, Subject, switchMap, takeUntil, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE, votingStatusPillClass } from '@lfx-one/shared/constants';
import type {
  CommitteeMemberAssignmentVm,
  CommitteeMemberPersonGroup,
  CommitteeMemberPersonGroupVm,
  CommitteeMembersSortColumn,
  CommitteeMembersSortDirection,
  EditCommitteeRoleDialogData,
  EditCommitteeRoleSubmitEvent,
  OrgDropdownOption,
  OrgPeopleCommitteeMembersResponse,
  ReassignCommitteeRolesDialogData,
  ReassignCommitteeRolesRoleOption,
  ReassignCommitteeRolesSubmitEvent,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { CommitteeMembersService } from '../../services/committee-members.service';
import { EditCommitteeRoleModalComponent } from './components/edit-committee-role-modal.component';
import { ReassignCommitteeRolesModalComponent } from './components/reassign-committee-roles-modal.component';
import { buildPersonGroups, decoratePersonGroup } from './helpers/committee-members.helper';

/** Org Lens — People → Committee tab (spec 027). Org-wide, non-Board committee-member roster grouped by person, with filter/sort/expand (US1+US2). Reassign/Edit modals wired in US3/US4. */
@Component({
  selector: 'lfx-org-people-committee-members',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule, InputTextComponent, SelectComponent, SkeletonModule, EmptyStateComponent, ToastModule, TooltipModule],
  providers: [MessageService, DialogService],
  templateUrl: './committee-members.component.html',
})
export class CommitteeMembersComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(CommitteeMembersService);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ['Individuals', 'Committees', 'Foundations with committee members'];
  protected readonly editDisabledTooltip = 'Only admins can edit. To view a list of admins, visit the Access page.';

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    committee: new FormControl<string>('', { nonNullable: true }),
  });

  // WritableSignals first (grouped per component-organization convention).
  protected readonly sortColumn = signal<CommitteeMembersSortColumn>('name');
  protected readonly sortDirection = signal<CommitteeMembersSortDirection>(1);
  protected readonly expansion = signal<Record<string, boolean>>({});
  protected readonly retryTrigger = signal<number>(0);
  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);

  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  // Mirror the reactive form into a signal so computeds re-run on input (FormGroup.value is not a signal).
  private readonly filterValues = toSignal(this.filterForm.valueChanges.pipe(debounceTime(150)), {
    initialValue: this.filterForm.getRawValue(),
  });

  // Scoped on the org account id (SFID); gated on `!!uid` so the skeleton holds until the org-selector populates it.
  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgPeopleCommitteeMembersResponse> = this.initResponse();

  protected readonly stats = computed(() => this.response().stats);

  protected readonly groupedPeople: Signal<CommitteeMemberPersonGroup[]> = computed(() => buildPersonGroups(this.response().assignments));
  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly committeeOptions: Signal<OrgDropdownOption[]> = computed(() => this.initCommitteeOptions());
  protected readonly filteredGroups: Signal<CommitteeMemberPersonGroup[]> = computed(() => this.initFilteredGroups());
  protected readonly sortedGroups: Signal<CommitteeMemberPersonGroup[]> = computed(() => this.initSortedGroups());
  protected readonly decoratedGroups: Signal<CommitteeMemberPersonGroupVm[]> = computed(() => this.initDecoratedGroups());

  protected readonly isFiltering = computed(() => this.initIsFiltering());

  // Writer-FGA gate (UX); BFF + Heimdall still re-enforce on write.
  protected readonly canEdit = computed(() => this.initCanEdit());

  protected readonly ariaSortMap = computed(() => this.initAriaSortMap());
  protected readonly sortIconMap = computed(() => this.initSortIconMap());

  // Cancels in-flight reads + (US3/US4) closes any open dialog when the user switches account mid-flight.
  private readonly accountCancel$ = new Subject<void>();

  public constructor() {
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.accountCancel$.next();
      this.resetAllState();
    });

    // Cascade reset (FR-006): when the foundation filter changes, clear any committee selection so a
    // stale committee value (no longer in the narrowed options) can't render a blank <p-select> + a
    // misleading "no matches" empty state.
    this.filterForm.controls.foundation.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe(() => {
      if (this.filterForm.controls.committee.value) {
        this.filterForm.controls.committee.setValue('');
      }
    });
  }

  protected onSort(column: CommitteeMembersSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // Numeric columns default to descending (most-active first); the name column to ascending.
    this.sortDirection.set(column === 'name' ? 1 : -1);
  }

  protected toggleExpansion(email: string): void {
    this.expansion.update((state) => {
      const next = { ...state };
      if (next[email]) delete next[email];
      else next[email] = true;
      return next;
    });
  }

  protected onRowKeydown(event: KeyboardEvent, email: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleExpansion(email);
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  // Main-row Reassign pencil (US3) — opens the bulk modal scoped to one person's Membership-Entitlement seats.
  protected onMainPencilClick(group: CommitteeMemberPersonGroupVm, event: Event): void {
    event.stopPropagation();
    if (!this.canEdit() || group.editableCount === 0) return;
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (!orgUid) return;

    const roles: ReassignCommitteeRolesRoleOption[] = group.assignments
      .filter((a) => a.isOrgEditable)
      .map((a) => ({
        key: a.memberUid,
        memberUid: a.memberUid,
        committeeUid: a.committeeUid,
        committeeName: a.committeeName,
        foundationName: a.foundationName,
        votingStatus: a.votingStatus,
        votingStatusPillClass: votingStatusPillClass(a.votingStatus),
      }));
    if (roles.length === 0) return;

    const ref = this.dialogService.open(ReassignCommitteeRolesModalComponent, {
      width: '600px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        person: { fullName: group.displayName, email: group.email, initials: group.initials },
        roles,
        orgUid,
        submit: (intent) => this.performBulkReassign(intent, orgUid),
      } satisfies ReassignCommitteeRolesDialogData,
    }) as DynamicDialogRef;

    this.wireDialogToAccountChange(ref);
  }

  // Sub-row Edit pencil (US4) — opens the single-seat modal scoped to one Membership-Entitlement seat.
  protected onSubRowPencilClick(assignment: CommitteeMemberAssignmentVm, event: Event): void {
    event.stopPropagation();
    if (!this.canEdit() || !assignment.isOrgEditable) return;
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (!orgUid) return;

    const ref = this.dialogService.open(EditCommitteeRoleModalComponent, {
      width: '560px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        assignment,
        orgUid,
        submit: (intent) => this.performSingleReassign(intent, orgUid),
      } satisfies EditCommitteeRoleDialogData,
    }) as DynamicDialogRef;

    this.wireDialogToAccountChange(ref);
  }

  // Fan out one PUT per selected seat; refresh after. Full failure throws (modal stays open with the
  // inline error). Partial success RESOLVES (modal closes) and a warning toast summarizes the result —
  // succeeded seats already moved upstream, so leaving the modal open with stale `selectedKeys` would
  // re-PATCH already-succeeded `memberUid`s and 404 them (the original seat no longer exists). The
  // follow-up "retry just the failures" UX requires a per-role-result contract on `submit`, which is
  // out of scope for this round (tracked separately).
  private async performBulkReassign(intent: ReassignCommitteeRolesSubmitEvent, orgUid: string): Promise<void> {
    const ops = intent.selected.map((role) =>
      firstValueFrom(
        this.dataService.reassignSeat(orgUid, role.memberUid, {
          committeeUid: role.committeeUid,
          firstName: intent.newPerson.firstName,
          lastName: intent.newPerson.lastName,
          email: intent.newPerson.email,
        })
      )
    );

    const results = await Promise.allSettled(ops);
    this.retry();

    const total = intent.selected.length;
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length === 0) {
      this.messageService.add({
        key: 'org-people-committee-toast-success',
        severity: 'success',
        summary: 'Committee roles reassigned',
        detail: `${total} ${total === 1 ? 'role was' : 'roles were'} reassigned.`,
        life: 3000,
      });
      return;
    }

    const succeeded = total - failures.length;
    if (succeeded === 0) {
      throw new Error(this.cleanErrorMessage(failures[0].reason));
    }
    this.messageService.add({
      key: 'org-people-committee-toast-success',
      severity: 'warn',
      summary: 'Some reassignments did not succeed',
      detail: `${succeeded} of ${total} succeeded. Reopen this dialog to retry the remaining ${total - succeeded}.`,
      life: 6000,
    });
  }

  // Single PUT; refresh after; re-throw the cleaned message so the modal can surface an inline retry.
  private async performSingleReassign(intent: EditCommitteeRoleSubmitEvent, orgUid: string): Promise<void> {
    try {
      await firstValueFrom(
        this.dataService.reassignSeat(orgUid, intent.memberUid, {
          committeeUid: intent.committeeUid,
          firstName: intent.newPerson.firstName,
          lastName: intent.newPerson.lastName,
          email: intent.newPerson.email,
        })
      );
    } catch (err) {
      throw new Error(this.cleanErrorMessage(err));
    }
    this.messageService.add({
      key: 'org-people-committee-toast-success',
      severity: 'success',
      summary: 'Committee role updated',
      life: 3000,
    });
    this.retry();
  }

  // Closes the dialog if the user switches account before confirming — prevents cross-org writes.
  private wireDialogToAccountChange(ref: DynamicDialogRef): void {
    this.accountCancel$.pipe(takeUntil(ref.onClose), takeUntilDestroyed(this.destroyRef)).subscribe(() => ref.close(null));
  }

  private cleanErrorMessage(err: unknown): string {
    // The BFF returns either `{ error: { message } }` (validation) or `{ error: string }`
    // (MicroserviceError/BaseApiError) — tolerate both so the server detail survives to the toast.
    const inner = (err as { error?: { error?: unknown } })?.error?.error;
    if (typeof inner === 'string' && inner.trim()) {
      return inner;
    }
    if (inner && typeof inner === 'object' && typeof (inner as { message?: unknown }).message === 'string' && (inner as { message: string }).message.trim()) {
      return (inner as { message: string }).message;
    }
    return 'Could not save changes. Please try again.';
  }

  private initResponse(): Signal<OrgPeopleCommitteeMembersResponse> {
    return toSignal(
      combineLatest([this.orgUid$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid]) => {
          if (!orgUid) {
            // Hold the skeleton until the org selector populates a uid — flipping loadingState to false here
            // would briefly render the empty state on mount before account-context emits the real uid.
            return of(EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE);
          }
          return this.dataService.getCommitteeMembers(orgUid).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of(EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE);
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE }
    );
  }

  private initFoundationOptions(): OrgDropdownOption[] {
    const labels = [
      ...new Set(
        this.response()
          .assignments.map((a) => a.foundationName)
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    return [{ label: 'All Foundations', value: '' }, ...labels.map((l) => ({ label: l, value: l }))];
  }

  private initCommitteeOptions(): OrgDropdownOption[] {
    const foundation = this.filterValues().foundation ?? '';
    const scoped = foundation ? this.response().assignments.filter((a) => a.foundationName === foundation) : this.response().assignments;
    const labels = [...new Set(scoped.map((a) => a.committeeName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return [{ label: 'All Committees', value: '' }, ...labels.map((l) => ({ label: l, value: l }))];
  }

  private initIsFiltering(): boolean {
    const v = this.filterValues();
    return (v.search ?? '').trim().length > 0 || !!(v.foundation ?? '') || !!(v.committee ?? '');
  }

  private initFilteredGroups(): CommitteeMemberPersonGroup[] {
    const v = this.filterValues();
    const q = (v.search ?? '').trim().toLowerCase();
    const foundation = v.foundation ?? '';
    const committee = v.committee ?? '';

    return this.groupedPeople().filter((group) => {
      if (foundation && !group.assignments.some((a) => a.foundationName === foundation)) return false;
      if (committee && !group.assignments.some((a) => a.committeeName === committee)) return false;
      if (q && !this.groupSearchText(group).includes(q)) return false;
      return true;
    });
  }

  /** FR-005: case-insensitive search over name, job title, email, foundation, committee, role, voting, appointed-by. */
  private groupSearchText(group: CommitteeMemberPersonGroup): string {
    const parts: (string | null | undefined)[] = [group.displayName, group.jobTitle, group.email];
    for (const a of group.assignments) {
      parts.push(a.foundationName, a.committeeName, a.role, a.votingStatus, a.appointedBy);
    }
    return parts
      .filter((p): p is string => Boolean(p))
      .join(' ')
      .toLowerCase();
  }

  private initSortedGroups(): CommitteeMemberPersonGroup[] {
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...this.filteredGroups()];
    copy.sort((a, b) => {
      if (col === 'foundations') {
        const cmp = (a.foundationLabels.length - b.foundationLabels.length) * dir;
        return cmp !== 0 ? cmp : a.displayName.localeCompare(b.displayName);
      }
      if (col === 'committees') {
        const cmp = (a.committeeCount - b.committeeCount) * dir;
        return cmp !== 0 ? cmp : a.displayName.localeCompare(b.displayName);
      }
      return a.displayName.localeCompare(b.displayName) * dir;
    });
    return copy;
  }

  private initDecoratedGroups(): CommitteeMemberPersonGroupVm[] {
    const opts = { canEdit: this.canEdit(), editDisabledTooltip: this.editDisabledTooltip };
    return this.sortedGroups().map((g) => decoratePersonGroup(g, opts));
  }

  private initCanEdit(): boolean {
    const uid = this.accountContext.selectedAccount()?.uid;
    if (!uid) return false;
    return this.roleGrants.writerSet().has(uid);
  }

  private initAriaSortMap(): Record<CommitteeMembersSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      foundations: active === 'foundations' ? direction : 'none',
      committees: active === 'committees' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<CommitteeMembersSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: CommitteeMembersSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      foundations: iconFor('foundations'),
      committees: iconFor('committees'),
    };
  }

  private resetAllState(): void {
    this.filterForm.reset({ search: '', foundation: '', committee: '' });
    this.sortColumn.set('name');
    this.sortDirection.set(1);
    this.expansion.set({});
  }
}
