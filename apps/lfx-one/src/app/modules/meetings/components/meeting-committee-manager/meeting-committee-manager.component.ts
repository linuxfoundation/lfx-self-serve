// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TitleCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, InputSignal, OnInit, output, OutputEmitterRef, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TableComponent } from '@components/table/table.component';
import { Committee, CommitteeMember, MeetingCommittee } from '@lfx-one/shared';
import { COMMITTEE_LABEL, VOTING_STATUSES } from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, filter, forkJoin, map, of, switchMap, tap } from 'rxjs';

interface CommitteeMemberDisplay extends CommitteeMember {
  committeeName: string;
  committees?: string[];
}

@Component({
  selector: 'lfx-meeting-committee-manager',
  imports: [TitleCasePipe, ReactiveFormsModule, MultiSelectComponent, TableComponent, TooltipModule],
  templateUrl: './meeting-committee-manager.component.html',
})
export class MeetingCommitteeManagerComponent implements OnInit {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  public readonly selectedCommittees: InputSignal<MeetingCommittee[]> = input<MeetingCommittee[]>([]);
  public readonly form: InputSignal<FormGroup> = input.required<FormGroup>();

  // Outputs
  public readonly committeesChange: OutputEmitterRef<MeetingCommittee[]> = output<MeetingCommittee[]>();

  // State management
  public selectedCommitteeIds: WritableSignal<string[]> = signal([]);
  public selectedVotingStatuses: WritableSignal<string[]> = signal([]);
  public committeeForm: FormGroup;
  public readonly committeesLoading = signal<boolean>(true);

  // Committee options loaded from API
  public readonly committeeOptions: Signal<Committee[]> = this.initCommitteeOptions();

  // Reactive committee members loading
  public committeeMembers: Signal<CommitteeMemberDisplay[]> = this.initCommitteeMembers();
  public filteredCommitteeMembers = this.initFilteredCommitteeMembers();

  // Voting status options for dropdown
  public readonly votingStatusOptions = VOTING_STATUSES;
  public readonly committeeLabel = COMMITTEE_LABEL;

