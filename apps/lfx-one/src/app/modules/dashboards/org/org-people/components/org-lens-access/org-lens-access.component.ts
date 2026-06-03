// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensAccessService } from '@services/org-lens-access.service';
import {
  EMPTY_ORG_ACCESS_LIST_RESPONSE,
  ORG_ACCESS_INITIAL_LIMIT,
  ORG_ACCESS_ROLE_BADGE_LABEL,
  ORG_ACCESS_ROLE_BADGE_TOOLTIP,
  ORG_ACCESS_TYPE_FILTER_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  OrgAccessFilter,
  OrgAccessInviteFormValue,
  OrgAccessListResponse,
  OrgAccessRole,
  OrgAccessSummary,
  OrgAccessTypeFilterOption,
  OrgAccessUser,
} from '@lfx-one/shared/interfaces';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, distinctUntilChanged, map, of, skip, switchMap, take, tap } from 'rxjs';

import { AddAccessUserModalComponent } from './add-access-user-modal/add-access-user-modal.component';
import { EditAccessRoleModalComponent } from './edit-access-role-modal/edit-access-role-modal.component';

/** File-local view model: wire row + per-row derivatives precomputed once so the template stays method-free. */
type OrgAccessRowVm = OrgAccessUser & {
  isLastAdmin: boolean;
  editDisabledBase: boolean;
  editTooltip: string;
  removeTooltip: string;
};

