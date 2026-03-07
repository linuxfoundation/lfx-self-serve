// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { NgClass } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, OnInit, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  MeetingDeleteConfirmationComponent,
  MeetingDeleteResult,
} from '@app/modules/meetings/components/meeting-delete-confirmation/meeting-delete-confirmation.component';
import {
  MeetingDeleteTypeResult,
  MeetingDeleteTypeSelectionComponent,
} from '@app/modules/meetings/components/meeting-delete-type-selection/meeting-delete-type-selection.component';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  COMMITTEE_LABEL,
  extractUrls,
  getCurrentOrNextOccurrence,
  Meeting,
  MeetingAttachment,
  MeetingCancelOccurrenceResult,
  MeetingOccurrence,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
  TagSeverity,
  UrlMetadata,
} from '@lfx-one/shared';
import { RecordingModalComponent } from '@modules/meetings/components/recording-modal/recording-modal.component';
import { SummaryModalComponent } from '@modules/meetings/components/summary-modal/summary-modal.component';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, Observable, of, switchMap, take, tap } from 'rxjs';

import { CancelOccurrenceConfirmationComponent } from '../../components/cancel-occurrence-confirmation/cancel-occurrence-confirmation.component';
import { MeetingRsvpDetailsComponent } from '../../components/meeting-rsvp-details/meeting-rsvp-details.component';
import { PublicRegistrationModalComponent } from '../../components/public-registration-modal/public-registration-modal.component';