  // Computed signals
  public hasVotingEnabledCommittee = computed(() => {
    const selectedIds = this.selectedCommitteeIds();
    const committees = this.committeeOptions();
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
    this.committeeForm = new FormGroup({
      committees: new FormControl([]),
      votingStatuses: new FormControl([]),
    });

    // Subscribe to committee selection changes
    this.committeeForm
      .get('committees')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((committeeIds: string[]) => {
        this.selectedCommitteeIds.set(committeeIds || []);
        this.updateParentForm(committeeIds);

        // Clear voting statuses if no voting committees selected
        const committees = this.committeeOptions();
        const hasVotingCommittees = committees.some((c) => (committeeIds || []).includes(c.uid) && c.enable_voting);
        if (!hasVotingCommittees) {
          this.committeeForm.patchValue({ votingStatuses: [] }, { emitEvent: false });
          this.selectedVotingStatuses.set([]);
        }

        // If any selected committee has show_meeting_attendees enabled, toggle it on for the meeting
        const hasShowMeetingAttendees = committees.some((c) => (committeeIds || []).includes(c.uid) && c.show_meeting_attendees === true);
        if (hasShowMeetingAttendees) {
          this.form().get('show_meeting_attendees')?.setValue(true);
        }
      });

    // Subscribe to voting status changes
    this.committeeForm
      .get('votingStatuses')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((votingStatuses: string[]) => {
        this.selectedVotingStatuses.set(votingStatuses || []);
        this.updateParentForm(this.selectedCommitteeIds());
      });

    // Subscribe to selected committees changes
    toObservable(this.selectedCommittees)
      .pipe(takeUntilDestroyed())
      .subscribe((committees) => this.initializeFromSelectedCommittees(committees));
  }

  public ngOnInit(): void {}

  /**
   * Initialize the component state from the selected committees input
   */
  private initializeFromSelectedCommittees(committees: MeetingCommittee[]): void {
    const committeeIds = committees.map((c) => c.uid);
    this.selectedCommitteeIds.set(committeeIds);

    // Get voting statuses
    const existingVotingStatuses: string[] = [];
    committees.forEach((committee) => {
      if (committee.allowed_voting_statuses) {
        existingVotingStatuses.push(...committee.allowed_voting_statuses);
      }
    });

    const uniqueVotingStatuses = [...new Set(existingVotingStatuses)];
    this.selectedVotingStatuses.set(uniqueVotingStatuses);

    this.committeeForm.patchValue(
      {
        committees: committeeIds,
        votingStatuses: uniqueVotingStatuses,
      },
      { emitEvent: false }
    );
  }

  /**
   * Fetches committee options from API reactively based on project context
   */
  private initCommitteeOptions(): Signal<Committee[]> {
    const projectUid = computed(() => this.projectContextService.selectedProject()?.uid || this.projectContextService.selectedFoundation()?.uid || '');

    return toSignal(
      toObservable(projectUid).pipe(
        tap(() => this.committeesLoading.set(true)),
        filter((uid) => !!uid),
        switchMap((uid) =>
          this.committeeService.getCommitteesByProject(uid).pipe(
            tap(() => this.committeesLoading.set(false)),
            catchError(() => {
              console.error('Failed to load committees for project', uid);
              this.committeesLoading.set(false);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }

  private updateParentForm(committeeIds: string[]): void {
    const selectedVotingStatuses = this.selectedVotingStatuses();
    const committees = this.committeeOptions();
    const hasVotingCommittees = committees.some((c) => committeeIds.includes(c.uid) && c.enable_voting);
    const allowedVotingStatuses = hasVotingCommittees ? selectedVotingStatuses : [];

    const committeeData: MeetingCommittee[] = committeeIds.map((uid) => ({
      uid,
      allowed_voting_statuses: allowedVotingStatuses,
    }));

    // Update parent form
    this.form().get('committees')?.setValue(committeeData);

    // Emit change event
    this.committeesChange.emit(committeeData);
  }

  private initCommitteeMembers(): Signal<CommitteeMemberDisplay[]> {
    return toSignal(
      toObservable(this.selectedCommitteeIds).pipe(
        switchMap((committeeIds) => {
          if (!committeeIds || committeeIds.length === 0) {
            return of([]);
          }

          // Load members for all selected committees
          const memberRequests = committeeIds.map((id) => {
            const committee = this.committeeOptions().find((c) => c.uid === id);
            return this.committeeService.getCommitteeMembers(id).pipe(
              map((members) =>
                members.map((member) => ({
                  ...member,
                  committeeName: committee?.name || '',
                }))
              ),
              catchError((error) => {
                console.error(`Failed to load members for committee ${id}:`, error);
                return of([]);
              })
            );
          });

          return forkJoin(memberRequests).pipe(
            map((memberArrays) => {
              // Flatten and deduplicate by email
              const memberMap = new Map<string, CommitteeMemberDisplay>();

              memberArrays.forEach((members, index) => {
                const committeeName = this.committeeOptions().find((c) => c.uid === committeeIds[index])?.name || '';

                members.forEach((member) => {
                  if (!member.email) return;

                  const emailKey = member.email.toLowerCase();
                  const existingMember = memberMap.get(emailKey);
                  if (!existingMember) {
                    memberMap.set(emailKey, {
                      ...member,
                      committeeName,
                      committees: [committeeName],
                    });
                  } else {
                    if (!existingMember.committees?.includes(committeeName)) {
                      existingMember.committees?.push(committeeName);
                    }
                  }
                });
              });

              return Array.from(memberMap.values());
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initFilteredCommitteeMembers(): Signal<CommitteeMemberDisplay[]> {
    return computed(() => {
      const members = this.committeeMembers();
      const selectedVotingStatuses = this.selectedVotingStatuses();
      const hasVotingCommittees = this.hasVotingEnabledCommittee();

      // If no voting committees selected, show all members
      if (!hasVotingCommittees || selectedVotingStatuses.length === 0) {
        return members;
      }

      // Filter members by selected voting statuses
      // Members without voting status info are excluded from filtered results
      return members.filter((member) => {
        const votingStatus = member.voting?.status;
        // If member has no voting status, exclude them from filtered results
        if (!votingStatus) {
          return false;
        }
        return selectedVotingStatuses.includes(votingStatus);
      });
    });
  }
}
