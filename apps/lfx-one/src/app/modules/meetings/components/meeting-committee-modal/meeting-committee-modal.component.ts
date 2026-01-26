// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TitleCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TableComponent } from '@components/table/table.component';
import { COMMITTEE_LABEL, VOTING_STATUSES } from '@lfx-one/shared';
import { Committee, CommitteeMember, Meeting } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, forkJoin, map, of, take, tap } from 'rxjs';

interface CommitteeMemberDisplay extends CommitteeMember {
  committeeName: string;
  committees?: string[];
}

@Component({
  selector: 'lfx-meeting-committee-modal',
  imports: [TitleCasePipe, ReactiveFormsModule, ButtonComponent, MultiSelectComponent, TableComponent, TooltipModule],
  templateUrl: './meeting-committee-modal.component.html',
})
export class MeetingCommitteeModalComponent {
  // Injected services
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);

  // Inputs
  public readonly meeting: Meeting = this.config.data.meeting;

  // Class variables
  public saving: WritableSignal<boolean> = signal(false);
  public committeesLoading: WritableSignal<boolean> = signal(true);
  public selectedCommitteeIds: WritableSignal<string[]> = signal([]);
  public selectedVotingStatuses: WritableSignal<string[]> = signal([]);
  public committeeMembers: WritableSignal<CommitteeMemberDisplay[]> = signal([]);
  public membersLoading: WritableSignal<boolean> = signal(false);
  public form: FormGroup;
  public filteredCommitteeMembers: Signal<CommitteeMemberDisplay[]> = signal([]);
  public project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  public projectUid = computed(() => this.project()?.uid || '');

  // Track loaded committees to avoid duplicate API calls
  private loadedCommitteeIds = new Set<string>();
  private committeesMembersCache = new Map<string, CommitteeMemberDisplay[]>();

  // Voting status options for dropdown
  public readonly votingStatusOptions = VOTING_STATUSES;
  public readonly committeeLabel = COMMITTEE_LABEL;

  // Load committees using toSignal
  public committees: Signal<Committee[]> = toSignal(
    this.committeeService.getCommitteesByProject(this.projectUid()).pipe(
      tap(() => this.committeesLoading.set(false)),
      catchError((error) => {
        console.error(`Failed to load ${COMMITTEE_LABEL.plural.toLowerCase()}:`, error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to load ${COMMITTEE_LABEL.plural.toLowerCase()}`,
        });
        this.committeesLoading.set(false);
        return of([]);
      })
    ),
    { initialValue: [] }
  );

  // Computed signals
  public hasVotingEnabledCommittee = computed(() => {
    const selectedIds = this.selectedCommitteeIds();
    const committees = this.committees();
    return committees.some((c) => selectedIds.includes(c.uid) && c.enable_voting);
  });

  public tableColspan = computed(() => {
    const hasVoting = this.hasVotingEnabledCommittee();
    const hasMultipleCommittees = this.selectedCommitteeIds().length > 1;

    if (hasVoting) {
      return 5; // Name, Organization, Committee, Role, Voting Status
    }

    if (hasMultipleCommittees) {
      return 3; // Name, Organization, Committee
    }

    return 2; // Name, Organization
  });

  public constructor() {
    this.form = new FormGroup({
      committees: new FormControl([]),
      votingStatuses: new FormControl([]),
    });

    // Set initial selected committees
    if (this.meeting.committees && this.meeting.committees.length > 0) {
      const committeeIds = this.meeting.committees.map((c) => c.uid);
      this.selectedCommitteeIds.set(committeeIds);

      // Get initial voting statuses from meeting committees
      const existingVotingStatuses: string[] = [];
      this.meeting.committees.forEach((committee) => {
        if (committee.allowed_voting_statuses) {
          existingVotingStatuses.push(...committee.allowed_voting_statuses);
        }
      });

      // Remove duplicates and set initial values
      const uniqueVotingStatuses = [...new Set(existingVotingStatuses)];
      this.selectedVotingStatuses.set(uniqueVotingStatuses);

      this.form.patchValue({
        committees: committeeIds,
        votingStatuses: uniqueVotingStatuses,
      });

      // Load members for initially selected committees
      this.loadCommitteeMembers(committeeIds);
    }

    // Subscribe to form value changes
    this.form
      .get('committees')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((committeeIds: string[]) => {
        this.selectedCommitteeIds.set(committeeIds || []);
        this.loadCommitteeMembers(committeeIds || []);

        // Clear voting statuses if no committees with voting are selected
        const committees = this.committees();
        const hasVotingCommittees = committees.some((c) => (committeeIds || []).includes(c.uid) && c.enable_voting);
        if (!hasVotingCommittees) {
          this.form.patchValue({ votingStatuses: [] }, { emitEvent: false });
          this.selectedVotingStatuses.set([]);
        }
      });

    // Subscribe to voting status changes
    this.form
      .get('votingStatuses')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((votingStatuses: string[]) => {
        this.selectedVotingStatuses.set(votingStatuses || []);
      });
  }

  public onCancel(): void {
    this.ref.close();
  }

  public onSave(): void {
    const selectedIds = this.form.value.committees as string[];
    const selectedVotingStatuses = (this.form.value.votingStatuses as string[]) || [];

    // If no changes, just close
    const currentIds = this.meeting.committees?.map((c) => c.uid) || [];
    const currentVotingStatuses = this.meeting.committees?.flatMap((c) => c.allowed_voting_statuses || []) || [];
    if (
      JSON.stringify(selectedIds.sort()) === JSON.stringify(currentIds.sort()) &&
      JSON.stringify(selectedVotingStatuses.sort()) === JSON.stringify(currentVotingStatuses.sort())
    ) {
      this.ref.close();
      return;
    }

    this.saving.set(true);

    // Determine voting statuses based on whether selected committees have voting enabled
    const committees = this.committees();
    const hasVotingCommittees = committees.some((c) => selectedIds.includes(c.uid) && c.enable_voting);
    const allowedVotingStatuses = hasVotingCommittees ? selectedVotingStatuses : [];

    // Build update request with all existing meeting fields plus committees
    const updateRequest = {
      ...this.meeting,
      committees: selectedIds.map((uid) => ({
        uid,
        allowed_voting_statuses: allowedVotingStatuses,
      })),
    };

    this.meetingService
      .updateMeeting(this.meeting.uid, updateRequest)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Meeting ${COMMITTEE_LABEL.plural.toLowerCase()} updated successfully`,
          });
          this.saving.set(false);
          this.ref.close(true);
        },
        error: (error) => {
          console.error(`Failed to update meeting ${COMMITTEE_LABEL.plural.toLowerCase()}:`, error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to update meeting ${COMMITTEE_LABEL.plural.toLowerCase()}`,
          });
          this.saving.set(false);
        },
      });
  }

  private loadCommitteeMembers(committeeIds: string[]): void {
    if (!committeeIds || committeeIds.length === 0) {
      this.committeeMembers.set([]);
      return;
    }

    this.membersLoading.set(true);

    // Determine which committees need to be loaded
    const committeesToLoad = committeeIds.filter((id) => !this.loadedCommitteeIds.has(id));

    if (committeesToLoad.length === 0) {
      // All committees are already loaded, just update the display
      this.updateMembersDisplay(committeeIds);
      this.membersLoading.set(false);
      return;
    }

    // Load members for committees that haven't been loaded yet
    const memberRequests = committeesToLoad.map((id) => {
      const committee = this.committees().find((c) => c.uid === id);
      return this.committeeService.getCommitteeMembers(id).pipe(
        map((members) => {
          const membersWithCommittee = members.map((member) => ({
            ...member,
            committeeName: committee?.name || '',
          }));
          // Cache the results
          this.committeesMembersCache.set(id, membersWithCommittee);
          this.loadedCommitteeIds.add(id);
          return membersWithCommittee;
        }),
        tap(() => {
          this.filteredCommitteeMembers = this.initializeFilteredCommitteeMembers();
        }),
        catchError((error) => {
          console.error(`Failed to load members for committee ${id}:`, error);
          // Mark as loaded even on error to avoid repeated failed requests
          this.loadedCommitteeIds.add(id);
          return of([]);
        })
      );
    });

    if (memberRequests.length > 0) {
      forkJoin(memberRequests)
        .pipe(take(1))
        .subscribe(() => {
          this.updateMembersDisplay(committeeIds);
          this.membersLoading.set(false);
        });
    }
  }

  private updateMembersDisplay(committeeIds: string[]): void {
    const memberMap = new Map<string, CommitteeMemberDisplay>();

    for (const committeeId of committeeIds) {
      const cachedMembers = this.committeesMembersCache.get(committeeId) || [];
      const committee = this.committees().find((c) => c.uid === committeeId);
      const committeeName = committee?.name || '';

      for (const member of cachedMembers) {
        // Skip members without email addresses
        if (!member.email) continue;

        const existingMember = memberMap.get(member.email);

        if (!existingMember) {
          memberMap.set(member.email, {
            ...member,
            committees: [committeeName],
          });
        } else {
          // Only add if not already present
          if (!existingMember.committees?.includes(committeeName)) {
            existingMember.committees?.push(committeeName);
          }
        }
      }
    }

    this.committeeMembers.set(Array.from(memberMap.values()));
  }

  private initializeFilteredCommitteeMembers(): Signal<CommitteeMemberDisplay[]> {
    return computed(() => {
      const members = this.committeeMembers();
      const selectedVotingStatuses = this.selectedVotingStatuses();
      const hasVotingCommittees = this.hasVotingEnabledCommittee();

      // If no voting committees selected, show all members
      if (!hasVotingCommittees || selectedVotingStatuses.length === 0) {
        return members;
      }

      // Filter members by selected voting statuses
      return members.filter((member) => {
        return member.voting?.status && selectedVotingStatuses.includes(member.voting.status);
      });
    });
  }
}