@Component({
  selector: 'lfx-meeting-card',
  imports: [
    NgClass,
    ButtonComponent,
    TagComponent,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    TooltipModule,
    AnimateOnScrollModule,
    ConfirmDialogModule,
    DrawerModule,
    ExpandableTextComponent,
    LinkifyPipe,
    ClipboardModule,
    RsvpButtonGroupComponent,
    MeetingRsvpDetailsComponent,
    MeetingRegistrantsDisplayComponent,
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
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  public readonly meetingInput = input.required<Meeting | PastMeeting>();
  public readonly occurrenceInput = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly showBorder = input<boolean>(false);

  public showRegistrants: WritableSignal<boolean> = signal(false);
  public showMyRsvp: WritableSignal<boolean> = signal(false);
  public meeting: WritableSignal<Meeting | PastMeeting> = signal({} as Meeting | PastMeeting);
  public occurrence: WritableSignal<MeetingOccurrence | null> = signal(null);
  public recording: WritableSignal<PastMeetingRecording | null> = signal(null);
  public summary: WritableSignal<PastMeetingSummary | null> = signal(null);
  public additionalRegistrantsCount: WritableSignal<number> = signal(0);
  public attachments: Signal<(MeetingAttachment | PastMeetingAttachment)[]> = signal([]);

  // Computed values for template
  public readonly meetingRegistrantCount: Signal<number> = this.initMeetingRegistrantCount();
  public readonly summaryContent: Signal<string | null> = this.initSummaryContent();
  public readonly summaryApproved: Signal<boolean> = this.initSummaryApproved();
  public readonly hasSummary: Signal<boolean> = this.initHasSummary();
  public readonly attendancePercentage: Signal<number> = this.initAttendancePercentage();
  public readonly recordingShareUrl: Signal<string | null> = this.initRecordingShareUrl();
  public readonly hasRecording: Signal<boolean> = this.initHasRecording();
  public readonly attendanceBarColor: Signal<string> = this.initAttendanceBarColor();
  public readonly totalResourcesCount: Signal<number> = this.initTotalResourcesCount();
  public readonly enabledFeaturesCount: Signal<number> = this.initEnabledFeaturesCount();
  public readonly meetingTypeBadge: Signal<{
    badgeClass: string;
    severity: TagSeverity;
    icon?: string;
    text: string;
  } | null> = this.initMeetingTypeBadge();
  public readonly containerClass: Signal<string> = this.initContainerClass();
  public readonly attendedCount: Signal<number> = this.initAttendedCount();
  public readonly notAttendedCount: Signal<number> = this.initNotAttendedCount();
  public readonly participantCount: Signal<number> = this.initParticipantCount();
  public readonly currentOccurrence: Signal<MeetingOccurrence | null> = this.initCurrentOccurrence();
  public readonly meetingStartTime: Signal<string | null> = this.initMeetingStartTime();
  public readonly canJoinMeeting: Signal<boolean> = this.initCanJoinMeeting();
  public readonly joinUrl: Signal<string | null>;
  public readonly authenticated: Signal<boolean> = this.userService.authenticated;

  public readonly meetingDetailUrl: Signal<string> = this.initMeetingDetailUrl();

  // Computed signals for invited/registration status to ensure reactivity after registration
  public readonly isInvited: Signal<boolean> = computed(() => this.meeting().invited ?? false);
  public readonly canRegisterForMeeting: Signal<boolean> = computed(
    () => !this.isInvited() && !this.meeting().restricted && this.meeting().visibility === 'public'
  );
  // Computed signal to check if user can toggle between RSVP Details and RSVP Button Group
  // True when user is both an organizer AND invited to the meeting (for non-past meetings)
  public readonly canToggleRsvpView: Signal<boolean> = computed(() => !!this.meeting().organizer && this.isInvited() && !this.pastMeeting());

  public readonly meetingTitle: Signal<string> = this.initMeetingTitle();
  public readonly meetingDescription: Signal<string> = this.initMeetingDescription();
  public readonly resolvedResources: Signal<UrlMetadata[]> = this.initResolvedResources();
  public readonly hasAiCompanion: Signal<boolean> = this.initHasAiCompanion();
  public readonly joinQueryParams: Signal<Record<string, string>> = this.initJoinQueryParams();

  public readonly meetingDeleted = output<void>();
  public readonly project = this.projectService.project;
  public readonly committeeLabel = COMMITTEE_LABEL;

  public constructor() {
    effect(() => {
      if (!this.meeting()?.id) {
        this.meeting.set(this.meetingInput());
      }
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

    // Initialize join URL stream
    const meeting$ = toObservable(this.meetingInput);
    const occurrence$ = toObservable(this.occurrence);
    const user$ = toObservable(this.userService.user);
    const authenticated$ = toObservable(this.userService.authenticated);
    const pastMeeting$ = toObservable(this.pastMeeting);

    const joinUrl$ = combineLatest([meeting$, occurrence$, user$, authenticated$, pastMeeting$]).pipe(
      switchMap(([meeting, occurrence, user, authenticated, isPastMeeting]) => {
        if (!meeting.id || isPastMeeting || !canJoinMeeting(meeting, occurrence) || (meeting.restricted && !meeting.invited)) {
          return of(null);
        }

        // Use public_link directly if available (e.g. for legacy meetings with link from query service)
        if (meeting.public_link) {
          return of(meeting.public_link);
        }

        // Otherwise fetch join URL from API for authenticated users
        if (authenticated && user?.email) {
          return this.meetingService.getPublicMeetingJoinUrl(meeting.id, meeting.password, { email: user.email }).pipe(
            map((res) => buildJoinUrlWithParams(res.link, user)),
            catchError(() => of(null))
          );
        }
        return of(null);
      })
    );

    this.joinUrl = toSignal(joinUrl$, { initialValue: null });
  }

  public ngOnInit(): void {
    this.attachments = this.initAttachments();
    if (this.pastMeeting()) {
      this.initRecording();
      this.initSummary();
    }
  }

  public onRegistrantsToggle(): void {
    if (this.meetingRegistrantCount() === 0 && !this.pastMeeting()) {
      this.router.navigate(['/meetings', this.meeting().id, 'edit'], {
        queryParams: { step: '5' },
      });
      return;
    }

    this.showRegistrants.set(!this.showRegistrants());
  }

  public onRsvpViewToggle(): void {
    this.showMyRsvp.set(!this.showMyRsvp());
  }

  public onDrawerHide(): void {
    this.showRegistrants.set(false);
  }

  public copyMeetingLink(): void {
    const meeting = this.meeting();
    const meetingUrl: URL = new URL(environment.urls.home + '/meetings/' + meeting.id);

    if (meeting.password) {
      meetingUrl.searchParams.set('password', meeting.password);
    }

    this.clipboard.copy(meetingUrl.toString());
    this.messageService.add({
      severity: 'success',
      summary: 'Meeting Link Copied',
      detail: 'The meeting link has been copied to your clipboard',
    });
  }

  public registerForMeeting(): void {
    const meeting = this.meeting();
    const user = this.userService.user();

    const dialogRef = this.dialogService.open(PublicRegistrationModalComponent, {
      header: 'Register for Meeting',
      width: '500px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meetingId: meeting.id,
        meetingTitle: this.meetingTitle(),
        user: user,
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: { registered: boolean } | undefined) => {
      if (result?.registered) {
        this.additionalRegistrantsCount.set(this.additionalRegistrantsCount() + 1);
        this.refreshMeeting();
      }
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
    if (!this.summaryContent() || !this.summary()?.uid) {
      return;
    }

    const ref = this.dialogService.open(SummaryModalComponent, {
      header: 'Meeting Summary',
      width: '800px',
      modal: false,
      closable: false,
      dismissableMask: false,
      data: {
        summaryContent: this.summaryContent(),
        summaryUid: this.summary()?.uid,
        pastMeetingUid: this.meeting().id,
        meetingTitle: this.meetingTitle(),
        approved: this.summaryApproved(),
      },
    }) as DynamicDialogRef;

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

  public deleteMeeting(): void {
    const meeting = this.meeting();
    if (!meeting) return;

    // Check if meeting is recurring
    const isRecurring = !!meeting.recurrence;

    if (isRecurring) {
      // For recurring meetings, first show the delete type selection modal
      const dialogRef = this.dialogService.open(MeetingDeleteTypeSelectionComponent, {
        header: 'Delete Recurring Meeting',
        width: '500px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meeting: meeting,
        },
      }) as DynamicDialogRef;

      dialogRef.onClose.pipe(take(1)).subscribe((typeResult: MeetingDeleteTypeResult) => {
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

    const dialogRef = this.dialogService.open(CancelOccurrenceConfirmationComponent, {
      header: 'Cancel Occurrence',
      width: '450px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meeting: meeting,
        occurrence: occurrenceToCancel,
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: MeetingCancelOccurrenceResult) => {
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
    const dialogRef = this.dialogService.open(MeetingDeleteConfirmationComponent, {
      header: 'Delete Meeting',
      width: '450px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meeting: meeting,
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: MeetingDeleteResult) => {
      if (result?.confirmed) {
        this.meetingDeleted.emit();
      }
    });
  }

  private refreshMeeting(): void {
    this.meetingService
      .getMeeting(this.meeting().id)
      .pipe(
        take(1),
        tap((meeting) => {
          this.additionalRegistrantsCount.set(0);
          this.meeting.set(meeting);
        })
      )
      .subscribe();
  }

  private initAttachments(): Signal<(MeetingAttachment | PastMeetingAttachment)[]> {
    return runInInjectionContext(this.injector, () => {
      const id = this.meetingInput().id;
      const attachments$: Observable<(MeetingAttachment | PastMeetingAttachment)[]> = this.pastMeeting()
        ? this.meetingService.getPastMeetingAttachments(id)
        : this.meetingService.getMeetingAttachments(id);

      return toSignal(attachments$.pipe(catchError(() => of([] as (MeetingAttachment | PastMeetingAttachment)[]))), {
        initialValue: [],
      });
    });
  }

  private initRecording(): void {
    runInInjectionContext(this.injector, () => {
      toSignal(
        this.meetingService.getPastMeetingRecording(this.meetingInput().id).pipe(
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
        this.meetingService.getPastMeetingSummary(this.meetingInput().id).pipe(
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
      return 'bg-emerald-500';
    });
  }

  private initTotalResourcesCount(): Signal<number> {
    return computed(() => {
      return this.resolvedResources().length;
    });
  }

  private initEnabledFeaturesCount(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      return (
        (meeting.recording_enabled ? 1 : 0) +
        (meeting.transcript_enabled ? 1 : 0) +
        (meeting.youtube_upload_enabled ? 1 : 0) +
        (meeting.visibility === 'public' ? 1 : 0)
      );
    });
  }

  private initMeetingTypeBadge(): Signal<{
    badgeClass: string;
    severity: TagSeverity;
    icon?: string;
    text: string;
  } | null> {
    return computed(() => {
      const meetingType = this.meeting().meeting_type;
      if (!meetingType) return null;

      const type = meetingType.toLowerCase();

      switch (type) {
        case 'board':
          return { badgeClass: 'bg-red-100 text-red-500', severity: 'danger', icon: 'fa-light fa-user-check', text: meetingType };
        case 'maintainers':
          return { badgeClass: 'bg-blue-100 text-blue-500', severity: 'info', icon: 'fa-light fa-gear', text: meetingType };
        case 'marketing':
          return { badgeClass: 'bg-emerald-100 text-emerald-500', severity: 'success', icon: 'fa-light fa-chart-line-up', text: meetingType };
        case 'technical':
          return { badgeClass: 'bg-violet-100 text-violet-500', severity: 'secondary', icon: 'fa-light fa-code', text: meetingType };
        case 'legal':
          return { badgeClass: 'bg-amber-100 text-amber-500', severity: 'warn', icon: 'fa-light fa-scale-balanced', text: meetingType };
        default:
          return { badgeClass: 'bg-gray-100 text-gray-400', severity: 'secondary', icon: 'fa-light fa-calendar-days', text: meetingType };
      }
    });
  }

  private initContainerClass(): Signal<string> {
    return computed(() => {
      if (!this.showBorder()) {
        return '';
      }

      return 'bg-white rounded-xl border-0 shadow-md';
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

  private initCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      if (this.pastMeeting()) {
        return false;
      }

      const meeting = this.meeting();

      // Restricted meetings require the user to be invited
      if (meeting.restricted && !meeting.invited) {
        return false;
      }

      return canJoinMeeting(meeting, this.occurrence());
    });
  }

  private initRecordingShareUrl(): Signal<string | null> {
    return computed(() => {
      const recording = this.recording();
      return recording ? this.getLargestSessionShareUrl(recording) : null;
    });
  }

  private initHasRecording(): Signal<boolean> {
    return computed(() => this.recordingShareUrl() !== null);
  }

  private initSummaryContent(): Signal<string | null> {
    return computed(() => {
      const summary = this.summary();
      if (!summary?.summary_data) return null;
      return summary.summary_data.edited_content || summary.summary_data.content;
    });
  }

  private initSummaryApproved(): Signal<boolean> {
    return computed(() => this.summary()?.approved || false);
  }

  private initHasSummary(): Signal<boolean> {
    return computed(() => this.summaryContent() !== null);
  }

  private initMeetingDetailUrl(): Signal<string> {
    return computed(() => {
      const meeting = this.meetingInput();
      const params = new URLSearchParams();

      if (meeting.password) {
        params.set('password', meeting.password);
      }

      const queryString = params.toString();
      return queryString ? `/meetings/${meeting.id}?${queryString}` : `/meetings/${meeting.id}`;
    });
  }

  private initMeetingTitle(): Signal<string> {
    return computed(() => {
      const occurrence = this.occurrence();
      const meeting = this.meeting();
      return occurrence?.title || meeting.title || '';
    });
  }

  private initMeetingDescription(): Signal<string> {
    return computed(() => {
      const occurrence = this.occurrence();
      const meeting = this.meeting();
      return occurrence?.description || meeting.description || '';
    });
  }

  private initResolvedResources(): Signal<UrlMetadata[]> {
    return toSignal(
      toObservable(this.meetingDescription).pipe(
        map((description) => extractUrls(description)),
        switchMap((urls) => {
          if (urls.length === 0) {
            return of([]);
          }
          return this.meetingService.resolveUrlMetadata(urls);
        }),
        catchError(() => of([] as UrlMetadata[]))
      ),
      { initialValue: [] }
    );
  }

  private initHasAiCompanion(): Signal<boolean> {
    return computed(() => {
      return this.meeting().zoom_config?.ai_companion_enabled || false;
    });
  }

  private initJoinQueryParams(): Signal<Record<string, string>> {
    return computed(() => {
      const meeting = this.meetingInput();
      const params: Record<string, string> = {};

      if (meeting.password) {
        params['password'] = meeting.password;
      }

      return params;
    });
  }
}
