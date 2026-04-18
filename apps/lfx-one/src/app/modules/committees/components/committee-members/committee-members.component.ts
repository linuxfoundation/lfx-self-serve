// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, OnInit, output, signal, Signal } from '@angular/core';
import { FullNamePipe } from '@pipes/full-name.pipe';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, CommitteeMember, CommitteePermissionLevel, CommitteeUser, TagSeverity } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { Skeleton } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, of, startWith, take } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';

import { AddMemberDialogComponent } from '../add-member-dialog/add-member-dialog.component';
import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-members',
  imports: [
    TitleCasePipe,
    ReactiveFormsModule,
    CardComponent,
    FullNamePipe,
    MenuComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    TableComponent,
    TagComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
    Skeleton,
  ],
  providers: [DialogService],
  templateUrl: './committee-members.component.html',
  styleUrl: './committee-members.component.scss',
})
export class CommitteeMembersComponent implements OnInit {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  // Input signals
  public committee = input.required<Committee | null>();
  public members = input.required<CommitteeMember[]>();
  public membersLoading = input<boolean>(true);

  public readonly refresh = output<void>();

  // Simple writable signals
  public selectedMember = signal<CommitteeMember | null>(null);
  public isDeleting = signal<boolean>(false);
  public memberActionMenuItems: MenuItem[] = [];
  public committeeLabel = COMMITTEE_LABEL;

  // Computed signals — inline per component-organization.md
  // Permission is solely driven by the API's writer flag
  public readonly canManageMembers = computed(() => !!this.committee()?.writer);
  // Default to hidden while committee is loading (fail closed for privacy)
  public readonly isMembersVisible = computed(() => {
    const committee = this.committee();
    if (!committee) return false;
    return committee.member_visibility !== 'hidden' || this.canManageMembers();
  });

  // Filter-related variables
  public filterForm: FormGroup;
  public searchTerm: Signal<string>;
  public roleFilter: Signal<string | null>;
  public votingStatusFilter: Signal<string | null>;
  public organizationFilter: Signal<string | null>;
  public filteredMembers: Signal<CommitteeMember[]>;
  public roleOptions: Signal<{ label: string; value: string | null }[]>;
  public votingStatusOptions: Signal<{ label: string; value: string | null }[]>;
  public organizationOptions: Signal<{ label: string; value: string | null }[]>;

  public constructor() {
    // Initialize filter form
    this.filterForm = this.initializeFilterForm();
    this.searchTerm = this.initializeSearchTerm();
    this.roleFilter = this.initializeRoleFilter();
    this.votingStatusFilter = this.initializeVotingStatusFilter();
    this.organizationFilter = this.initializeOrganizationFilter();
    this.roleOptions = this.initializeRoleOptions();
    this.votingStatusOptions = this.initializeVotingStatusOptions();
    this.organizationOptions = this.initializeOrganizationOptions();
    this.filteredMembers = this.initializeFilteredMembers();
  }

  public ngOnInit(): void {
    this.memberActionMenuItems = this.initializeMemberActionMenuItems();
  }

  public toggleMemberActionMenu(event: Event, member: CommitteeMember, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedMember.set(member);
    // Rebuild menu items so MenuItem.url reflects the selected member's email
    this.memberActionMenuItems = this.initializeMemberActionMenuItems(member);
    menuComponent.toggle(event);
  }

  public getMemberPermission(member: CommitteeMember): CommitteePermissionLevel {
    const committee = this.committee();
    if (!committee) return 'member';
    const memberEmail = member.email?.toLowerCase();
    const matches = (u: { username: string; email: string }) => (member.username && u.username === member.username) || u.email?.toLowerCase() === memberEmail;
    if (committee.writers?.some(matches)) return 'manage';
    if (committee.auditors?.some(matches)) return 'review';
    return 'member';
  }

  public getMemberPermissionSeverity(permission: CommitteePermissionLevel): TagSeverity {
    if (permission === 'manage') return 'success';
    if (permission === 'review') return 'info';
    return 'secondary';
  }

