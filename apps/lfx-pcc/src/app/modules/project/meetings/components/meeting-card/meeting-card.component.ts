// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, OnInit, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FileSizePipe } from '@app/shared/pipes/file-size.pipe';
import { FileTypeIconPipe } from '@app/shared/pipes/file-type-icon.pipe';
import { LinkifyPipe } from '@app/shared/pipes/linkify.pipe';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { extractUrlsWithDomains, Meeting, MeetingAttachment, MeetingParticipant } from '@lfx-pcc/shared';
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
import { ParticipantFormComponent } from '../participant-form/participant-form.component';

@Component({
  selector: 'lfx-meeting-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonComponent,
    MenuComponent,
    MeetingTimePipe,
    AvatarComponent,
    TooltipModule,
    AnimateOnScrollModule,
    ConfirmDialogModule,
    ExpandableTextComponent,
    LinkifyPipe,
    FileTypeIconPipe,
    FileSizePipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-card.component.html',
  styleUrl: './meeting-card.component.scss',
})
export class MeetingCardComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly injector = inject(Injector);

  public readonly meetingInput = input.required<Meeting>();
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly showBorder = input<boolean>(false);
  public readonly meetingParticipantCount: Signal<number> = this.initMeetingParticipantCount();
  public readonly participantResponseBreakdown: Signal<string> = this.initParticipantResponseBreakdown();
  public showParticipants: WritableSignal<boolean> = signal(false);
  public meeting: WritableSignal<Meeting> = signal({} as Meeting);
  public participantsLoading: WritableSignal<boolean> = signal(true);
  public participants!: Signal<MeetingParticipant[]>;
  public participantsLabel: Signal<string> = this.initParticipantsLabel();
  public additionalParticipantsCount: WritableSignal<number> = signal(0);
  public actionMenuItems: Signal<MenuItem[]> = this.initializeActionMenuItems();
  public attachments: Signal<MeetingAttachment[]> = signal([]);

  // Computed values for template
  public readonly attendancePercentage: Signal<number> = this.initAttendancePercentage();
  public readonly attendanceBarColor: Signal<string> = this.initAttendanceBarColor();
  public readonly totalResourcesCount: Signal<number> = this.initTotalResourcesCount();
  public readonly enabledFeaturesCount: Signal<number> = this.initEnabledFeaturesCount();
  public readonly meetingTypeBadge: Signal<{ badgeClass: string; icon?: string; text: string } | null> = this.initMeetingTypeBadge();
  public readonly containerClass: Signal<string> = this.initContainerClass();

  public readonly meetingDeleted = output<void>();
  public readonly project = this.projectService.project;

  // Extract important links from description
  public readonly importantLinks = this.initImportantLinks();

  // Meeting attachments

  public constructor() {
    effect(() => {
      this.meeting.set(this.meetingInput());
    });
  }

  public ngOnInit(): void {
    this.attachments = this.initAttachments();
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
        meetingId: this.meeting().uid,
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
          meetingId: this.meeting().uid,
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

      const totalGuests = this.meetingParticipantCount();

      if (totalGuests === 1) {
        return '1 Guest';
      }

      return `${totalGuests} Guests`;
    });
  }

  private initParticipantResponseBreakdown(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return '';

      const accepted = meeting.participants_accepted_count || 0;
      const declined = meeting.participants_declined_count || 0;
      const pending = meeting.participants_pending_count || 0;

      // Only show breakdown if there are individual participants with responses
      if (accepted === 0 && declined === 0 && pending === 0) {
        return '';
      }

      const parts: string[] = [];
      if (accepted > 0) parts.push(`${accepted} Attending`);
      if (declined > 0) parts.push(`${declined} Not Attending`);
      if (pending > 0) parts.push(`${pending} Pending Response`);

      return parts.join(', ');
    });
  }

  private initParticipantsList(): void {
    this.participantsLoading.set(true);
    const queries = combineLatest([
      this.meetingService.getMeetingParticipants(this.meeting().uid),
      ...(this.meeting().committees?.map((c) => this.committeeService.getCommitteeMembers(c.uid).pipe(catchError(() => of([])))) ?? []),
    ]).pipe(
      map(([participants, ...committeeMembers]) => {
        return [
          ...participants,
          ...committeeMembers
            .filter((c) => c.length > 0)
            .flatMap((c) => {
              return c.map((m) => ({
                id: m.id,
                meeting_id: this.meeting().uid,
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

        const projectSlug = this.project()?.slug;
        if (projectSlug) {
          baseItems.push({
            label: 'Edit',
            icon: 'fa-light fa-edit',
            routerLink: ['/project', projectSlug, 'meetings', this.meeting().uid, 'edit'],
          });
        }
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
      .getMeeting(this.meeting().uid)
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
      const description = this.meeting().description;
      if (!description) {
        return [];
      }

      // Use shared utility to extract URLs with domains
      return extractUrlsWithDomains(description);
    });
  }

  private initAttachments(): Signal<MeetingAttachment[]> {
    return runInInjectionContext(this.injector, () => {
      return toSignal(this.meetingService.getMeetingAttachments(this.meetingInput().uid).pipe(catchError(() => of([]))), { initialValue: [] });
    });
  }

  private initAttendancePercentage(): Signal<number> {
    return computed(() => {
      const totalParticipants = this.meetingParticipantCount();
      const acceptedCount = this.meeting().participants_accepted_count || 0;
      return totalParticipants > 0 ? Math.round((acceptedCount / totalParticipants) * 100) : 0;
    });
  }

  private initAttendanceBarColor(): Signal<string> {
    return computed(() => {
      const percentage = this.attendancePercentage();

      if (percentage < 25) {
        return 'bg-amber-500';
      }
      if (percentage < 70) {
        return 'bg-blue-500';
      }
      return 'bg-green-500';
    });
  }

  private initTotalResourcesCount(): Signal<number> {
    return computed(() => {
      return this.attachments().length + this.importantLinks().length;
    });
  }

  private initEnabledFeaturesCount(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      return (
        (meeting.recording_enabled ? 1 : 0) +
        (meeting.transcript_enabled ? 1 : 0) +
        (meeting.youtube_upload_enabled ? 1 : 0) +
        (meeting.zoom_config?.ai_companion_enabled ? 1 : 0) +
        (meeting.visibility === 'public' ? 1 : 0)
      );
    });
  }

  private initMeetingTypeBadge(): Signal<{ badgeClass: string; icon?: string; text: string } | null> {
    return computed(() => {
      const meetingType = this.meeting().meeting_type;
      if (!meetingType) return null;

      const type = meetingType.toLowerCase();

      switch (type) {
        case 'board':
          return { badgeClass: 'bg-red-100 text-red-500', icon: 'fa-light fa-user-check', text: meetingType };
        case 'maintainers':
          return { badgeClass: 'bg-blue-100 text-blue-500', icon: 'fa-light fa-gear', text: meetingType };
        case 'marketing':
          return { badgeClass: 'bg-green-100 text-green-500', icon: 'fa-light fa-chart-line-up', text: meetingType };
        case 'technical':
          return { badgeClass: 'bg-purple-100 text-purple-500', icon: 'fa-light fa-code', text: meetingType };
        case 'legal':
          return { badgeClass: 'bg-amber-100 text-amber-500', icon: 'fa-light fa-scale-balanced', text: meetingType };
        default:
          return { badgeClass: 'bg-gray-100 text-gray-400', icon: 'fa-light fa-calendar-days', text: meetingType };
      }
    });
  }

  private initContainerClass(): Signal<string> {
    return computed(() => {
      if (!this.showBorder()) {
        return '';
      }

      const baseClasses = 'bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md h-full border-l-4 transition-all duration-300';
      const meetingType = this.meeting().meeting_type?.toLowerCase();

      let borderClass = '';
      switch (meetingType) {
        case 'board':
          borderClass = 'border-l-red-300';
          break;
        case 'maintainers':
          borderClass = 'border-l-blue-300';
          break;
        case 'marketing':
          borderClass = 'border-l-green-300';
          break;
        case 'technical':
          borderClass = 'border-l-purple-300';
          break;
        case 'legal':
          borderClass = 'border-l-amber-300';
          break;
        case 'other':
        case 'none':
        default:
          borderClass = 'border-l-gray-300';
          break;
      }

      return `${baseClasses} ${borderClass}`;
    });
  }
}