/** Org Lens Access tab — lists elevated-access principals with manager-only edit/remove; writes reflect from the authoritative refreshed list (spec 025). */
@Component({
  selector: 'lfx-org-lens-access',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    SelectModule,
    SkeletonModule,
    TooltipModule,
    ConfirmDialogModule,
    EmptyStateComponent,
    EditAccessRoleModalComponent,
    AddAccessUserModalComponent,
  ],
  templateUrl: './org-lens-access.component.html',
})
export class OrgLensAccessComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(OrgLensAccessService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly initialLimit = ORG_ACCESS_INITIAL_LIMIT;
  protected readonly typeFilterOptions: OrgAccessTypeFilterOption[] = [...ORG_ACCESS_TYPE_FILTER_OPTIONS];
  protected readonly roleBadgeLabel = ORG_ACCESS_ROLE_BADGE_LABEL;
  protected readonly roleBadgeTooltip = ORG_ACCESS_ROLE_BADGE_TOOLTIP;
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4];
  protected readonly summarySkeletonCards: readonly number[] = [0, 1, 2];

  // Toolbar + pagination state.
  protected readonly searchTerm = signal<string>('');
  protected readonly typeFilter = signal<OrgAccessFilter>('all');
  protected readonly limit = signal<number>(ORG_ACCESS_INITIAL_LIMIT);
  protected readonly retryTrigger = signal<number>(0);

  // Seeded true: a real fetch fires synchronously on mount.
  private readonly loadingState = signal<boolean>(true);
  protected readonly isLoading = this.loadingState.asReadonly();
  private readonly fetchErrorState = signal<boolean>(false);
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  // Authoritative list payload — replaced on load and on each successful write (FR-015a).
  private readonly listData = signal<OrgAccessListResponse>(EMPTY_ORG_ACCESS_LIST_RESPONSE);

  // Edit-modal state.
  protected readonly editingUser = signal<OrgAccessUser | null>(null);
  protected readonly editModalVisible = signal<boolean>(false);
  protected readonly isSubmitting = signal<boolean>(false);

  // Add-users modal state.
  protected readonly addModalVisible = signal<boolean>(false);
  protected readonly isInviting = signal<boolean>(false);

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly users: Signal<OrgAccessUser[]> = computed(() => this.listData().users);
  protected readonly summary: Signal<OrgAccessSummary> = computed(() => this.listData().summary);
  protected readonly canManage: Signal<boolean> = computed(() => this.listData().canManage);

  protected readonly filteredUsers: Signal<OrgAccessUser[]> = computed(() => this.initFilteredUsers());
  protected readonly totalFiltered = computed(() => this.filteredUsers().length);
  protected readonly visibleRows: Signal<OrgAccessRowVm[]> = computed(() =>
    this.filteredUsers()
      .slice(0, this.limit())
      .map((user) => this.toRowVm(user))
  );
  protected readonly canShowAll = computed(() => this.limit() < this.totalFiltered());
  protected readonly dataState = computed(() => this.initDataState());
  protected readonly isFiltering = computed(() => this.searchTerm().trim().length > 0 || this.typeFilter() !== 'all');
  protected readonly footerCountLabel = computed(() => `Showing ${Math.min(this.limit(), this.totalFiltered())} of ${this.totalFiltered()} users`);

  // Disable the modal's Viewer option when the principal under edit is the last accepted Admin.
  protected readonly editDisableViewer = computed(() => {
    const user = this.editingUser();
    return !!user && this.isLastAdmin(user);
  });

  public constructor() {
    combineLatest([this.orgUid$, toObservable(this.retryTrigger)])
      .pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of(EMPTY_ORG_ACCESS_LIST_RESPONSE);
          }
          return this.dataService.getAccessUsers(orgUid).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of(EMPTY_ORG_ACCESS_LIST_RESPONSE);
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((res) => this.listData.set(res));

    // Reset filters + pagination when the org actually changes (skip the initial sync emission).
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.resetState());

    // Reset pagination to the cap whenever a filter input changes.
    combineLatest([toObservable(this.searchTerm), toObservable(this.typeFilter)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_ACCESS_INITIAL_LIMIT));
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  protected showAll(): void {
    this.limit.set(this.totalFiltered());
  }

  protected openAdd(): void {
    if (!this.canManage()) return;
    this.addModalVisible.set(true);
  }

  protected onInvite(value: OrgAccessInviteFormValue): void {
    const orgUid = this.accountContext.selectedAccount().uid;
    if (!orgUid) return;

    this.isInviting.set(true);
    this.dataService
      .inviteUser(orgUid, value.email, value.role, value.name)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isInviting.set(false);
          // Drop the response if the selected org changed mid-flight. res.orgUid echoes the org the
          // request was issued for, so compare it to the LIVE selection (not the captured orgUid,
          // which it always equals) to avoid overwriting a newly-selected org's list.
          if (res.orgUid !== this.accountContext.selectedAccount().uid) return;
          this.listData.set(res);
          this.addModalVisible.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Invite sent',
            detail: `${value.email} was invited as ${ORG_ACCESS_ROLE_BADGE_LABEL[value.role]}.`,
            life: 3000,
          });
        },
        error: (err) => {
          this.isInviting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Invite failed',
            detail: this.errorDetail(err, 'Could not send the invite. Please try again.'),
            life: 5000,
          });
        },
      });
  }

  protected openEdit(user: OrgAccessUser): void {
    if (!this.canEditRow(user)) return;
    this.editingUser.set(user);
    this.editModalVisible.set(true);
  }

  protected onEditSave(role: OrgAccessRole): void {
    const user = this.editingUser();
    const orgUid = this.accountContext.selectedAccount().uid;
    if (!user || !orgUid) return;

    this.isSubmitting.set(true);
    this.dataService
      .changeRole(orgUid, user.email, role)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isSubmitting.set(false);
          // Drop the response if the selected org changed mid-flight (compare the live selection;
          // res.orgUid always equals the captured orgUid the request was issued for).
          if (res.orgUid !== this.accountContext.selectedAccount().uid) return;
          this.listData.set(res);
          this.editModalVisible.set(false);
          this.editingUser.set(null);
          this.messageService.add({
            severity: 'success',
            summary: 'Access updated',
            detail: `${user.name} is now ${ORG_ACCESS_ROLE_BADGE_LABEL[role]}.`,
            life: 3000,
          });
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Update failed',
            detail: this.errorDetail(err, 'Could not update access. Please try again.'),
            life: 5000,
          });
        },
      });
  }

  protected confirmRemove(user: OrgAccessUser): void {
    if (!this.canManage() || this.isLastAdmin(user)) return;
    this.confirmationService.confirm({
      header: 'Remove access',
      message: `Remove Org Lens access for ${user.name}? This revokes their access to this organization.`,
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.removeUser(user),
    });
  }

  private removeUser(user: OrgAccessUser): void {
    const orgUid = this.accountContext.selectedAccount().uid;
    if (!orgUid) return;

    this.isSubmitting.set(true);
    this.dataService
      .removeUser(orgUid, user.email)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isSubmitting.set(false);
          // Drop the response if the selected org changed mid-flight (compare the live selection;
          // res.orgUid always equals the captured orgUid the request was issued for).
          if (res.orgUid !== this.accountContext.selectedAccount().uid) return;
          this.listData.set(res);
          this.messageService.add({
            severity: 'success',
            summary: 'Access removed',
            detail: `${user.name} no longer has Org Lens access.`,
            life: 3000,
          });
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Remove failed',
            detail: this.errorDetail(err, 'Could not remove access. Please try again.'),
            life: 5000,
          });
        },
      });
  }

  // Pulls the clean BFF error message out of an HttpErrorResponse envelope, else a fallback.
  private errorDetail(err: unknown, fallback: string): string {
    const candidate = err as { error?: { error?: { message?: unknown } } } | null | undefined;
    const message = candidate?.error?.error?.message;
    return typeof message === 'string' && message.trim() ? message : fallback;
  }

  // Bakes per-row derivatives once so the template never calls methods in bindings.
  private toRowVm(user: OrgAccessUser): OrgAccessRowVm {
    const isLastAdmin = this.isLastAdmin(user);
    return {
      ...user,
      isLastAdmin,
      editDisabledBase: user.isPending,
      editTooltip: user.isPending ? 'Edit is available once the invite is accepted.' : 'Edit access',
      removeTooltip: isLastAdmin ? 'Organization must keep at least one Admin. Promote another Admin first.' : 'Remove access',
    };
  }

  private isLastAdmin(user: OrgAccessUser): boolean {
    return !user.isPending && user.role === 'admin' && this.summary().administrators === 1;
  }

  private canEditRow(user: OrgAccessUser): boolean {
    return this.canManage() && !user.isPending;
  }

  private initDataState(): 'loading' | 'error' | 'empty' | 'loaded' {
    if (this.isLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    return this.totalFiltered() > 0 ? 'loaded' : 'empty';
  }

  private initFilteredUsers(): OrgAccessUser[] {
    const q = this.searchTerm().trim().toLowerCase();
    const filter = this.typeFilter();
    return this.users().filter((user) => {
      if (q) {
        const inName = user.name.toLowerCase().includes(q);
        const inTitle = (user.jobTitle ?? '').toLowerCase().includes(q);
        const inEmail = user.email.toLowerCase().includes(q);
        if (!inName && !inTitle && !inEmail) return false;
      }
      switch (filter) {
        case 'admin':
          return !user.isPending && user.role === 'admin';
        case 'viewer':
          return !user.isPending && user.role === 'viewer';
        case 'invited':
          return user.isPending;
        default:
          return true;
      }
    });
  }

  private resetState(): void {
    this.searchTerm.set('');
    this.typeFilter.set('all');
    this.limit.set(ORG_ACCESS_INITIAL_LIMIT);
    this.editModalVisible.set(false);
    this.editingUser.set(null);
    this.addModalVisible.set(false);
  }
}
