// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeMember,
  CommitteeMemberState,
  CommitteeMemberWithState,
  CreateCommitteeMemberRequest,
  MemberPendingChanges,
} from '@lfx-one/shared/interfaces';
import { generateTempId } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, finalize, of, take, tap } from 'rxjs';

import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-members-manager',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, InputTextComponent, SelectComponent, ConfirmDialogModule, DynamicDialogModule, TooltipModule],
  providers: [ConfirmationService, DialogService],
  templateUrl: './committee-members-manager.component.html',
})
export class CommitteeMembersManagerComponent implements OnInit {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // Dialog reference
  private dialogRef: DynamicDialogRef | undefined;

  // Input signals
  public committeeId = input.required<string | null>();
  public memberUpdates = input<MemberPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [] });
  public refresh = input<BehaviorSubject<void>>();

  // Output events for two-way binding
  public readonly memberUpdatesChange = output<MemberPendingChanges>();
  public readonly done = output<void>();

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  // Writable signals for state management
  public membersWithState: WritableSignal<CommitteeMemberWithState[]> = signal([]);
  public loading: WritableSignal<boolean> = signal(true);
  public searchTerm = signal<string>('');
  public statusFilter = signal<string | null>(null);

  // Committee data
  public committee = signal<Committee | null>(null);

  // Simple computed signals
  public readonly visibleMembers = computed(() => this.membersWithState().filter((m) => m.state !== 'deleted'));
  public readonly memberCount = computed(() => this.visibleMembers().length);
  public readonly votingCount = computed(() => this.visibleMembers().filter((m) => this.isVotingMember(m)).length);

  // Complex computed signals (using private initializers)
  public readonly filteredMembers = this.initFilteredMembers();

  // Form instances
  public searchForm: FormGroup;

  // Static configuration
  public statusOptions = [
    { label: 'All Members', value: null },
    { label: 'Voting Only', value: 'voting' },
    { label: 'Non-Voting', value: 'non-voting' },
  ];

  public constructor() {
    this.searchForm = new FormGroup({
      search: new FormControl(''),
      status: new FormControl(null),
    });

    // Subscribe to form changes and update signals
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchTerm.set(value || '');
      });

    this.searchForm
      .get('status')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.statusFilter.set(value);
      });
  }

  public ngOnInit(): void {
    this.initializeMembers();
    this.loadCommittee();

    this.refresh()
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.initializeMembers();
        this.loadCommittee();
      });
  }

  public openAddMemberDialog(): void {
    this.dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Add Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        wizardMode: true, // Don't call API, return data instead
        committee: this.committee(),
      },
    });

    this.dialogRef.onClose.pipe(take(1)).subscribe((result: CreateCommitteeMemberRequest | undefined) => {
      if (result) {
        this.handleAddMemberResult(result);
      }
    });
  }

  public openEditMemberDialog(member: CommitteeMemberWithState): void {
    this.dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Edit Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: true,
        wizardMode: true, // Don't call API, return data instead
        member: member,
        committee: this.committee(),
      },
    });

    this.dialogRef.onClose.pipe(take(1)).subscribe((result: CreateCommitteeMemberRequest | undefined) => {
      if (result) {
        this.handleEditMemberResult(member, result);
      }
    });
  }

  public handleMemberUpdate(updateData: { id: string; data: CommitteeMember }): void {
    this.membersWithState.update((members) =>
      members.map((m) => {
        if (m.uid === updateData.id || m.tempId === updateData.id) {
          return {
            ...updateData.data,
            state: m.state === 'existing' ? ('modified' as CommitteeMemberState) : m.state,
            originalData: m.originalData,
            tempId: m.tempId,
          } as CommitteeMemberWithState;
        }
        return m;
      })
    );

    this.emitMemberUpdates();
  }

  public handleMemberDelete(id: string): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to remove this member from the group?',
      header: 'Remove Member',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm',
      accept: () => {
        this.membersWithState.update(
          (members) =>
            members
              .map((m) => {
                if (m.uid === id || m.tempId === id) {
                  if (m.state === 'new') {
                    // For new members, remove completely
                    return null;
                  }
                  // For existing members, mark as deleted
                  return { ...m, state: 'deleted' as CommitteeMemberState };
                }
                return m;
              })
              .filter(Boolean) as CommitteeMemberWithState[]
        );

        this.emitMemberUpdates();
      },
    });
  }

  public onSendMessage(member: CommitteeMemberWithState): void {
    if (member?.email) {
      window.open(`mailto:${member.email}`, '_blank');
    }
  }

  private handleEditMemberResult(originalMember: CommitteeMemberWithState, memberData: CreateCommitteeMemberRequest): void {
    // Build updated CommitteeMember object from the form data
    const updatedMemberData: CommitteeMember = {
      uid: originalMember.uid,
      committee_uid: originalMember.committee_uid,
      committee_name: originalMember.committee_name,
      email: memberData.email,
      first_name: memberData.first_name || '',
      last_name: memberData.last_name || '',
      job_title: memberData.job_title || undefined,
      appointed_by: memberData.appointed_by || undefined,
      organization: memberData.organization
        ? {
            name: memberData.organization.name || '',
            website: memberData.organization.website || undefined,
          }
        : undefined,
      role: memberData.role
        ? {
            name: memberData.role.name,
            start_date: memberData.role.start_date || undefined,
            end_date: memberData.role.end_date || undefined,
          }
        : undefined,
      voting: memberData.voting
        ? {
            status: memberData.voting.status,
            start_date: memberData.voting.start_date || undefined,
            end_date: memberData.voting.end_date || undefined,
          }
        : undefined,
      created_at: originalMember.created_at,
      updated_at: new Date().toISOString(),
    };

    // Use existing handleMemberUpdate to update the member
    this.handleMemberUpdate({
      id: originalMember.uid || originalMember.tempId || '',
      data: updatedMemberData,
    });
  }

  private handleAddMemberResult(memberData: CreateCommitteeMemberRequest): void {
    // Build complete CommitteeMember object from the form data
    const newMemberData: CommitteeMember = {
      uid: '',
      committee_uid: this.committeeId() || '',
      committee_name: this.committee()?.name || '',
      email: memberData.email,
      first_name: memberData.first_name || '',
      last_name: memberData.last_name || '',
      job_title: memberData.job_title || undefined,
      appointed_by: memberData.appointed_by || undefined,
      organization: memberData.organization
        ? {
            name: memberData.organization.name || '',
            website: memberData.organization.website || undefined,
          }
        : undefined,
      role: memberData.role
        ? {
            name: memberData.role.name,
            start_date: memberData.role.start_date || undefined,
            end_date: memberData.role.end_date || undefined,
          }
        : undefined,
      voting: memberData.voting
        ? {
            status: memberData.voting.status,
            start_date: memberData.voting.start_date || undefined,
            end_date: memberData.voting.end_date || undefined,
          }
        : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Create new member with temporary ID for immediate UI updates
    const newMember: CommitteeMemberWithState = {
      ...newMemberData,
      state: 'new' as CommitteeMemberState,
      tempId: generateTempId(),
      originalData: undefined,
    };

    // Add to local state for immediate UI feedback
    this.membersWithState.update((members) => [...members, newMember]);

    // Emit updated member updates
    this.emitMemberUpdates();
  }

  private initFilteredMembers() {
    return computed(() => {
      let filtered = this.visibleMembers();
      const search = this.searchTerm().toLowerCase();
      const status = this.statusFilter();

      // Apply search filter
      if (search) {
        filtered = filtered.filter(
          (member) =>
            member.first_name?.toLowerCase().includes(search) ||
            member.last_name?.toLowerCase().includes(search) ||
            member.email?.toLowerCase().includes(search) ||
            member.organization?.name?.toLowerCase().includes(search) ||
            member.job_title?.toLowerCase().includes(search)
        );
      }

      // Apply status filter
      if (status) {
        switch (status) {
          case 'voting':
            filtered = filtered.filter((m) => this.isVotingMember(m));
            break;
          case 'non-voting':
            filtered = filtered.filter((m) => !this.isVotingMember(m));
            break;
        }
      }

      return filtered;
    });
  }

  /**
   * Checks if a member has voting rights (Voting Rep or Alternate Voting Rep)
   */
  private isVotingMember(member: CommitteeMemberWithState): boolean {
    return member.voting?.status === CommitteeMemberVotingStatus.VOTING_REP || member.voting?.status === CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP;
  }

  private createMemberWithState(member: CommitteeMember, state: CommitteeMemberState = 'existing'): CommitteeMemberWithState {
    return {
      ...member,
      state: state,
      originalData: state === 'existing' ? { ...member } : undefined,
      tempId: state === 'new' ? generateTempId() : undefined,
    };
  }

  private loadCommittee(): void {
    const committeeId = this.committeeId();
    if (!committeeId) return;

    this.committeeService
      .getCommittee(committeeId)
      .pipe(
        take(1),
        catchError(() => of(null))
      )
      .subscribe((committee) => {
        this.committee.set(committee);
      });
  }

  private initializeMembers(): void {
    const committeeId = this.committeeId();
    if (!committeeId) {
      this.loading.set(false);
      return;
    }

    this.committeeService
      .getCommitteeMembers(committeeId)
      .pipe(
        take(1),
        catchError((error) => {
          console.error('Error loading members:', error);
          return of([]);
        }),
        finalize(() => {
          this.loading.set(false);
        }),
        tap((members) => {
          if (!members || members.length === 0) {
            this.membersWithState.set([]);
            return;
          }

          this.membersWithState.set(members.map((m) => this.createMemberWithState(m, 'existing')));
        })
      )
      .subscribe();
  }

  private emitMemberUpdates(): void {
    const members = this.membersWithState();
    this.memberUpdatesChange.emit({
      toAdd: members.filter((m) => m.state === 'new').map((m) => this.stripMetadata(m)),
      toUpdate: members
        .filter((m) => m.state === 'modified')
        .map((m) => ({
          uid: m.uid,
          changes: this.stripMetadata(m), // Pass entire member object, not just changed fields
        })),
      toDelete: members.filter((m) => m.state === 'deleted').map((m) => m.uid),
    });
  }

  private stripMetadata(member: CommitteeMemberWithState): CreateCommitteeMemberRequest {
    return {
      email: member.email,
      first_name: member.first_name || null,
      last_name: member.last_name || null,
      job_title: member.job_title || null,
      organization: member.organization
        ? {
            name: member.organization.name || null,
            website: member.organization.website || null,
          }
        : null,
      role: member.role
        ? {
            name: member.role.name,
            start_date: member.role.start_date || null,
            end_date: member.role.end_date || null,
          }
        : null,
      voting: member.voting
        ? {
            status: member.voting.status,
            start_date: member.voting.start_date || null,
            end_date: member.voting.end_date || null,
          }
        : null,
      appointed_by: member.appointed_by || null,
    };
  }
}
