// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, Injector, input, OnInit, output, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { Committee, CommitteeMember } from '@lfx-pcc/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { debounceTime, distinctUntilChanged, startWith, take } from 'rxjs/operators';

import { MemberCardComponent } from '../member-card/member-card.component';
import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-members',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardComponent,
    MemberCardComponent,
    MenuComponent,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    SelectButtonComponent,
    TableComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
    AnimateOnScrollModule,
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
  private readonly injector = inject(Injector);

  // Input signals
  public committee = input.required<Committee | null>();
  public members = input.required<CommitteeMember[]>();
  public membersLoading = input<boolean>(true);

  public readonly refresh = output<void>();

  // Class variables with types
  private dialogRef: DynamicDialogRef | undefined;
  public selectedMember: WritableSignal<CommitteeMember | null>;
  public isDeleting: WritableSignal<boolean>;
  public memberActionMenuItems: MenuItem[] = [];

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

  // View toggle variables
  public viewForm: FormGroup;
  public currentView: WritableSignal<'cards' | 'table'>;
  public viewOptions: { label: string; value: 'cards' | 'table' }[];

  public constructor() {
    // Initialize all class variables
    this.selectedMember = signal<CommitteeMember | null>(null);
    this.isDeleting = signal<boolean>(false);
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

    // Initialize view toggle
    this.currentView = signal<'cards' | 'table'>('table');
    this.viewForm = this.initializeViewForm();
    this.viewOptions = this.initializeViewOptions();
  }

  public ngOnInit(): void {
    this.memberActionMenuItems = this.initializeMemberActionMenuItems();
  }

  public onMemberMenuToggle(data: { event: Event; member: CommitteeMember; menu: MenuComponent }): void {
    data.event.stopPropagation();
    this.selectedMember.set(data.member);
    data.menu.toggle(data.event);
  }

  public toggleMemberActionMenu(event: Event, member: CommitteeMember, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedMember.set(member);
    menuComponent.toggle(event);
  }

  public onViewChange(view: 'cards' | 'table'): void {
    this.currentView.set(view);
  }

  public openAddMemberDialog(): void {
    this.dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Add Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        committee: this.committee(),
        onCancel: () => {
          // Dialog will close itself
        },
      },
    });

    this.dialogRef.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result) {
        this.refreshMembers();
      }
    });
  }

  // Member action handlers
  private viewMember(): void {
    const member = this.selectedMember();
    if (member) {
      // TODO: Implement member view functionality
    }
  }

  private editMember(): void {
    const member = this.selectedMember();
    if (member) {
      this.dialogRef = this.dialogService.open(MemberFormComponent, {
        header: 'Edit Member',
        width: '700px',
        modal: true,
        closable: true,
        data: {
          isEditing: true,
          memberId: member.id,
          member: member,
          committee: this.committee(),
          onCancel: () => {
            // Dialog will close itself
          },
        },
      });

      this.dialogRef.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
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
      message: `Are you sure you want to remove ${member.first_name || ''} ${member.last_name || ''} from this committee? ` + 'This action cannot be undone.',
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

    this.committeeService.deleteCommitteeMember(committee.uid, member.id).subscribe({
      next: () => {
        this.isDeleting.set(false);

        const memberName = member.first_name && member.last_name ? `${member.first_name} ${member.last_name}` : member.email || 'Member';

        this.messageService.add({
          severity: 'success',
          summary: 'Member Removed',
          detail: `${memberName} has been removed from the committee`,
        });

        // Refresh members list by re-fetching
        this.refreshMembers();
      },
      error: (error) => {
        this.isDeleting.set(false);
        console.error('Failed to delete member:', error);

        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to remove member. Please try again.',
        });
      },
    });
  }

  private refreshMembers(): void {
    this.refresh.emit();
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

  private initializeMemberActionMenuItems(): MenuItem[] {
    return [
      {
        label: 'Send Message',
        icon: 'fa-light fa-envelope',
        command: () => window.open(`mailto:${this.selectedMember()?.email}`, '_blank'),
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
        if (member.role) {
          roleSet.add(member.role);
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
        if (member.voting_status) {
          statusSet.add(member.voting_status);
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
        if (member.organization) {
          orgSet.add(member.organization);
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
            member.organization?.toLowerCase().includes(searchTerm) ||
            member.job_title?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply role filter
      const roleFilter = this.roleFilter();
      if (roleFilter) {
        filtered = filtered.filter((member) => member.role === roleFilter);
      }

      // Apply voting status filter
      const votingStatusFilter = this.votingStatusFilter();
      if (votingStatusFilter) {
        filtered = filtered.filter((member) => member.voting_status === votingStatusFilter);
      }

      // Apply organization filter
      const organizationFilter = this.organizationFilter();
      if (organizationFilter) {
        filtered = filtered.filter((member) => member.organization === organizationFilter);
      }

      return filtered;
    });
  }

  private initializeViewForm(): FormGroup {
    return new FormGroup({
      view: new FormControl('table'),
    });
  }

  private initializeViewOptions(): { label: string; value: 'cards' | 'table' }[] {
    return [
      { label: 'Table', value: 'table' },
      { label: 'Cards', value: 'cards' },
    ];
  }
}