  public getMemberPermissionLabel(permission: CommitteePermissionLevel): string {
    if (permission === 'manage') return 'Manage';
    if (permission === 'review') return 'Reviewer';
    return 'Member';
  }

  public openAddMemberDialog(): void {
    const dialogRef = this.dialogService.open(AddMemberDialogComponent, {
      header: 'Add Member',
      width: '540px',
      modal: true,
      closable: true,
      data: {
        committee: this.committee(),
        existingMembers: this.members(),
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | string | undefined) => {
      if (result === true) {
        this.refreshMembers();
      } else if (result === 'manual') {
        this.openManualMemberForm();
      }
    });
  }

  private openManualMemberForm(): void {
    const dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Add Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        committee: this.committee(),
      },
    });

    dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result) {
        this.refreshMembers();
      }
    });
  }

  private editMember(): void {
    const member = this.selectedMember();
    if (member) {
      const dialogRef = this.dialogService.open(MemberFormComponent, {
        header: 'Edit Member',
        width: '700px',
        modal: true,
        closable: true,
        data: {
          isEditing: true,
          memberId: member.uid,
          member: member,
          committee: this.committee(),
          onCancel: () => {
            // Dialog will close itself
          },
        },
      });

      dialogRef?.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
        if (result) {
          this.refreshMembers();
        }
      });
    }
  }

  private deleteMember(): void {
    const member = this.selectedMember();
    if (!member) return;

    this.confirmationService.confirm({
      message: `Are you sure you want to remove ${this.getMemberDisplayName(member)} from this committee? This action cannot be undone.`,
      header: 'Remove Member',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.performDelete(member),
    });
  }

  private performDelete(member: CommitteeMember): void {
    const committee = this.committee();
    if (!committee || !committee.uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Committee information is not available',
      });
      return;
    }

    this.isDeleting.set(true);

    this.committeeService.deleteCommitteeMember(committee.uid, member.uid).subscribe({
      next: () => {
        this.isDeleting.set(false);

        const memberName = this.getMemberDisplayName(member);

        this.messageService.add({
          severity: 'success',
          summary: 'Member Removed',
          detail: `${memberName} has been removed from the committee`,
        });

        // Clean up stale ACL entries — remove deleted member from writers/auditors.
        // Best-effort: if this fails, warn but don't block the UI (member was already deleted).
        const memberEmail = member.email?.toLowerCase();
        const memberUsername = member.username;
        const existingWriters: CommitteeUser[] = committee.writers ?? [];
        const existingAuditors: CommitteeUser[] = committee.auditors ?? [];
        const hadElevatedPermission =
          existingWriters.some((w) => (memberUsername && w.username === memberUsername) || w.email?.toLowerCase() === memberEmail) ||
          existingAuditors.some((a) => (memberUsername && a.username === memberUsername) || a.email?.toLowerCase() === memberEmail);

        if (hadElevatedPermission) {
          const writers = existingWriters.filter((w) => !(memberUsername && w.username === memberUsername) && w.email?.toLowerCase() !== memberEmail);
          const auditors = existingAuditors.filter((a) => !(memberUsername && a.username === memberUsername) && a.email?.toLowerCase() !== memberEmail);

          // Refresh only after the permission cleanup settles — avoids a race where the
          // committee re-fetch returns stale writers/auditors before the settings PUT completes.
          this.committeeService
            .updateCommitteePermissions(committee.uid, writers, auditors)
            .pipe(
              catchError(() => {
                this.messageService.add({
                  severity: 'warn',
                  summary: 'Permission Cleanup Failed',
                  detail: `${memberName} was removed, but their elevated permission could not be revoked. Please update manually in settings.`,
                  life: 6000,
                });
                return of(null);
              })
            )
            .subscribe({ next: () => this.refreshMembers() });
        } else {
          this.refreshMembers();
        }
      },
      error: (err: HttpErrorResponse) => {
        this.isDeleting.set(false);

        this.messageService.add({
          severity: 'error',
          summary: 'Unable to Remove',
          detail: getHttpErrorDetail(err, 'Failed to remove member. Please try again.'),
        });
      },
    });
  }

  private refreshMembers(): void {
    this.refresh.emit();
  }

  private getMemberDisplayName(member: CommitteeMember): string {
    const parts = [member.first_name, member.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : member.email || 'Member';
  }

  // Private initialization methods
  private initializeFilterForm(): FormGroup {
    return new FormGroup({
      search: new FormControl(''),
      role: new FormControl(null),
      votingStatus: new FormControl(null),
      organization: new FormControl(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.filterForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeRoleFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('role')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeVotingStatusFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('votingStatus')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeOrganizationFilter(): Signal<string | null> {
    return toSignal(this.filterForm.get('organization')!.valueChanges.pipe(startWith(null), distinctUntilChanged()), { initialValue: null });
  }

  private initializeMemberActionMenuItems(member?: CommitteeMember): MenuItem[] {
    return [
      {
        label: 'Send Message',
        icon: 'fa-light fa-envelope',
        url: member?.email ? `mailto:${member.email}` : undefined,
      },
      {
        separator: true,
      },
      {
        label: 'Edit',
        icon: 'fa-light fa-edit',
        command: () => this.editMember(),
      },
      {
        separator: true,
      },
      {
        label: 'Remove',
        icon: 'fa-light fa-trash',
        styleClass: 'text-red-500',
        disabled: this.isDeleting(),
        command: () => this.deleteMember(),
      },
    ];
  }

  private initializeRoleOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const roleSet = new Set<string>();

      members.forEach((member) => {
        if (member.role?.name) {
          roleSet.add(member.role.name);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Roles', value: null }];
      Array.from(roleSet)
        .sort()
        .forEach((role) => {
          options.push({ label: role, value: role });
        });

      return options;
    });
  }

  private initializeVotingStatusOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const statusSet = new Set<string>();

      members.forEach((member) => {
        if (member.voting?.status) {
          statusSet.add(member.voting.status);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Voting Status', value: null }];
      Array.from(statusSet)
        .sort()
        .forEach((status) => {
          options.push({ label: status, value: status });
        });

      return options;
    });
  }

  private initializeOrganizationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const members = this.members();
      const orgSet = new Set<string>();

      members.forEach((member) => {
        if (member.organization?.name) {
          orgSet.add(member.organization.name);
        }
      });

      const options: { label: string; value: string | null }[] = [{ label: 'All Organizations', value: null }];
      Array.from(orgSet)
        .sort()
        .forEach((org) => {
          options.push({ label: org, value: org });
        });

      return options;
    });
  }

  private initializeFilteredMembers(): Signal<CommitteeMember[]> {
    return computed(() => {
      let filtered = this.members();

      // Apply search filter
      const searchTerm = this.searchTerm().toLowerCase();
      if (searchTerm) {
        filtered = filtered.filter(
          (member) =>
            member.first_name?.toLowerCase().includes(searchTerm) ||
            member.last_name?.toLowerCase().includes(searchTerm) ||
            member.email?.toLowerCase().includes(searchTerm) ||
            member.organization?.name?.toLowerCase().includes(searchTerm) ||
            member.job_title?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply role filter
      const roleFilter = this.roleFilter();
      if (roleFilter) {
        filtered = filtered.filter((member) => member.role?.name === roleFilter);
      }

      // Apply voting status filter
      const votingStatusFilter = this.votingStatusFilter();
      if (votingStatusFilter) {
        filtered = filtered.filter((member) => member.voting?.status === votingStatusFilter);
      }

      // Apply organization filter
      const organizationFilter = this.organizationFilter();
      if (organizationFilter) {
        filtered = filtered.filter((member) => member.organization?.name === organizationFilter);
      }

      return filtered;
    });
  }
}
