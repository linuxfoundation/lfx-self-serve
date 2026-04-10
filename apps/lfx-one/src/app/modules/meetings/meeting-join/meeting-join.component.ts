// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { HeaderComponent } from '@components/header/header.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  DEFAULT_MEETING_TYPE_CONFIG,
  getCurrentOrNextOccurrence,
  hasMeetingEnded,
  Meeting,
  MeetingAttachment,
  MeetingOccurrence,
  MeetingResourceItem,
  MEETING_TYPE_CONFIGS,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
  Project,
  TagSeverity,
  User,
} from '@lfx-one/shared';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, combineLatest, debounceTime, EMPTY, filter, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { GuestFormComponent } from '../components/guest-form/guest-form.component';
import { MeetingRsvpDetailsComponent } from '../components/meeting-rsvp-details/meeting-rsvp-details.component';
import { PublicRegistrationModalComponent } from '../components/public-registration-modal/public-registration-modal.component';

@Component({
  selector: 'lfx-meeting-join',
  imports: [
    ClipboardModule,
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    TagComponent,
    RsvpButtonGroupComponent,
    MeetingRsvpDetailsComponent,
    MeetingRegistrantsDisplayComponent,
    GuestFormComponent,
    ToastModule,
    TooltipModule,
    DrawerModule,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    LinkifyPipe,
    ExpandableTextComponent,
    HeaderComponent,
    MarkdownRendererComponent,
    DynamicDialogModule,
    FileSizePipe,
  ],
  providers: [],
  templateUrl: './meeting-join.component.html',
})
export class MeetingJoinComponent {
  // Injected services
  private readonly messageService = inject(MessageService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly clipboard = inject(Clipboard);
  private readonly dialogService = inject(DialogService);

  // Class variables with types
  public authenticated: WritableSignal<boolean>;
  public user: Signal<User | null> = this.userService.user;
  public joinForm: FormGroup;
  public project: WritableSignal<Project | null> = signal<Project | null>(null);
  public meeting: Signal<Meeting & { project: Project }>;
  public currentOccurrence: Signal<MeetingOccurrence | null>;
  public meetingTypeBadge: Signal<{
    severity: TagSeverity;
    styleClass: string;
    icon?: string;
    text: string;
  } | null>;
  public returnTo: Signal<string | undefined>;
  public password: WritableSignal<string | null> = signal<string | null>(null);
  public canJoinMeeting: Signal<boolean>;
  public fetchedJoinUrl: Signal<string | undefined>;
  public isLoadingJoinUrl: WritableSignal<boolean> = signal<boolean>(false);
  public joinUrlError: WritableSignal<string | null> = signal<string | null>(null);
  public attachments: Signal<MeetingAttachment[]>;
  public messageSeverity: Signal<'success' | 'info' | 'warn'>;
  public messageIcon: Signal<string>;
  public alertMessage: Signal<string>;
  private hasAutoJoined: WritableSignal<boolean> = signal<boolean>(false);
  public showRegistrants: WritableSignal<boolean> = signal<boolean>(false);
  public showGuestForm: WritableSignal<boolean> = signal<boolean>(false);
  // Tracks whether the meeting was loaded via the past-meetings API (occurrence ID in URL).
  // Distinct from isPastMeeting (time-based): isPastMeeting drives UI state (banner, RSVP guards),
  // while loadedViaPastMeetingId gates which API endpoints to call for data (summary, recording, attachments).
  protected loadedViaPastMeetingId = signal(false);
  protected pastMeetingFullAccess = signal(false);
  private refreshTrigger$ = new BehaviorSubject<void>(undefined);
  public emailError: Signal<boolean>;

  public meetingTitle: Signal<string>;
  public meetingDescription: Signal<string>;
  public hasAiCompanion: Signal<boolean>;
  protected isPastMeeting: Signal<boolean>;
  protected pastMeetingSummary: Signal<PastMeetingSummary | null>;
  private pastMeetingRecording: Signal<PastMeetingRecording | null>;
  protected pastMeetingAttachments: Signal<PastMeetingAttachment[]>;
  protected primaryRecordingUrl: Signal<string | null>;
  protected transcriptUrl: Signal<string | null>;
  protected displayResources: Signal<MeetingResourceItem[]>;
  // Computed signals for invited/registration status
  public isInvited: Signal<boolean>;
  public canRegisterForMeeting: Signal<boolean>;
  public canToggleRsvpView: Signal<boolean>;
  public showMyRsvp: WritableSignal<boolean> = signal<boolean>(false);

  // Form value signals for reactivity
  public formValues: Signal<{ name: string; email: string; organization: string }>;

  public constructor() {
    // Initialize all class variables
    this.authenticated = this.userService.authenticated;
    this.meeting = this.initializeMeeting();
    this.currentOccurrence = this.initializeCurrentOccurrence();
    this.joinForm = this.initializeJoinForm();
    this.formValues = this.initializeFormValues();
    this.meetingTypeBadge = this.initializeMeetingTypeBadge();

    this.meetingTitle = this.initializeMeetingTitle();
    this.meetingDescription = this.initializeMeetingDescription();
    this.hasAiCompanion = this.initializeHasAiCompanion();
    this.isPastMeeting = this.initializeIsPastMeeting();
    this.pastMeetingSummary = this.initializePastMeetingSummary();
    this.pastMeetingRecording = this.initializePastMeetingRecording();
    this.pastMeetingAttachments = this.initializePastMeetingAttachments();
    this.primaryRecordingUrl = this.initializePrimaryRecordingUrl();
    this.transcriptUrl = this.initializeTranscriptUrl();
    this.displayResources = this.initializeDisplayResources();

    // Initialize invited/registration signals
    this.isInvited = this.initializeIsInvited();
    this.canRegisterForMeeting = this.initializeCanRegisterForMeeting();
    this.canToggleRsvpView = this.initializeCanToggleRsvpView();

    this.returnTo = this.initializeReturnTo();
    this.canJoinMeeting = this.initializeCanJoinMeeting();
    this.fetchedJoinUrl = this.initializeFetchedJoinUrl();
    this.attachments = this.initializeAttachments();
    this.messageSeverity = this.initializeMessageSeverity();
    this.messageIcon = this.initializeMessageIcon();
    this.alertMessage = this.initializeAlertMessage();
    this.emailError = this.initializeEmailError();
    this.initializeAutoJoin();
  }

  public handleCopyLink(): void {
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

  public onRegistrantsToggle(): void {
    const meeting = this.meeting();
    if (!meeting.organizer && !meeting.invited) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Show Members is not enabled',
        detail: 'Please contact the meeting organizer to enable show members',
      });
      return;
    }

