// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, OnInit, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FileSizePipe } from '@app/shared/pipes/file-size.pipe';
import { FileTypeIconPipe } from '@app/shared/pipes/file-type-icon.pipe';
import { LinkifyPipe } from '@app/shared/pipes/linkify.pipe';
import { RecurrenceSummaryPipe } from '@app/shared/pipes/recurrence-summary.pipe';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { environment } from '@environments/environment';
import {
  extractUrlsWithDomains,
  getCurrentOrNextOccurrence,
  Meeting,
  MeetingAttachment,
  MeetingCancelOccurrenceResult,
  MeetingOccurrence,
  MeetingRegistrant,
  PastMeeting,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
} from '@lfx-one/shared';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, filter, finalize, map, of, switchMap, take, tap } from 'rxjs';

import { MeetingCancelOccurrenceConfirmationComponent } from '../meeting-cancel-occurrence-confirmation/meeting-cancel-occurrence-confirmation.component';
import { MeetingCommitteeModalComponent } from '../meeting-committee-modal/meeting-committee-modal.component';
import { MeetingDeleteConfirmationComponent, MeetingDeleteResult } from '../meeting-delete-confirmation/meeting-delete-confirmation.component';
import { MeetingDeleteTypeSelectionComponent, MeetingDeleteTypeResult } from '../meeting-delete-type-selection/meeting-delete-type-selection.component';
import { RecordingModalComponent } from '../recording-modal/recording-modal.component';
import { RegistrantModalComponent } from '../registrant-modal/registrant-modal.component';
import { SummaryModalComponent } from '../summary-modal/summary-modal.component';

