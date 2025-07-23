// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, Injector, input, OnInit, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { CardComponent } from '@app/shared/components/card/card.component';
import { MemberFormComponent } from '@app/shared/components/member-form/member-form.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { TableComponent } from '@app/shared/components/table/table.component';
import { CommitteeService } from '@app/shared/services/committee.service';
import { Committee, CommitteeMember } from '@lfx-pcc/shared/interfaces';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-committee-members',
  imports: [CommonModule, CardComponent, MenuComponent, TableComponent, ButtonComponent, ConfirmDialogModule, DynamicDialogModule],
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

  public readonly refresh = output<void>();

  // Class variables with types
  private dialogRef: DynamicDialogRef | undefined;
  public members: Signal<CommitteeMember[]> = signal<CommitteeMember[]>([]);
  public selectedMember: WritableSignal<CommitteeMember | null>;
  public isDeleting: WritableSignal<boolean>;
  public memberActionMenuItems: MenuItem[] = [];

  public constructor() {
    // Initialize all class variables
    this.selectedMember = signal<CommitteeMember | null>(null);
    this.isDeleting = signal<boolean>(false);
  }

  public ngOnInit(): void {
    runInInjectionContext(this.injector, () => {
      this.members = this.initializeMembers();
      this.memberActionMenuItems = this.initializeMemberActionMenuItems();
    });
  }

  public toggleMemberActionMenu(event: Event, member: CommitteeMember, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedMember.set(member);
    menuComponent.toggle(event);
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

    this.dialogRef.onClose.subscribe((result: boolean | undefined) => {
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

      this.dialogRef.onClose.subscribe((result: boolean | undefined) => {
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
    if (!committee || !committee.id) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Committee information is not available',
      });
      return;
    }

    this.isDeleting.set(true);

    this.committeeService.deleteCommitteeMember(committee.id, member.id).subscribe({
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
  private initializeMembers(): Signal<CommitteeMember[]> {
    const committee = this.committee();
    if (!committee || !committee.id) {
      return signal<CommitteeMember[]>([]);
    }
    return toSignal(this.committeeService.getCommitteeMembers(committee.id), { initialValue: [] });
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
}
