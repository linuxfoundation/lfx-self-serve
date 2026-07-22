// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { NgClass } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  OnInit,
  output,
  runInInjectionContext,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';

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
  resolveMeetingBaseCount,
  DEFAULT_MEETING_TYPE_CONFIG,
  getCurrentOrNextOccurrence,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingTranscriptUrl,
  getUpcomingMeetingStartTime,
  isPastMeetingSummaryAwaitingApproval,
  isPastMeetingSummaryVisible,
  Meeting,
  MeetingAttachment,
  MeetingCancelOccurrenceResult,
  MeetingOccurrence,
  MeetingRecurrence,
  MEETING_TYPE_CONFIGS,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
  PastMeetingTranscript,
  resolveOccurrenceRecurrence,
  TagSeverity,
} from '@lfx-one/shared';
import { RecordingModalComponent } from '@components/recording-modal/recording-modal.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
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
import { BehaviorSubject, catchError, combineLatest, filter, map, of, pairwise, switchMap, take, tap, timer } from 'rxjs';

import { CancelOccurrenceConfirmationComponent } from '../../components/cancel-occurrence-confirmation/cancel-occurrence-confirmation.component';
import { MeetingMaterialsDrawerComponent } from '../meeting-materials-drawer/meeting-materials-drawer.component';
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
    MeetingMaterialsDrawerComponent,
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

  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshAttachments$ = new BehaviorSubject<void>(undefined);

  public readonly meetingInput = input.required<Meeting | PastMeeting>();
  public readonly occurrenceInput = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly showBorder = input<boolean>(false);

  public showRegistrants: WritableSignal<boolean> = signal(false);
  public showMyRsvp: WritableSignal<boolean> = signal(false);
  // Set by <lfx-meeting-rsvp-details> after it resolves its registrants/rsvps data.
  // Drives the "Set My RSVP" / "Update My RSVP" label on the toggle button.
  public userHasRsvp: WritableSignal<boolean> = signal(false);
  public meeting: WritableSignal<Meeting | PastMeeting> = signal({} as Meeting | PastMeeting);
  public occurrence: WritableSignal<MeetingOccurrence | null> = signal(null);
  public recording: WritableSignal<PastMeetingRecording | null> = signal(null);
  public summary: WritableSignal<PastMeetingSummary | null> = signal(null);
  public transcript: WritableSignal<PastMeetingTranscript | null> = signal(null);
  public additionalRegistrantsCount: WritableSignal<number> = signal(0);
  public drawerGuestCount: WritableSignal<number> = signal(0);
  public attachments: Signal<(MeetingAttachment | PastMeetingAttachment)[]> = signal([]);
  public materialsDrawerVisible = signal(false);

  // Computed values for template
  public readonly summaryContent: Signal<string | null> = this.initSummaryContent();
  public readonly summaryApproved: Signal<boolean> = this.initSummaryApproved();
  public readonly summaryVisible: Signal<boolean> = this.initSummaryVisible();
  public readonly summaryAwaitingApproval: Signal<boolean> = this.initSummaryAwaitingApproval();
  public readonly hasSummary: Signal<boolean> = this.initHasSummary();
  public readonly recordingShareUrl: Signal<string | null> = this.initRecordingShareUrl();
  public readonly hasRecording: Signal<boolean> = this.initHasRecording();
  public readonly totalResourcesCount: Signal<number> = this.initTotalResourcesCount();
  public readonly enabledFeaturesCount: Signal<number> = this.initEnabledFeaturesCount();
  public readonly meetingTypeBadge: Signal<{
    severity: TagSeverity;
    styleClass: string;
    icon?: string;
    text: string;
  } | null> = this.initMeetingTypeBadge();
  public readonly containerClass: Signal<string> = this.initContainerClass();
  public readonly rsvpToggleLabel: Signal<string> = this.initRsvpToggleLabel();
  public readonly currentOccurrence: Signal<MeetingOccurrence | null> = this.initCurrentOccurrence();
  // Recurrence rule that drives the cadence badge: the displayed occurrence's own override
  // when present (cadence changed at/after it — LFXV2-2112), otherwise the series rule.
  public readonly displayRecurrence: Signal<MeetingRecurrence | null> = computed(() => resolveOccurrenceRecurrence(this.meeting(), this.currentOccurrence()));
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
  public readonly guestCount: Signal<number> = this.initGuestCount();

  public readonly meetingTitle: Signal<string> = this.initMeetingTitle();
  public readonly meetingDescription: Signal<string> = this.initMeetingDescription();
  public readonly hasAiCompanion: Signal<boolean> = this.initHasAiCompanion();
  public readonly hasTranscript: Signal<boolean> = this.initHasTranscript();
  // For past meetings the recording / transcript / AI-summary badges should reflect
  // real availability (content exists), not just that the feature was enabled —
  // otherwise a badge shows while no corresponding content/button does. Upcoming
  // meetings keep the feature-flag meaning ("this meeting will record/transcribe/summarize").
  public readonly showRecordingBadge: Signal<boolean> = computed(() => (this.pastMeeting() ? this.hasRecording() : !!this.meeting().recording_enabled));
  public readonly showTranscriptBadge: Signal<boolean> = computed(() => (this.pastMeeting() ? this.hasTranscript() : !!this.meeting().transcript_enabled));
  public readonly showAiSummaryBadge: Signal<boolean> = computed(() => (this.pastMeeting() ? this.hasSummary() : this.hasAiCompanion()));
  public readonly joinQueryParams: Signal<Record<string, string>> = this.initJoinQueryParams();
  protected readonly pastMeetingResourceId: Signal<string> = computed(() => getPastMeetingResourceId(this.meeting()));
  public readonly editQueryParams: Signal<Record<string, string>> = computed(() => {
    const meeting = this.meeting();
    const params: Record<string, string> = {};
    if (meeting.project_slug) params['project'] = meeting.project_slug;
    const committeeUid = meeting.committees?.[0]?.uid;
    if (committeeUid) params['committee_uid'] = committeeUid;
    return params;
  });

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

    // Reload attachments when materials drawer closes (true → false transition)
    toObservable(this.materialsDrawerVisible)
      .pipe(
        pairwise(),
        filter(([prev, curr]) => prev && !curr),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.refreshAttachments$.next());
  }

  public ngOnInit(): void {
    this.attachments = this.initAttachments();
    if (this.pastMeeting()) {
      this.initRecording();
      this.initSummary();
      this.initTranscript();
    }
  }

  public onRegistrantsToggle(): void {
    this.showRegistrants.set(!this.showRegistrants());
  }

  public onRsvpViewToggle(): void {
    this.showMyRsvp.set(!this.showMyRsvp());
  }

  public openMaterialsDrawer(): void {
    this.materialsDrawerVisible.set(true);
  }

  public onMaterialsChanged(): void {
    this.refreshAttachments$.next();
    timer(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshAttachments$.next());
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

  public downloadAttachment(attachment: MeetingAttachment | PastMeetingAttachment): void {
    const meetingId = this.pastMeeting() ? getPastMeetingResourceId(this.meeting()) : this.meeting().id;
    const download$ = this.pastMeeting()
      ? this.meetingService.getPastMeetingAttachmentDownloadUrl(meetingId, attachment.uid)
      : this.meetingService.getMeetingAttachmentDownloadUrl(meetingId, attachment.uid);

    download$.pipe(take(1)).subscribe({
      next: (res) => {
        const newWindow = window.open(res.download_url, '_blank', 'noopener');
        if (newWindow) {
          newWindow.opener = null;
        }
      },
      error: () =>
        this.messageService.add({
          severity: 'error',
          summary: 'Download Failed',
          detail: 'Unable to download the attachment. Please try again.',
        }),
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
    // Keep the action guard identical to the banner's render condition
    // (hasSummary() === !!summaryContent()) so the "Review Summary" button is
    // never visible-but-inert. The modal only needs content to open; the summary
    // uid is required solely for the edit/approve write path.
    if (!this.summaryContent()) {
      return;
    }

    const summaryUid = this.summary()?.uid ?? '';

    this.dialogService.open(SummaryModalComponent, {
      header: 'Meeting Summary',
      width: '800px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        summaryContent: this.summaryContent(),
        summaryUid,
        pastMeetingUid: getPastMeetingResourceId(this.meeting()),
        meetingTitle: this.meetingTitle(),
        approved: this.summaryApproved(),
        // Edit/Approve write back via the summary uid; without one the modal
        // opens read-only so its actions are never visible-but-inert.
        readOnly: !summaryUid,
        // Sync the card the moment an edit/approve succeeds — not on dialog close.
        // The dialog's onClose payload is only built by the "Close" button, so an
        // X or backdrop dismiss left the card stale (e.g. approved summary kept
        // showing the "Review Summary" banner).
        onSummaryUpdated: (update: { content: string; approved: boolean }) => this.applySummaryUpdate(update),
      },
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

  private applySummaryUpdate(update: { content: string; approved: boolean }): void {
    const currentSummary = this.summary();
    if (!currentSummary) {
      return;
    }

    this.summary.set({
      ...currentSummary,
      approved: update.approved,
      summary_data: {
        ...currentSummary.summary_data,
        edited_content: update.content,
      },
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
          this.drawerGuestCount.set(0);
          this.meeting.set(meeting);
        })
      )
      .subscribe();
  }

  private initAttachments(): Signal<(MeetingAttachment | PastMeetingAttachment)[]> {
    return runInInjectionContext(this.injector, () => {
      const id = this.pastMeeting() ? getPastMeetingResourceId(this.meetingInput()) : this.meetingInput().id;
      const attachments$ = this.pastMeeting() ? this.meetingService.getPastMeetingAttachments(id) : this.meetingService.getMeetingAttachments(id);

      return toSignal(
        this.refreshAttachments$.pipe(switchMap(() => attachments$.pipe(catchError(() => of([] as (MeetingAttachment | PastMeetingAttachment)[]))))),
        { initialValue: [] }
      );
    });
  }

  private initRecording(): void {
    runInInjectionContext(this.injector, () => {
      const pastMeetingId = getPastMeetingResourceId(this.meetingInput());
      toSignal(
        this.meetingService.getPastMeetingRecording(pastMeetingId).pipe(
          catchError(() => of(null)),
          tap((recording) => this.recording.set(recording))
        ),
        { initialValue: null }
      );
    });
  }

  private initSummary(): void {
    runInInjectionContext(this.injector, () => {
      const pastMeetingId = getPastMeetingResourceId(this.meetingInput());
      toSignal(
        this.meetingService.getPastMeetingSummary(pastMeetingId).pipe(
          catchError(() => of(null)),
          tap((summary) => this.summary.set(summary))
        ),
        { initialValue: null }
      );
    });
  }

  private initTranscript(): void {
    runInInjectionContext(this.injector, () => {
      const pastMeetingId = getPastMeetingResourceId(this.meetingInput());
      toSignal(
        this.meetingService.getPastMeetingTranscript(pastMeetingId).pipe(
          catchError(() => of(null)),
          tap((transcript) => this.transcript.set(transcript))
        ),
        { initialValue: null }
      );
    });
  }

  private initTotalResourcesCount(): Signal<number> {
    return computed(() => {
      return this.attachments().length;
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
    severity: TagSeverity;
    styleClass: string;
    icon?: string;
    text: string;
  } | null> {
    return computed(() => {
      const meetingType = this.meeting().meeting_type;
      if (!meetingType) return null;

      const type = meetingType.toLowerCase();
      const config = MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG;

      return {
        severity: 'secondary' as TagSeverity,
        styleClass: config.tagStyleClass,
        icon: config.icon,
        text: meetingType,
      };
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

  private initRsvpToggleLabel(): Signal<string> {
    return computed(() => {
      if (this.showMyRsvp()) return 'Show Guests';
      if (this.userHasRsvp()) return 'Update My RSVP';
      return 'Set My RSVP';
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
        // For upcoming meetings prefer the resolved current/next occurrence, then the
        // upstream-computed next-occurrence start, and only then the series origin. Falling
        // straight to meeting.start_time made recurring cards show the first/created date when
        // the list payload's occurrences array wasn't usable (LFXV2-2054).
        return getUpcomingMeetingStartTime(meeting, this.occurrence());
      }

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
      return recording ? getLargestSessionShareUrl(recording) : null;
    });
  }

  private initHasRecording(): Signal<boolean> {
    return computed(() => this.recordingShareUrl() !== null);
  }

  private initHasTranscript(): Signal<boolean> {
    return computed(() => getPastMeetingTranscriptUrl(this.transcript()) !== null);
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

  // Visible to all viewers once approved, or whenever the meeting never required
  // approval — only a requires-approval summary that isn't approved stays hidden.
  private initSummaryVisible(): Signal<boolean> {
    return computed(() => isPastMeetingSummaryVisible(this.summary()));
  }

  // Drives the organizer-only review banner: requires approval and not yet approved.
  private initSummaryAwaitingApproval(): Signal<boolean> {
    return computed(() => isPastMeetingSummaryAwaitingApproval(this.summary()));
  }

  private initHasSummary(): Signal<boolean> {
    // Require real content: a summary record can exist with empty content (no AI
    // result yet), which is not actionable — the review banner and "See AI Summary"
    // button must not render for it (otherwise the modal opens to "No summary
    // content available"). Empty string and null both mean "nothing to review".
    return computed(() => !!this.summaryContent());
  }

  private initMeetingDetailUrl(): Signal<string> {
    return computed(() => {
      const meeting = this.meetingInput();

      if (this.pastMeeting()) {
        return `/meetings/${getPastMeetingResourceId(meeting)}`;
      }

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

  private initHasAiCompanion(): Signal<boolean> {
    return computed(() => {
      return this.meeting().ai_summary_enabled || false;
    });
  }

  private initGuestCount(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      const meetingBaseCount = resolveMeetingBaseCount(meeting) ?? 0;
      const meetingTotalCount = meetingBaseCount + this.additionalRegistrantsCount();
      return Math.max(meetingTotalCount, this.drawerGuestCount());
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
