// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LinkifyPipe } from '@app/shared/pipes/linkify.pipe';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { extractUrlsWithDomains, Meeting, MeetingParticipant } from '@lfx-pcc/shared';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, finalize, map, of, take, tap } from 'rxjs';

import { MeetingCommitteeModalComponent } from '../meeting-committee-modal/meeting-committee-modal.component';
import { MeetingDeleteConfirmationComponent, MeetingDeleteResult } from '../meeting-delete-confirmation/meeting-delete-confirmation.component';
import { MeetingFormComponent } from '../meeting-form/meeting-form.component';
import { ParticipantFormComponent } from '../participant-form/participant-form.component';
import { RecurringEditOption, RecurringMeetingEditOptionsComponent } from '../recurring-meeting-edit-options/recurring-meeting-edit-options.component';

@Component({
  selector: 'lfx-meeting-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonComponent,
    MenuComponent,
    BadgeComponent,
    MeetingTimePipe,
    AvatarComponent,
    TooltipModule,
    AnimateOnScrollModule,
    ConfirmDialogModule,
    ExpandableTextComponent,
    LinkifyPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-card.component.html',
  styleUrl: './meeting-card.component.scss',
})
export class MeetingCardComponent {
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly injector = inject(Injector);

  public readonly meetingInput = input.required<Meeting>();
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly meetingParticipantCount: Signal<number> = this.initMeetingParticipantCount();
  public showParticipants: WritableSignal<boolean> = signal(false);
  public meeting: WritableSignal<Meeting> = signal({} as Meeting);
  public participantsLoading: WritableSignal<boolean> = signal(true);
  public participants!: Signal<MeetingParticipant[]>;
  public participantsLabel: Signal<string> = this.initParticipantsLabel();
  public additionalParticipantsCount: WritableSignal<number> = signal(0);
  public actionMenuItems: Signal<MenuItem[]> = this.initializeActionMenuItems();

  public readonly meetingDeleted = output<void>();
  public readonly project = this.projectService.project;

  // Extract important links from agenda
  public readonly importantLinks = this.initImportantLinks();

  public constructor() {
    effect(() => {
      this.meeting.set(this.meetingInput());
    });
  }

  public onParticipantsToggle(event: Event): void {
    event.stopPropagation();

    if (this.meetingParticipantCount() === 0) {
      // Open add participant modal
      this.openAddParticipantModal();
      return;
    }

    // Show/hide inline participants display
    this.participantsLoading.set(true);

    // Show/hide inline participants display
    this.participantsLoading.set(true);
    if (!this.showParticipants()) {
      this.initParticipantsList();
    }

    this.showParticipants.set(!this.showParticipants());
  }

  public openAddParticipantModal(): void {
    const dialogRef = this.dialogService.open(ParticipantFormComponent, {
      header: 'Add Participant',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meetingId: this.meeting().id,
        participant: null, // Add mode
      },
    });

