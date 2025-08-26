// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TableComponent } from '@components/table/table.component';
import { MIN_EARLY_JOIN_TIME } from '@lfx-pcc/shared';
import { ArtifactVisibility, MeetingVisibility } from '@lfx-pcc/shared/enums';
import { Committee, CommitteeMember, Meeting } from '@lfx-pcc/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
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
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, MultiSelectComponent, TableComponent, TooltipModule],
  templateUrl: './meeting-committee-modal.component.html',
  styleUrl: './meeting-committee-modal.component.scss',
})
export class MeetingCommitteeModalComponent {
  // Injected services
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public readonly meeting: Meeting = this.config.data.meeting;

  // Class variables
  public saving: WritableSignal<boolean> = signal(false);
  public committeesLoading: WritableSignal<boolean> = signal(true);
  public selectedCommitteeIds: WritableSignal<string[]> = signal([]);
  public committeeMembers: WritableSignal<CommitteeMemberDisplay[]> = signal([]);
  public membersLoading: WritableSignal<boolean> = signal(false);
  public form: FormGroup;

  // Track loaded committees to avoid duplicate API calls
  private loadedCommitteeIds: Set<string> = new Set();
  private committeesMembersCache: Map<string, CommitteeMemberDisplay[]> = new Map();

  // Load committees using toSignal
  public committees: Signal<Committee[]> = toSignal(
    this.committeeService.getCommitteesByProject(this.projectService.project()?.uid || '').pipe(
      tap(() => this.committeesLoading.set(false)),
      catchError((error) => {
        console.error('Failed to load committees:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load committees',
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
    });

    // Set initial selected committees
    if (this.meeting.meeting_committees && this.meeting.meeting_committees.length > 0) {
      const committeeIds = this.meeting.meeting_committees.map((c) => c.uid);
      this.selectedCommitteeIds.set(committeeIds);
      this.form.patchValue({ committees: committeeIds });
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
      });
  }

  public onCancel(): void {
    this.ref.close();
  }

  public onSave(): void {
    const selectedIds = this.form.value.committees as string[];

    // If no changes, just close
    const currentIds = this.meeting.meeting_committees?.map((c) => c.uid) || [];
    if (JSON.stringify(selectedIds.sort()) === JSON.stringify(currentIds.sort())) {
      this.ref.close();
      return;
    }

    this.saving.set(true);

    // Build update request with all existing meeting fields plus committees
    const updateRequest = {
      project_uid: this.meeting.project_uid,
      title: this.meeting.title || '',
      description: this.meeting.description || undefined,
      start_time: this.meeting.start_time || '',
      duration: this.meeting.duration || 60,
      timezone: this.meeting.timezone || 'UTC',
      meeting_type: this.meeting.meeting_type || 'online',
      early_join_time_minutes: this.meeting.early_join_time_minutes || MIN_EARLY_JOIN_TIME,
      visibility: this.meeting.visibility || MeetingVisibility.PUBLIC,
      recording_enabled: this.meeting.recording_enabled || false,
      transcript_enabled: this.meeting.transcript_enabled || false,
      youtube_upload_enabled: this.meeting.youtube_upload_enabled || false,
      zoom_config: {
        ai_companion_enabled: this.meeting.zoom_config?.ai_companion_enabled || false,
        ai_summary_require_approval: this.meeting.zoom_config?.ai_summary_require_approval || false,
      },
      artifact_visibility: this.meeting.artifact_visibility || ArtifactVisibility.PUBLIC,
      recurrence: this.meeting.recurrence || undefined,
      restricted: this.meeting.restricted || false,
      committees: selectedIds.map((uid) => ({
        uid,
        allowed_voting_statuses: ['active', 'voting'],
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
            detail: 'Meeting committees updated successfully',
          });
          this.saving.set(false);
          this.ref.close(true);
        },
        error: (error) => {
          console.error('Failed to update meeting committees:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update meeting committees',
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
}