    this.showRegistrants.set(!this.showRegistrants());
  }

  public onDrawerHide(): void {
    this.showRegistrants.set(false);
  }

  public onEmailErrorClick(): void {
    this.joinUrlError.set(null);
    this.showGuestForm.set(true);
  }

  public onRsvpViewToggle(): void {
    this.showMyRsvp.set(!this.showMyRsvp());
  }

  public downloadAttachment(attachment: Pick<MeetingAttachment, 'uid'>): void {
    this.meetingService
      .getMeetingAttachmentDownloadUrl(this.meeting().id, attachment.uid)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const newWindow = window.open(res.download_url, '_blank', 'noopener,noreferrer');
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

  public registerForMeeting(): void {
    const meeting = this.meeting();
    const user = this.user();

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
        // Trigger refresh to update meeting data with invitation status
        this.refreshTrigger$.next();
      }
    });
  }

  private initializeAutoJoin(): void {
    // Use toObservable to create an Observable from the signals, then subscribe once
    // This executes only when all conditions are met
    toObservable(this.fetchedJoinUrl)
      .pipe(
        // Take only the first emission where we have a valid URL and haven't auto-joined yet
        // Only auto-join for authenticated users using their own email (not guest form)
        filter((url) => {
          const authenticated = this.authenticated();
          const user = this.user();
          const canJoin = this.canJoinMeeting();
          const alreadyJoined = this.hasAutoJoined();
          const usingGuestForm = this.showGuestForm();

          return !!url && authenticated && !!user && !!user.email && canJoin && !alreadyJoined && !usingGuestForm;
        }),
        // Take only the first valid URL
        take(1)
      )
      .subscribe((url) => {
        // Mark as auto-joined to prevent multiple attempts
        this.hasAutoJoined.set(true);

        // Open the meeting URL in a new tab
        if (typeof window !== 'undefined' && url) {
          const newWindow = window.open(url, '_blank', 'noopener,noreferrer');

          // With noopener, window.open() may return null even on success
          // Only check if window.closed is explicitly true to detect popup blocking
          if (newWindow !== null && newWindow.closed) {
            // Popup was blocked
            this.messageService.add({
              severity: 'warn',
              summary: 'Popup Blocked',
              detail: 'Your browser blocked the meeting window. Please click the "Join Meeting" button to open it manually.',
              life: 5000,
            });
          } else {
            // Window opened (or likely opened with noopener returning null)
            this.messageService.add({
              severity: 'success',
              summary: 'Meeting Opened',
              detail: "The meeting has been opened in a new tab. If you don't see it, check if popups are blocked.",
              life: 3000,
            });
          }
        }
      });
  }

  private initializeMeeting() {
    return toSignal<Meeting & { project: Project }>(
      combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refreshTrigger$]).pipe(
        switchMap(([params, queryParams]) => {
          const meetingId = params.get('id');
          this.password.set(queryParams.get('password'));

          if (!meetingId) {
            this.router.navigate(['/meetings/not-found']);
            return EMPTY;
          }

          // Check if this is a past meeting occurrence ID (format: meetingId-timestamp)
          if (this.isPastMeetingOccurrenceId(meetingId)) {
            this.loadedViaPastMeetingId.set(true);
            return this.meetingService.getPublicPastMeeting(meetingId).pipe(
              tap((res) => {
                this.pastMeetingFullAccess.set(res.full_access);
              }),
              map((res) => ({
                meeting: res.meeting as Meeting,
                project: res.project as Project,
              })),
              catchError((error) => {
                if ([404, 403, 400].includes(error.status)) {
                  this.router.navigate(['/meetings/not-found']);
                }
                return EMPTY;
              })
            );
          }

          // No hyphen — could be upcoming or past. Try upcoming first.
          this.loadedViaPastMeetingId.set(false);
          this.pastMeetingFullAccess.set(false);
          return this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
            catchError((error) => {
              // If upcoming meeting not found, try as a past meeting
              if (error.status === 404) {
                return this.meetingService.getPublicPastMeeting(meetingId).pipe(
                  tap((res) => {
                    this.loadedViaPastMeetingId.set(true);
                    this.pastMeetingFullAccess.set(res.full_access);
                  }),
                  map((res) => ({
                    meeting: res.meeting as Meeting,
                    project: res.project as Project,
                  })),
                  catchError(() => {
                    this.router.navigate(['/meetings/not-found']);
                    return EMPTY;
                  })
                );
              }
              if ([403, 400].includes(error.status)) {
                this.router.navigate(['/meetings/not-found']);
              }
              return EMPTY;
            })
          );
        }),
        map((res) => ({ ...res.meeting, project: res.project })),
        tap((res) => {
          this.project.set(res.project);
        })
      )
    ) as Signal<Meeting & { project: Project }>;
  }

  private isPastMeetingOccurrenceId(id: string): boolean {
    // Past meeting occurrence IDs have format: meetingId-timestamp (e.g., 95580361604-1775745000000)
    const parts = id.split('-');
    return parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{13}$/.test(parts[1]);
  }

  private initializeCurrentOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      const meeting = this.meeting();
      return getCurrentOrNextOccurrence(meeting);
    });
  }

  // Private initialization methods
  private initializeJoinForm(): FormGroup {
    return new FormGroup({
      name: new FormControl<string>(this.user()?.name || '', [Validators.required]),
      email: new FormControl<string>('', [Validators.required, Validators.email]),
      organization: new FormControl<string>(''),
    });
  }

  private initializeFormValues(): Signal<{ name: string; email: string; organization: string }> {
    return toSignal(
      this.joinForm.valueChanges.pipe(
        map(() => ({
          name: this.joinForm.get('name')?.value || '',
          email: this.joinForm.get('email')?.value || '',
          organization: this.joinForm.get('organization')?.value || '',
        }))
      ),
      {
        initialValue: {
          name: this.joinForm.get('name')?.value || '',
          email: this.joinForm.get('email')?.value || '',
          organization: this.joinForm.get('organization')?.value || '',
        },
      }
    );
  }

  private initializeMeetingTypeBadge(): Signal<{
    severity: TagSeverity;
    styleClass: string;
    icon?: string;
    text: string;
  } | null> {
    return computed(() => {
      const meetingType = this.meeting()?.meeting_type;
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

  private initializeReturnTo(): Signal<string | undefined> {
    return computed(() => {
      const meeting = this.meeting();
      const params = new URLSearchParams();

      if (meeting.password) {
        params.set('password', meeting.password);
      }
      const queryString = params.toString();
      return queryString ? `${environment.urls.home}/meetings/${meeting.id}?${queryString}` : `${environment.urls.home}/meetings/${meeting.id}`;
    });
  }

  private initializeCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      return canJoinMeeting(this.meeting(), this.currentOccurrence());
    });
  }

  private initializeMessageSeverity(): Signal<'success' | 'info' | 'warn'> {
    return computed(() => {
      const canJoinMeeting = this.canJoinMeeting();

      if (canJoinMeeting) {
        return 'info';
      }
      return 'warn';
    });
  }

  private initializeMessageIcon(): Signal<string> {
    return computed(() => {
      const canJoinMeeting = this.canJoinMeeting();

      if (canJoinMeeting) {
        return 'fa-light fa-check-circle';
      }
      return 'fa-light fa-clock';
    });
  }

  private initializeFetchedJoinUrl(): Signal<string | undefined> {
    return toSignal(
      combineLatest([toObservable(this.canJoinMeeting), this.joinForm.statusChanges.pipe(debounceTime(300), startWith(this.joinForm.status))]).pipe(
        switchMap(([canJoin, formStatus]) => {
          const meeting = this.meeting();
          const authenticated = this.authenticated();
          const user = this.user();

          // Reset error state
          this.joinUrlError.set(null);

          // Only fetch when meeting is joinable and we have necessary user info
          if (!canJoin || !meeting?.id) {
            this.isLoadingJoinUrl.set(false);
            return of(undefined);
          }

          // Determine email based on authentication status
          let email: string | undefined;

          if (authenticated && !this.showGuestForm()) {
            // For authenticated users, use their email from user profile
            email = user?.email;
            if (!email) {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
          } else {
            // For unauthenticated users, form must be valid
            if (formStatus !== 'VALID') {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
            // Use email from form
            email = this.joinForm.get('email')?.value;
            if (!email) {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
          }

          // Fetch join URL with the determined email
          return this.fetchJoinUrl(meeting, email);
        })
      ),
      { initialValue: undefined }
    );
  }

  private fetchJoinUrl(meeting: Meeting, email: string): Observable<string | undefined> {
    this.isLoadingJoinUrl.set(true);

    return this.meetingService.getPublicMeetingJoinUrl(meeting.id, meeting.password, { email }).pipe(
      map((res) => {
        this.isLoadingJoinUrl.set(false);
        if (res.link) {
          // For authenticated users, use the user object
          // For guests, pass name and organization from form
          if (this.authenticated()) {
            return buildJoinUrlWithParams(res.link, this.user());
          }

          return buildJoinUrlWithParams(res.link, null, {
            name: this.joinForm.get('name')?.value,
            organization: this.joinForm.get('organization')?.value,
          });
        }
        return undefined;
      }),
      catchError((error) => {
        this.isLoadingJoinUrl.set(false);
        this.joinUrlError.set(error?.error?.error || 'Failed to load meeting join URL. Please try again.');
        return of(undefined);
      })
    );
  }

  private initializeAttachments(): Signal<MeetingAttachment[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        filter((meeting) => {
          if (!meeting?.id) return false;
          // Public meetings can fetch attachments without auth; private meetings require it
          if (meeting.visibility === 'public' && !meeting.restricted) return true;
          return this.authenticated();
        }),
        switchMap((meeting) => this.meetingService.getMeetingAttachments(meeting.id)),
        catchError(() => of([] as MeetingAttachment[]))
      ),
      { initialValue: [] }
    );
  }

  private initializeAlertMessage(): Signal<string> {
    return computed(() => {
      const canJoin = this.canJoinMeeting();
      const meeting = this.meeting();
      const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;

      if (canJoin) {
        return 'The meeting is in progress.';
      }
      return `You may only join the meeting up to ${earlyJoinMinutes} minutes before the start time.`;
    });
  }

  private initializeMeetingTitle(): Signal<string> {
    return computed(() => {
      const occurrence = this.currentOccurrence();
      const meeting = this.meeting();
      return occurrence?.title || meeting?.title || '';
    });
  }

  private initializeMeetingDescription(): Signal<string> {
    return computed(() => {
      const occurrence = this.currentOccurrence();
      const meeting = this.meeting();
      return occurrence?.description || meeting?.description || '';
    });
  }

  private initializeHasAiCompanion(): Signal<boolean> {
    return computed(() => this.meeting()?.zoom_config?.ai_companion_enabled || false);
  }

  private initializeIsInvited(): Signal<boolean> {
    return computed(() => this.meeting()?.invited ?? false);
  }

  private initializeCanRegisterForMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      return !this.isInvited() && !meeting?.restricted && meeting?.visibility === 'public';
    });
  }

  private initializeCanToggleRsvpView(): Signal<boolean> {
    return computed(() => !!this.meeting()?.organizer && this.isInvited());
  }

  private initializeEmailError(): Signal<boolean> {
    return computed(() => {
      return this.joinUrlError()?.toLowerCase().includes('email address is not registered for this restricted meeting') ?? false;
    });
  }

  private initializeIsPastMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      const occurrence = this.currentOccurrence();
      if (!meeting?.start_time) return false;
      return hasMeetingEnded(meeting, occurrence ?? undefined);
    });
  }

  private initializePastMeetingSummary(): Signal<PastMeetingSummary | null> {
    return toSignal(
      combineLatest([toObservable(this.pastMeetingFullAccess), toObservable(this.meeting)]).pipe(
        switchMap(([hasAccess, meeting]) => {
          if (!hasAccess || !meeting?.id || !this.authenticated()) return of(null);
          return this.meetingService.getPastMeetingSummary(meeting.id).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initializePastMeetingRecording(): Signal<PastMeetingRecording | null> {
    return toSignal(
      combineLatest([toObservable(this.pastMeetingFullAccess), toObservable(this.meeting)]).pipe(
        switchMap(([hasAccess, meeting]) => {
          if (!hasAccess || !meeting?.id || !this.authenticated()) return of(null);
          return this.meetingService.getPastMeetingRecording(meeting.id).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initializePastMeetingAttachments(): Signal<PastMeetingAttachment[]> {
    return toSignal(
      combineLatest([toObservable(this.pastMeetingFullAccess), toObservable(this.meeting)]).pipe(
        switchMap(([hasAccess, meeting]) => {
          if (!hasAccess || !meeting?.id || !this.authenticated()) return of([] as PastMeetingAttachment[]);
          return this.meetingService.getPastMeetingAttachments(meeting.id).pipe(catchError(() => of([] as PastMeetingAttachment[])));
        })
      ),
      { initialValue: [] }
    );
  }

  private initializePrimaryRecordingUrl(): Signal<string | null> {
    return computed(() => {
      const recording = this.pastMeetingRecording();
      if (!recording?.sessions?.length) return null;

      const sessionsWithShareUrl = recording.sessions.filter((s) => !!s.share_url);
      if (!sessionsWithShareUrl.length) return null;

      const primary = sessionsWithShareUrl.reduce((largest, session) => (session.total_size > largest.total_size ? session : largest), sessionsWithShareUrl[0]);

      return primary.share_url ?? null;
    });
  }

  private initializeTranscriptUrl(): Signal<string | null> {
    return computed(() => {
      const recording = this.pastMeetingRecording();
      if (!recording?.recording_files?.length) return null;

      const transcript = recording.recording_files.find((f) => f.file_type === 'TRANSCRIPT');
      return transcript?.download_url ?? null;
    });
  }

  private initializeDisplayResources(): Signal<MeetingResourceItem[]> {
    return computed(() => {
      if (this.pastMeetingFullAccess()) {
        return this.pastMeetingAttachments().map((a) => ({
          uid: a.uid,
          type: a.type,
          name: a.name,
          link: a.link,
          fileUrl: a.file_url,
          fileSize: a.file_size,
          isPastMeeting: true,
        }));
      }
      return this.attachments().map((a) => ({
        uid: a.uid,
        type: a.type,
        name: a.name,
        link: a.link,
        isPastMeeting: false,
      }));
    });
  }
}