    dialogRef.onChildComponentLoaded.pipe(take(1)).subscribe((component) => {
      component.participantSaved.subscribe(() => {
        this.initParticipantsList();
      });
    });
  }

  public openCommitteeModal(): void {
    this.dialogService
      .open(MeetingCommitteeModalComponent, {
        header: this.meeting().meeting_committees && this.meeting().meeting_committees!.length > 0 ? 'Manage Committees' : 'Connect Committees',
        width: '950px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: this.meeting(),
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.refreshMeeting();
        }
      });
  }

  public onParticipantEdit(participant: MeetingParticipant, event: Event): void {
    event.stopPropagation();

    // Don't allow editing committee members - show informational message
    if (participant.type === 'committee') {
      this.messageService.add({
        severity: 'info',
        summary: 'Committee Member',
        detail: 'This is a committee member. To update their details, please edit them in the individual committee(s)',
      });
      return;
    }

    this.dialogService
      .open(ParticipantFormComponent, {
        header: 'Edit Participant',
        width: '650px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meetingId: this.meeting().id,
          participant: participant, // Edit mode
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          // Refresh the current participant display
          this.initParticipantsList();
        }
      });
  }
  private initMeetingParticipantCount(): Signal<number> {
    return computed(
      () => (this.meeting()?.individual_participants_count || 0) + (this.meeting()?.committee_members_count || 0) + (this.additionalParticipantsCount() || 0)
    );
  }

  private initParticipantsLabel(): Signal<string> {
    return computed(() => {
      if (this.meetingParticipantCount() === 0) {
        return 'Add Guests';
      }

      if (this.meetingParticipantCount() === 1) {
        return '1 Guest';
      }

      return this.meetingParticipantCount() + ' Guests';
    });
  }

  private initParticipantsList(): void {
    this.participantsLoading.set(true);
    const queries = combineLatest([
      this.meetingService.getMeetingParticipants(this.meeting().id),
      ...(this.meeting().committees?.map((c) => this.committeeService.getCommitteeMembers(c).pipe(catchError(() => of([])))) ?? []),
    ]).pipe(
      map(([participants, ...committeeMembers]) => {
        return [
          ...participants,
          ...committeeMembers
            .filter((c) => c.length > 0)
            .flatMap((c) => {
              return c.map((m) => ({
                id: m.id,
                meeting_id: this.meeting().id,
                first_name: m.first_name,
                last_name: m.last_name,
                email: m.email,
                organization: m.organization,
                is_host: false,
                type: 'committee',
                invite_accepted: null,
                attended: true,
              }));
            }),
        ];
      }),
      // Sort participants by first name
      map((participants) => participants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingParticipant[]),
      tap((participants) => {
        this.additionalParticipantsCount.set(participants.length - (this.meeting().individual_participants_count + this.meeting().committee_members_count));
      }),
      finalize(() => this.participantsLoading.set(false))
    );

    runInInjectionContext(this.injector, () => {
      this.participants = toSignal(queries, {
        initialValue: [],
      });
    });
  }

  private editMeeting(): void {
    const meeting = this.meeting();
    if (!meeting) return;

    // Check if it's a recurring meeting
    if (meeting.recurrence) {
      // Show recurring edit options dialog first
      const optionsDialog = this.dialogService.open(RecurringMeetingEditOptionsComponent, {
        header: 'Edit Recurring Meeting',
        width: '450px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: meeting,
        },
      });

      optionsDialog.onClose.pipe(take(1)).subscribe((result: RecurringEditOption) => {
        if (result?.proceed) {
          // Open the meeting form with the selected edit type
          this.openMeetingEditForm(meeting, result.editType);
        }
      });
    } else {
      // For non-recurring meetings, open the form directly
      this.openMeetingEditForm(meeting, 'single');
    }
  }

  private openMeetingEditForm(meeting: Meeting, editType: 'single' | 'future'): void {
    this.dialogService
      .open(MeetingFormComponent, {
        header: 'Edit Meeting',
        width: '600px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: meeting,
          isEditing: true,
          editType: editType,
          meetingId: meeting.id,
        },
      })
      .onClose.pipe(take(1))
      .subscribe((updatedMeeting) => {
        if (updatedMeeting) {
          this.refreshMeeting();
        }
      });
  }

  private deleteMeeting(): void {
    const meeting = this.meeting();
    if (!meeting) return;

    this.dialogService
      .open(MeetingDeleteConfirmationComponent, {
        header: 'Delete Meeting',
        width: '450px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: meeting,
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result: MeetingDeleteResult) => {
        if (result) {
          this.meetingDeleted.emit();
        }
      });
  }

  private initializeActionMenuItems(): Signal<MenuItem[]> {
    return computed(() => {
      const baseItems: MenuItem[] = [];

      // Only add Edit option for upcoming meetings
      if (!this.pastMeeting()) {
        baseItems.push({
          label: 'Add Guests',
          icon: 'fa-light fa-plus',
          command: () => this.openAddParticipantModal(),
        });

        baseItems.push({
          label: this.meeting().meeting_committees && this.meeting().meeting_committees!.length > 0 ? 'Manage Committees' : 'Connect Committees',
          icon: 'fa-light fa-people-group',
          command: () => this.openCommitteeModal(),
        });

        baseItems.push({
          label: 'Edit',
          icon: 'fa-light fa-edit',
          command: () => this.editMeeting(),
        });
        baseItems.push({
          separator: true,
        });
      }

      // Add separator and delete option
      baseItems.push({
        label: 'Delete',
        icon: 'fa-light fa-trash',
        styleClass: 'text-red-600',
        command: () => this.deleteMeeting(),
      });

      return baseItems;
    });
  }

  private refreshMeeting(): void {
    this.meetingService
      .getMeeting(this.meeting().id)
      .pipe(
        take(1),
        tap((meeting) => {
          this.additionalParticipantsCount.set(0);
          this.meeting.set(meeting);
        }),
        finalize(() => this.initParticipantsList())
      )
      .subscribe();
  }

  private initImportantLinks(): Signal<{ url: string; domain: string }[]> {
    return computed(() => {
      const agenda = this.meeting().agenda;
      if (!agenda) {
        return [];
      }

      // Use shared utility to extract URLs with domains
      return extractUrlsWithDomains(agenda);
    });
  }
}