@Component({
  selector: 'lfx-meeting-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonComponent,
    MenuComponent,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    AvatarComponent,
    TooltipModule,
    AnimateOnScrollModule,
    ConfirmDialogModule,
    ExpandableTextComponent,
    LinkifyPipe,
    FileTypeIconPipe,
    FileSizePipe,
    ClipboardModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-card.component.html',
})
export class MeetingCardComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);

  public readonly meetingInput = input.required<Meeting | PastMeeting>();
  public readonly occurrenceInput = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly showBorder = input<boolean>(false);
  public readonly meetingRegistrantCount: Signal<number> = this.initMeetingRegistrantCount();
  public readonly registrantResponseBreakdown: Signal<string> = this.initRegistrantResponseBreakdown();
  public showRegistrants: WritableSignal<boolean> = signal(false);
  public meeting: WritableSignal<Meeting | PastMeeting> = signal({} as Meeting | PastMeeting);
  public occurrence: WritableSignal<MeetingOccurrence | null> = signal(null);
  public registrantsLoading: WritableSignal<boolean> = signal(true);
  private refresh$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public registrants = this.initRegistrantsList();
  public pastMeetingParticipants = this.initPastMeetingParticipantsList();
  public registrantsLabel: Signal<string> = this.initRegistrantsLabel();
  public recording: WritableSignal<PastMeetingRecording | null> = signal(null);
  public recordingShareUrl: Signal<string | null> = computed(() => {
    const recording = this.recording();
    return recording ? this.getLargestSessionShareUrl(recording) : null;
  });
  public hasRecording: Signal<boolean> = computed(() => this.recordingShareUrl() !== null);
  public summary: WritableSignal<PastMeetingSummary | null> = signal(null);
  public summaryContent: Signal<string | null> = computed(() => {
    const summary = this.summary();
    return summary?.summary_data ? summary.summary_data.edited_content || summary.summary_data.content : null;
  });
  public summaryUid: Signal<string | null> = computed(() => this.summary()?.uid || null);
  public summaryApproved: Signal<boolean> = computed(() => this.summary()?.approved || false);
  public hasSummary: Signal<boolean> = computed(() => this.summaryContent() !== null);
  public additionalRegistrantsCount: WritableSignal<number> = signal(0);
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
  public readonly attendedCount: Signal<number> = this.initAttendedCount();
  public readonly notAttendedCount: Signal<number> = this.initNotAttendedCount();
  public readonly participantCount: Signal<number> = this.initParticipantCount();
  public readonly currentOccurrence: Signal<MeetingOccurrence | null> = this.initCurrentOccurrence();
  public readonly meetingStartTime: Signal<string | null> = this.initMeetingStartTime();

  public readonly meetingDeleted = output<void>();
  public readonly project = this.projectService.project;

  // Extract important links from description
  public readonly importantLinks = this.initImportantLinks();

  // Meeting attachments

  public constructor() {
    effect(() => {
      this.meeting.set(this.meetingInput());
      // Priority: explicit occurrenceInput > current occurrence for upcoming > null for past without input
      if (this.occurrenceInput()) {
        // If explicitly passed an occurrence, always use it
        this.occurrence.set(this.occurrenceInput()!);
      } else if (!this.pastMeeting()) {
        // For upcoming meetings without explicit occurrence, use current occurrence
        this.occurrence.set(this.currentOccurrence());
      } else {
        // For past meetings without occurrence input, set to null
        this.occurrence.set(null);
      }
    });
  }

  public ngOnInit(): void {
    this.attachments = this.initAttachments();
    this.initRecording();
    this.initSummary();
  }

  public onRegistrantsToggle(event: Event): void {
    event.stopPropagation();

    if (this.pastMeeting()) {
      // For past meetings, just show/hide participants
      this.registrantsLoading.set(true);

      if (!this.showRegistrants()) {
        this.refresh$.next(true);
      }

      this.showRegistrants.set(!this.showRegistrants());
      return;
    }

    if (this.meetingRegistrantCount() === 0) {
      // Open add registrant modal
      this.openAddRegistrantModal();
      return;
    }

    // Show/hide inline registrants display
    this.registrantsLoading.set(true);

    if (!this.showRegistrants()) {
      this.refresh$.next(true);
    }

    this.showRegistrants.set(!this.showRegistrants());
  }

  public openAddRegistrantModal(): void {
    const dialogRef = this.dialogService.open(RegistrantModalComponent, {
      header: 'Add Guests',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meetingId: this.meeting().uid,
        registrant: null, // Add mode
      },
    });

    dialogRef.onChildComponentLoaded.pipe(take(1)).subscribe((component) => {
      component.registrantSaved.subscribe(() => {
        this.refresh$.next(true);
      });
    });
  }

  public openCommitteeModal(): void {
    const header = this.meeting().committees && this.meeting().committees!.length > 0 ? 'Manage Committees' : 'Connect Committees';
    this.dialogService
      .open(MeetingCommitteeModalComponent, {
        header,
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

  public onRegistrantEdit(registrant: MeetingRegistrant, event: Event): void {
    event.stopPropagation();

    this.dialogService
      .open(RegistrantModalComponent, {
        header: registrant.type === 'committee' ? 'Committee Member' : 'Edit Guest',
        width: '650px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meetingId: this.meeting().uid,
          registrant: registrant,
          isCommitteeMember: registrant.type === 'committee',
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          // Refresh the current registrant display
          this.refresh$.next(true);
        }
      });
  }

  public copyMeetingLink(): void {
    const meetingUrl: URL = new URL(environment.urls.home + '/meetings/' + this.meeting().uid);
    meetingUrl.searchParams.set('password', this.meeting().password || '');
    this.clipboard.copy(meetingUrl.toString());
    this.messageService.add({
      severity: 'success',
      summary: 'Meeting Link Copied',
      detail: 'The meeting link has been copied to your clipboard',
    });
  }

  public openRecordingModal(): void {
    if (!this.recordingShareUrl()) {
      return;
    }

    this.dialogService.open(RecordingModalComponent, {
      header: 'Meeting Recording',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        shareUrl: this.recordingShareUrl(),
        meetingTitle: this.meeting().title,
      },
    });
  }

  public openSummaryModal(): void {
    if (!this.summaryContent() || !this.summaryUid()) {
      return;
    }

    const ref = this.dialogService.open(SummaryModalComponent, {
      header: 'Meeting Summary',
      width: '800px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        summaryContent: this.summaryContent(),
        summaryUid: this.summaryUid(),
        pastMeetingUid: this.meeting().uid,
        meetingTitle: this.meeting().title,
        approved: this.summaryApproved(),
      },
    });

    // Update local content and approval status when changes are made
    ref.onClose.pipe(take(1)).subscribe((result?: { updated: boolean; content: string; approved: boolean }) => {
      if (result && result.updated) {
        const currentSummary = this.summary();
        if (currentSummary) {
          this.summary.set({
            ...currentSummary,
            approved: result.approved,
            summary_data: {
              ...currentSummary.summary_data,
              edited_content: result.content,
            },
          });
        }
      }
    });
  }

  private getLargestSessionShareUrl(recording: PastMeetingRecording): string | null {
    if (!recording.sessions || recording.sessions.length === 0) {
      return null;
    }

    const largestSession = recording.sessions.reduce((largest, current) => {
      return current.total_size > largest.total_size ? current : largest;
    });

    return largestSession.share_url || null;
  }

  private initMeetingRegistrantCount(): Signal<number> {
    return computed(() => {
      if (this.pastMeeting()) {
        // For past meetings, show total participant count
        return this.meeting()?.participant_count || 0;
      }

      // For upcoming meetings, show registrant count
      return (this.meeting()?.individual_registrants_count || 0) + (this.meeting()?.committee_members_count || 0) + (this.additionalRegistrantsCount() || 0);
    });
  }

  private initRegistrantsLabel(): Signal<string> {
    return computed(() => {
      if (this.pastMeeting()) {
        const totalParticipants = this.meetingRegistrantCount();
        if (totalParticipants === 0) {
          return 'No Participants';
        }
        if (totalParticipants === 1) {
          return '1 Participant';
        }
        return `${totalParticipants} Participants`;
      }

      if (this.meetingRegistrantCount() === 0 && this.meeting()?.organizer) {
        return 'Add Guests';
      }

      const totalGuests = this.meetingRegistrantCount();

      if (totalGuests === 1) {
        return '1 Guest';
      }

      return `${totalGuests} Guests`;
    });
  }

  private initRegistrantResponseBreakdown(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return '';

      if (this.pastMeeting()) {
        // For past meetings, use counts from meeting object (calculated server-side)
        const invitedCount = meeting.individual_registrants_count || 0;
        const attendedCount = meeting.attended_count || 0;
        const totalParticipants = meeting.participant_count || 0;
        const didNotAttendCount = totalParticipants - attendedCount;

        const parts: string[] = [];

        // Show invited count if there were formal invitations
        if (invitedCount > 0) {
          parts.push(`${invitedCount} Invited`);
        }

        // Show attendance breakdown
        if (attendedCount > 0) parts.push(`${attendedCount} Attended`);
        if (didNotAttendCount > 0) parts.push(`${didNotAttendCount} Did Not Attend`);

        return parts.join(', ');
      }

      const accepted = meeting.registrants_accepted_count || 0;
      const declined = meeting.registrants_declined_count || 0;
      const pending = meeting.registrants_pending_count || 0;

      // Only show breakdown if there are individual registrants with responses
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

  private initRegistrantsList() {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && !this.pastMeeting()),
        switchMap(() => {
          this.registrantsLoading.set(true);
          return this.meetingService
            .getMeetingRegistrants(this.meeting().uid)
            .pipe(catchError(() => of([])))
            .pipe(
              map((registrants) => {
                return registrants;
              }),
              // Sort registrants by first name
              map((registrants) => registrants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingRegistrant[]),
              tap((registrants) => {
                const baseCount = (this.meeting().individual_registrants_count || 0) + (this.meeting().committee_members_count || 0);
                this.additionalRegistrantsCount.set(Math.max(0, (registrants?.length || 0) - baseCount));
              }),
              finalize(() => this.registrantsLoading.set(false))
            );
        })
      ),
      { initialValue: [] }
    );
  }

  private initPastMeetingParticipantsList() {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && this.pastMeeting()),
        switchMap(() => {
          this.registrantsLoading.set(true);
          return this.meetingService
            .getPastMeetingParticipants(this.meeting().uid)
            .pipe(catchError(() => of([])))
            .pipe(
              // Sort participants by first name
              map((participants) => participants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as PastMeetingParticipant[]),
              finalize(() => this.registrantsLoading.set(false))
            );
        })
      ),
      { initialValue: [] }
    );
  }

  private deleteMeeting(): void {
    const meeting = this.meeting();
    if (!meeting) return;

    // Check if meeting is recurring
    const isRecurring = !!meeting.recurrence;

    if (isRecurring) {
      // For recurring meetings, first show the delete type selection modal
      this.dialogService
        .open(MeetingDeleteTypeSelectionComponent, {
          header: 'Delete Recurring Meeting',
          width: '500px',
          modal: true,
          closable: true,
          dismissableMask: true,
          data: {
            meeting: meeting,
          },
        })
        .onClose.pipe(take(1))
        .subscribe((typeResult: MeetingDeleteTypeResult) => {
          if (typeResult) {
            if (typeResult.deleteType === 'occurrence') {
              // User wants to cancel just this occurrence
              this.showCancelOccurrenceModal(meeting);
            } else {
              // User wants to delete the entire series
              this.showDeleteMeetingModal(meeting);
            }
          }
        });
    } else {
      // For non-recurring meetings, show delete confirmation directly
      this.showDeleteMeetingModal(meeting);
    }
  }

  private showCancelOccurrenceModal(meeting: Meeting): void {
    // Prefer the explicitly selected/current occurrence; fallback to next active
    const occurrenceToCancel = this.occurrence() ?? getCurrentOrNextOccurrence(meeting);

    if (!occurrenceToCancel) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No upcoming occurrence found to cancel.',
      });
      return;
    }

    this.dialogService
      .open(MeetingCancelOccurrenceConfirmationComponent, {
        header: 'Cancel Occurrence',
        width: '450px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: meeting,
          occurrence: occurrenceToCancel,
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result: MeetingCancelOccurrenceResult) => {
        if (result?.confirmed) {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Meeting occurrence canceled successfully',
          });
          this.meetingDeleted.emit();
        } else if (result?.error) {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: result.error,
          });
        }
      });
  }

  private showDeleteMeetingModal(meeting: Meeting): void {
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
        if (result?.confirmed) {
          this.meetingDeleted.emit();
        }
      });
  }

  private initializeActionMenuItems(): Signal<MenuItem[]> {
    return computed(() => {
      const baseItems: MenuItem[] = [];

      // Only add Edit option for upcoming meetings
      if (!this.pastMeeting()) {
        if (this.meeting()?.organizer) {
          baseItems.push({
            label: 'Add Guests',
            icon: 'fa-light fa-plus',
            command: () => this.openAddRegistrantModal(),
          });

          baseItems.push({
            label: this.meeting().committees && this.meeting().committees!.length > 0 ? 'Manage Committees' : 'Connect Committees',
            icon: 'fa-light fa-people-group',
            command: () => this.openCommitteeModal(),
          });

          const projectSlug = this.project()?.slug;
          baseItems.push({
            label: 'Edit',
            icon: 'fa-light fa-edit',
            routerLink: ['/project', projectSlug, 'meetings', this.meeting().uid, 'edit'],
          });
        }

        baseItems.push({
          label: 'Join Meeting',
          icon: 'fa-light fa-calendar',
          routerLink: ['/meetings', this.meeting().uid],
          queryParams: {
            password: this.meeting().password,
          },
        });

        baseItems.push({
          separator: true,
        });
      }

      if (this.meeting()?.organizer) {
        // Add separator and delete option
        baseItems.push({
          label: 'Delete',
          icon: 'fa-light fa-trash',
          styleClass: 'text-red-600',
          command: () => this.deleteMeeting(),
        });
      }

      return baseItems;
    });
  }

  private refreshMeeting(): void {
    this.meetingService
      .getMeeting(this.meeting().uid)
      .pipe(
        take(1),
        tap((meeting) => {
          this.additionalRegistrantsCount.set(0);
          this.meeting.set(meeting);
        }),
        finalize(() => this.refresh$.next(true))
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

  private initRecording(): void {
    runInInjectionContext(this.injector, () => {
      toSignal(
        this.meetingService.getPastMeetingRecording(this.meetingInput().uid).pipe(
          catchError(() => of(null)),
          tap((recording) => this.recording.set(recording))
        ),
        { initialValue: null }
      );
    });
  }

  private initSummary(): void {
    runInInjectionContext(this.injector, () => {
      toSignal(
        this.meetingService.getPastMeetingSummary(this.meetingInput().uid).pipe(
          catchError(() => of(null)),
          tap((summary) => this.summary.set(summary))
        ),
        { initialValue: null }
      );
    });
  }

  private initAttendancePercentage(): Signal<number> {
    return computed(() => {
      if (this.pastMeeting()) {
        // For past meetings, calculate attendance percentage from meeting object counts
        const totalParticipants = this.meeting()?.participant_count || 0;
        const attendedCount = this.meeting()?.attended_count || 0;
        return totalParticipants > 0 ? Math.round((attendedCount / totalParticipants) * 100) : 0;
      }

      const totalRegistrants = this.meetingRegistrantCount();
      const acceptedCount = this.meeting().registrants_accepted_count || 0;
      return totalRegistrants > 0 ? Math.round((acceptedCount / totalRegistrants) * 100) : 0;
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

  private initAttendedCount(): Signal<number> {
    return computed(() => {
      if (!this.pastMeeting()) return 0;
      // Use the attended_count from the meeting object (calculated server-side)
      return this.meeting()?.attended_count || 0;
    });
  }

  private initNotAttendedCount(): Signal<number> {
    return computed(() => {
      if (!this.pastMeeting()) return 0;
      // Calculate not attended as total participants minus attended
      const totalParticipants = this.meeting()?.participant_count || 0;
      const attendedCount = this.meeting()?.attended_count || 0;
      return totalParticipants - attendedCount;
    });
  }

  private initParticipantCount(): Signal<number> {
    return computed(() => {
      if (!this.pastMeeting()) return 0;
      return this.meeting()?.participant_count || 0;
    });
  }

  private initCurrentOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      const meeting = this.meeting();
      return getCurrentOrNextOccurrence(meeting);
    });
  }

  private initMeetingStartTime(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();

      if (!this.pastMeeting()) {
        // For upcoming meetings, use current occurrence (next upcoming occurrence) or meeting start_time
        const currentOccurrence = this.occurrence();
        if (currentOccurrence?.start_time) {
          return currentOccurrence.start_time;
        }
        if (meeting?.start_time) {
          return meeting.start_time;
        }
      } else {
        // For past meetings, use occurrence input or fallback to scheduled_start_time/start_time
        const occurrence = this.occurrence();
        if (occurrence?.start_time) {
          return occurrence.start_time;
        }
        if (meeting?.start_time) {
          return meeting.start_time;
        }
        // Handle past meetings that use scheduled_start_time (type-safe check)
        if ('scheduled_start_time' in meeting && meeting.scheduled_start_time) {
          return meeting.scheduled_start_time;
        }
      }

      return null;
    });
  }
}
