// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FullNamePipe } from '@pipes/full-name.pipe';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeInvite,
  CommitteeMember,
  CommitteeMemberState,
  CommitteeMemberWithState,
  CreateCommitteeInviteRequest,
  CreateCommitteeMemberRequest,
  MemberPendingChanges,
} from '@lfx-one/shared/interfaces';
import { generateTempId } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, finalize, of, take, tap } from 'rxjs';

import { AddMemberDialogComponent } from '../add-member-dialog/add-member-dialog.component';
import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-members-manager',
  imports: [
    NgClass,
    ReactiveFormsModule,
    AvatarComponent,
    ButtonComponent,
    CardComponent,
    FullNamePipe,
    InputTextComponent,
    SelectComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
    TooltipModule,
  ],
  providers: [ConfirmationService, DialogService],
  templateUrl: './committee-members-manager.component.html',
})
export class CommitteeMembersManagerComponent implements OnInit {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // Input signals
  public committeeId = input.required<string | null>();
  public memberUpdates = input<MemberPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [], toInvite: [] });
  public refresh = input<BehaviorSubject<void>>();
  /**
   * Live Step 3 draft values for the org-required flags. In edit mode these can differ from the
   * persisted `committee()` snapshot until the wizard is submitted — overridden onto it before
   * opening the invite dialog so org validation reflects what Done/Update is about to save, not
   * what's currently on the server (LFXV2-2606 review).
   */
  public organizationRequirements = input<Pick<Committee, 'enable_voting' | 'business_email_required'> | null>(null);

  // Output events for two-way binding
  public readonly memberUpdatesChange = output<MemberPendingChanges>();
  public readonly done = output<void>();

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  // Writable signals for state management
  public membersWithState: WritableSignal<CommitteeMemberWithState[]> = signal([]);
  public loading: WritableSignal<boolean> = signal(true);
  public committeeLoading: WritableSignal<boolean> = signal(true);
  public searchTerm = signal<string>('');
  public statusFilter = signal<string | null>(null);

  // "Finished loading" isn't "loaded successfully" — both fetches below swallow their errors into
  // an empty fallback, so a failure alone wouldn't otherwise keep the invite action disabled.
  public readonly membersLoadFailed = signal(false);
  public readonly committeeLoadFailed = signal(false);

  // Committee data
  public committee = signal<Committee | null>(null);

  // Bulk email invites staged in the wizard, deduped by normalized email. These are collected
  // client-side and flushed by the wizard on completion (POST /invites) — never sent immediately,
  // so cancelling the wizard sends nothing (LFXV2-2606). Surfaced as a "Pending invitations" list.
  // Hydrated from the input in ngOnInit (not here) — signal inputs apply after field
  // initializers run, so reading memberUpdates() at this point would only ever see its default.
  public readonly pendingInvites = signal<CreateCommitteeInviteRequest[]>([]);

  // In-flight guard so rapid clicks on "Invite by email" don't stack overlapping dialogs.
  private readonly loadingInvites = signal(false);

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
    // Rehydrate from the parent-bound input now that it's applied (see the field comment above).
    this.pendingInvites.set(this.memberUpdates().toInvite);

    this.initializeMembers();
    this.loadCommittee();

    this.refresh()
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.initializeMembers();
        this.loadCommittee();
      });
  }

  public openInviteByEmailDialog(): void {
    if (this.loadingInvites()) {
      return;
    }

    const committeeId = this.committeeId();
    if (!committeeId) {
      // Fresh group (create mode) has no server-side invites yet — nothing to dedupe against.
      this.openCollectInviteDialog([]);
      return;
    }

    this.loadingInvites.set(true);

    this.committeeService
      .getCommitteeInvites(committeeId)
      .pipe(
        take(1),
        finalize(() => this.loadingInvites.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (invites) => {
          // Only pending invites should block re-inviting — accepted invitees are already members,
          // and declined/revoked ones must be re-invitable. Matches committee-view.component.ts.
          const pending = invites.filter((invite) => (invite.status ?? '').toLowerCase() === 'pending');
          this.openCollectInviteDialog(pending);
        },
        // Falling back to "no existing invites" on failure would silently defeat the dedupe
        // guarantee (a staged invite could duplicate an already-pending one) — abort instead.
        error: (error) => {
          console.error('Failed to load existing invites for dedupe:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Open Invite Dialog',
            detail: 'Could not load existing invites. Please try again.',
            life: 6000,
          });
        },
      });
  }

  /** Remove a staged (not-yet-sent) invite from the pending list. */
  public removePendingInvite(email: string): void {
    this.pendingInvites.update((current) => current.filter((invite) => invite.invitee_email !== email));
    this.emitMemberUpdates();
  }

  public openAddMemberDialog(): void {
    const dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Add Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        wizardMode: true, // Don't call API, return data instead
        committee: this.committee(),
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: CreateCommitteeMemberRequest | undefined) => {
      if (result) {
        this.handleAddMemberResult(result);
      }
    });
  }

  public openEditMemberDialog(member: CommitteeMemberWithState): void {
    const dialogRef = this.dialogService.open(MemberFormComponent, {
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
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: CreateCommitteeMemberRequest | undefined) => {
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

  private openCollectInviteDialog(serverInvites: CommitteeInvite[]): void {
    // Dedupe the dialog against both already-sent invites (edit mode) and locally-staged ones.
    // The dialog only reads invitee_email off these, so a partial shape is sufficient.
    const stagedAsInvites: Pick<CommitteeInvite, 'invitee_email'>[] = this.pendingInvites().map((invite) => ({ invitee_email: invite.invitee_email }));

    // Overlay the live Step 3 draft onto the persisted snapshot so org validation matches what
    // Done/Update is about to save, not stale server-side settings (see the input's doc comment).
    const committee = this.committee();
    const orgOverrides = this.organizationRequirements();
    const effectiveCommittee = committee && orgOverrides ? { ...committee, ...orgOverrides } : committee;

    const dialogRef = this.dialogService.open(AddMemberDialogComponent, {
      header: 'Invite by Email',
      width: '540px',
      modal: true,
      closable: true,
      data: {
        committee: effectiveCommittee,
        mode: 'invite',
        collectOnly: true,
        existingMembers: this.visibleMembers(),
        existingInvites: [...serverInvites, ...stagedAsInvites],
      },
    }) as DynamicDialogRef;

    // Collect mode returns the built invite payloads; stage them for flush on wizard completion.
    dialogRef.onClose.pipe(take(1)).subscribe((staged: CreateCommitteeInviteRequest[] | undefined) => {
      if (staged?.length) {
        this.stageInvites(staged);
      }
    });
  }

  /** Union newly-staged invites into the pending list, deduped by normalized email, then emit. */
  private stageInvites(invites: CreateCommitteeInviteRequest[]): void {
    const seen = new Set(this.pendingInvites().map((invite) => (invite.invitee_email ?? '').trim().toLowerCase()));
    const additions = invites.filter((invite) => {
      const email = (invite.invitee_email ?? '').trim().toLowerCase();
      if (!email || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    });

    if (additions.length === 0) {
      return;
    }

    this.pendingInvites.update((current) => [...current, ...additions]);
    this.emitMemberUpdates();
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
    if (!committeeId) {
      this.committeeLoading.set(false);
      return;
    }

    this.committeeLoadFailed.set(false);
    this.committeeService
      .getCommittee(committeeId)
      .pipe(
        take(1),
        catchError((error) => {
          console.error('Failed to load committee:', error);
          this.committeeLoadFailed.set(true);
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Load Committee',
            detail: 'Could not load committee details. Refresh the page to try again.',
            life: 6000,
          });
          return of(null);
        }),
        finalize(() => this.committeeLoading.set(false))
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

    this.membersLoadFailed.set(false);
    this.committeeService
      .getCommitteeMembers(committeeId)
      .pipe(
        take(1),
        catchError((error) => {
          console.error('Error loading members:', error);
          this.membersLoadFailed.set(true);
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Load Members',
            detail: 'Could not load committee members. Refresh the page to try again.',
            life: 6000,
          });
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

    // A staged invite whose email now also matches an added/edited member would otherwise queue
    // both a member-create op and an invite op for the same person on Done. Drop it from the
    // pending list rather than just the emit, so the "Pending invitations" UI doesn't lie either.
    const activeMemberEmails = new Set(members.filter((m) => m.state !== 'deleted').map((m) => (m.email ?? '').trim().toLowerCase()));
    const toInvite = this.pendingInvites().filter((invite) => !activeMemberEmails.has((invite.invitee_email ?? '').trim().toLowerCase()));
    if (toInvite.length !== this.pendingInvites().length) {
      this.pendingInvites.set(toInvite);
    }

    this.memberUpdatesChange.emit({
      toAdd: members.filter((m) => m.state === 'new').map((m) => this.stripMetadata(m)),
      toUpdate: members
        .filter((m) => m.state === 'modified')
        .map((m) => ({
          uid: m.uid,
          changes: this.stripMetadata(m), // Pass entire member object, not just changed fields
        })),
      toDelete: members.filter((m) => m.state === 'deleted').map((m) => m.uid),
      toInvite,
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
