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
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import {
  EMPTY_ORG_PEOPLE_BOARD_MEMBERS_RESPONSE,
  isVotingStatus,
  ORG_PEOPLE_BOARD_SOURCE_CAPTION,
  ORG_PEOPLE_BOARD_STAT_LABELS,
  ORG_PEOPLE_BOARD_STATUS_OPTIONS,
  votingStatusPillClass,
} from '@lfx-one/shared/constants';
import type {
  BoardMemberPersonGroup,
  BoardMemberPersonGroupVm,
  BoardMembersSortColumn,
  BoardMembersSortDirection,
  CommitteeMemberAssignmentVm,
  EditCommitteeRoleDialogData,
  EditCommitteeRoleSubmitEvent,
  OrgDropdownOption,
  OrgPeopleBoardMembersResponse,
  ReassignCommitteeRolesDialogData,
  ReassignCommitteeRolesRoleOption,
  ReassignCommitteeRolesSubmitEvent,
  WhyCantEditBoardDialogData,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { toDrawerGovernanceSeats } from '../../helpers/governance-seats.helper';
import { BoardMembersService } from '../../services/board-members.service';
import { EditBoardRoleModalComponent } from './components/edit-board-role-modal.component';
import { ReassignBoardRolesModalComponent } from './components/reassign-board-roles-modal.component';
import { WhyCantEditBoardModalComponent } from './components/why-cant-edit-board-modal.component';
import { buildBoardPersonGroups, decorateBoardPersonGroup } from './helpers/board-members.helper';

/** Org Lens — People → Board tab. Org-wide, Board-only roster grouped by person, with filter/sort/expand and Reassign/Edit modals. Inverted-filter sibling of the Committee tab. */
@Component({
  selector: 'lfx-org-people-board-members',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule, InputTextComponent, SelectComponent, SkeletonModule, EmptyStateComponent, ToastModule, TooltipModule],
  providers: [MessageService, DialogService],
  templateUrl: './board-members.component.html',
})
export class BoardMembersComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(BoardMembersService);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawer = inject(PersonDetailDrawerService);

  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ORG_PEOPLE_BOARD_STAT_LABELS;
  protected readonly statusOptions: OrgDropdownOption[] = [...ORG_PEOPLE_BOARD_STATUS_OPTIONS];
  protected readonly sourceCaption = ORG_PEOPLE_BOARD_SOURCE_CAPTION;
  protected readonly votingStatusPillClass = votingStatusPillClass;
  protected readonly editDisabledTooltip = 'Only admins can edit. To view a list of admins, visit the Access page.';

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    status: new FormControl<string>('', { nonNullable: true }),
  });

  protected readonly sortColumn = signal<BoardMembersSortColumn>('name');
  protected readonly sortDirection = signal<BoardMembersSortDirection>(1);
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

  protected readonly response: Signal<OrgPeopleBoardMembersResponse> = this.initResponse();

  protected readonly stats = computed(() => this.response().stats);

  protected readonly groupedPeople: Signal<BoardMemberPersonGroup[]> = computed(() => buildBoardPersonGroups(this.response().assignments));
  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly filteredGroups: Signal<BoardMemberPersonGroup[]> = computed(() => this.initFilteredGroups());
  protected readonly sortedGroups: Signal<BoardMemberPersonGroup[]> = computed(() => this.initSortedGroups());
  protected readonly decoratedGroups: Signal<BoardMemberPersonGroupVm[]> = computed(() => this.initDecoratedGroups());

  protected readonly isFiltering = computed(() => this.initIsFiltering());

  // Writer-FGA gate (UX); BFF + Heimdall still re-enforce on write.
  protected readonly canEdit = computed(() => this.initCanEdit());

  protected readonly ariaSortMap = computed(() => this.initAriaSortMap());
  protected readonly sortIconMap = computed(() => this.initSortIconMap());

  // Cancels in-flight reads + closes any open dialog when the user switches account mid-flight.
  private readonly accountCancel$ = new Subject<void>();

  public constructor() {
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.accountCancel$.next();
      this.resetAllState();
    });
  }

  protected onSort(column: BoardMembersSortColumn): void {
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

  // Open the drawer on Governance from already-loaded seats (Board rows have no personKey).
  protected onPersonClick(group: BoardMemberPersonGroupVm, event: Event): void {
    event.stopPropagation();
    this.drawer.open({
      name: group.displayName,
      title: group.jobTitle,
      initials: group.initials,
      avatarColorClass: 'bg-purple-500',
      defaultTab: 'governance',
      governanceSeats: toDrawerGovernanceSeats(group.assignments),
    });
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  // Main-row Reassign pencil (US3) — opens the bulk modal scoped to one person's Membership-Entitlement board seats.
  protected onMainPencilClick(group: BoardMemberPersonGroupVm, event: Event): void {
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

    // `group.email` is the grouping key and falls back to a seat `memberUid` when the upstream email is
    // blank — never pass it as the contact email. Source the person's real email from the assignments.
    const currentEmail = group.assignments.find((a) => a.person.email)?.person.email ?? '';

    const ref = this.dialogService.open(ReassignBoardRolesModalComponent, {
      width: '600px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: {
        person: { fullName: group.displayName, email: currentEmail, initials: group.initials },
        roles,
        orgUid,
        submit: (intent) => this.performBulkReassign(intent, orgUid),
      } satisfies ReassignCommitteeRolesDialogData,
    }) as DynamicDialogRef;

    this.wireDialogToAccountChange(ref);
  }

  // Sub-row Edit pencil (US4) — opens the single-seat modal scoped to one Membership-Entitlement board seat.
  protected onSubRowPencilClick(assignment: CommitteeMemberAssignmentVm, event: Event): void {
    event.stopPropagation();
    if (!this.canEdit() || !assignment.isOrgEditable) return;
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (!orgUid) return;

    const ref = this.dialogService.open(EditBoardRoleModalComponent, {
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

  // "Why can't I edit?" affordance (FR-009/FR-012) — opens an explanatory modal; buttons close-only for now.
  protected onWhyCantEdit(reason: string, event: Event): void {
    event.stopPropagation();
    const ref = this.dialogService.open(WhyCantEditBoardModalComponent, {
      width: '440px',
      modal: true,
      closable: true,
      dismissableMask: true,
      showHeader: false,
      data: { reason } satisfies WhyCantEditBoardDialogData,
    }) as DynamicDialogRef;

    this.wireDialogToAccountChange(ref);
  }

  // Fan out one PUT per seat, then refresh: full failure throws (modal stays open with the inline error);
  // partial success resolves with a warning toast (re-PATCHing succeeded seats would 404 on a gone seat).
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
        key: 'org-people-board-toast-success',
        severity: 'success',
        summary: 'Board roles reassigned',
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
      key: 'org-people-board-toast-success',
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
      key: 'org-people-board-toast-success',
      severity: 'success',
      summary: 'Board role updated',
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

  private initResponse(): Signal<OrgPeopleBoardMembersResponse> {
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
            return of(EMPTY_ORG_PEOPLE_BOARD_MEMBERS_RESPONSE);
          }
          return this.dataService.getBoardMembers(orgUid).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of(EMPTY_ORG_PEOPLE_BOARD_MEMBERS_RESPONSE);
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_PEOPLE_BOARD_MEMBERS_RESPONSE }
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

  private initIsFiltering(): boolean {
    const v = this.filterValues();
    return (v.search ?? '').trim().length > 0 || !!(v.foundation ?? '') || !!(v.status ?? '');
  }

  private initFilteredGroups(): BoardMemberPersonGroup[] {
    const v = this.filterValues();
    const q = (v.search ?? '').trim().toLowerCase();
    const foundation = v.foundation ?? '';
    const status = v.status ?? '';

    return this.groupedPeople().filter((group) => {
      if (foundation && !group.assignments.some((a) => a.foundationName === foundation)) return false;
      if (status === 'voting' && !group.assignments.some((a) => isVotingStatus(a.votingStatus))) return false;
      if (status === 'non-voting' && !group.assignments.some((a) => !isVotingStatus(a.votingStatus))) return false;
      if (q && !this.groupSearchText(group).includes(q)) return false;
      return true;
    });
  }

  /** FR-005: case-insensitive search over name, job title, email, foundation, board/committee, role, voting, appointed-by. */
  private groupSearchText(group: BoardMemberPersonGroup): string {
    const parts: (string | null | undefined)[] = [group.displayName, group.jobTitle, group.email];
    for (const a of group.assignments) {
      parts.push(a.foundationName, a.committeeName, a.role, a.votingStatus, a.appointedBy);
    }
    return parts
      .filter((p): p is string => Boolean(p))
      .join(' ')
      .toLowerCase();
  }

  private initSortedGroups(): BoardMemberPersonGroup[] {
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...this.filteredGroups()];
    copy.sort((a, b) => {
      if (col === 'foundations') {
        const cmp = (a.foundationLabels.length - b.foundationLabels.length) * dir;
        return cmp !== 0 ? cmp : a.displayName.localeCompare(b.displayName);
      }
      return a.displayName.localeCompare(b.displayName) * dir;
    });
    return copy;
  }

  private initDecoratedGroups(): BoardMemberPersonGroupVm[] {
    const opts = { canEdit: this.canEdit(), editDisabledTooltip: this.editDisabledTooltip };
    return this.sortedGroups().map((g) => decorateBoardPersonGroup(g, opts));
  }

  private initCanEdit(): boolean {
    const uid = this.accountContext.selectedAccount()?.uid;
    if (!uid) return false;
    return this.roleGrants.writerSet().has(uid);
  }

  private initAriaSortMap(): Record<BoardMembersSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      foundations: active === 'foundations' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<BoardMembersSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: BoardMembersSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      foundations: iconFor('foundations'),
    };
  }

  private resetAllState(): void {
    this.filterForm.reset({ search: '', foundation: '', status: '' });
    this.sortColumn.set('name');
    this.sortDirection.set(1);
    this.expansion.set({});
  }
}
