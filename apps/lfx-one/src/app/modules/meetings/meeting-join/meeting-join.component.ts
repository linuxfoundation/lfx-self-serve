// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { MeetingSummaryModalComponent } from '@app/modules/meetings/components/meeting-summary-modal/meeting-summary-modal.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { HeaderComponent } from '@components/header/header.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  DEFAULT_MEETING_TYPE_CONFIG,
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  hasMeetingEnded,
  Meeting,
  MEETING_TYPE_CONFIGS,
  MeetingAttachment,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  Project,
  PublicPastMeetingResponse,
  ROOT_PROJECT_SLUG,
  TagSeverity,
  User,
} from '@lfx-one/shared';
import { FileTypeDisplayPipe } from '@pipes/file-type-display.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  map,
  merge,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';

import { GuestFormComponent } from '../components/guest-form/guest-form.component';
import { MeetingMaterialsDrawerComponent } from '../components/meeting-materials-drawer/meeting-materials-drawer.component';
import { MeetingRsvpDetailsComponent } from '../components/meeting-rsvp-details/meeting-rsvp-details.component';
import { PublicRegistrationModalComponent } from '../components/public-registration-modal/public-registration-modal.component';

@Component({
  selector: 'lfx-meeting-join',
  imports: [
    ClipboardModule,
    DatePipe,
    NgClass,
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    TagComponent,
    RsvpButtonGroupComponent,
    MeetingRsvpDetailsComponent,
    MeetingRegistrantsDisplayComponent,
    GuestFormComponent,
    TooltipModule,
    DrawerModule,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    LinkifyPipe,
    ExpandableTextComponent,
    HeaderComponent,
    FileTypeDisplayPipe,
    DynamicDialogModule,
    MeetingMaterialsDrawerComponent,
  ],
  providers: [DialogService],
  templateUrl: './meeting-join.component.html',
})
export class MeetingJoinComponent implements OnInit {
  // Injected services
  private readonly messageService = inject(MessageService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);
  private readonly clipboard = inject(Clipboard);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // Class variables with types
  public authenticated: WritableSignal<boolean>;
  public user: Signal<User | null> = this.userService.user;
  public joinForm: FormGroup;
  public project: WritableSignal<Partial<Project> | null> = signal<Partial<Project> | null>(null);
  public meeting: Signal<Meeting & { project: Partial<Project> }>;
  public currentOccurrence: Signal<MeetingOccurrence | null>;
  private occurrenceContext: Signal<{ sorted: MeetingOccurrence[]; currentIdx: number }>;
  protected previousOccurrenceUrl: Signal<string | null>;
  protected nextOccurrenceUrl: Signal<string | null>;
  protected occurrenceLabel: Signal<string | null>;
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
  // Bumped immediately when a guest is added so the count in the RSVP card doesn't lag the
  // async query-service indexing. Floored back to 0 once the registrants refetch absorbs the
  // newly-added rows (see additionalRegistrantsCount computed below).
  private optimisticAdditional = signal(0);
  public materialsDrawerVisible = signal(false);
  protected showAllFiles = signal(false);
  protected visibleFiles = computed(() => (this.showAllFiles() ? this.materialFiles() : this.materialFiles().slice(0, 5)));
  protected hasMoreFiles = computed(() => this.materialFiles().length > 5);
  // Authoritative "view as past" flag derived from the hyphenated occurrence ID URL pattern —
  // when true, always show past-meeting UI regardless of clock. isPastMeeting remains as the
  // time-based fallback for non-hyphenated URLs where past-ness is only knowable from the clock.
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
  protected currentAttachments = computed(() => (this.pastMeetingFullAccess() ? this.pastMeetingAttachments() : this.attachments()));
  protected materialFiles = computed(() => this.currentAttachments().filter((a) => a.type === 'file'));
  protected materialLinks = computed(() => this.currentAttachments().filter((a) => a.type === 'link'));
  protected hasRecentlyUpdatedMaterials = computed(() => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
    return this.currentAttachments().some((a) => a.updated_at && new Date(a.updated_at) > sevenDaysAgo);
  });
  // RSVP summary counts from meeting object
  protected rsvpAcceptedCount = computed(() => this.meeting()?.registrants_accepted_count ?? 0);
  protected rsvpDeclinedCount = computed(() => this.meeting()?.registrants_declined_count ?? 0);
  protected rsvpPendingCount = computed(() => this.meeting()?.registrants_pending_count ?? 0);
  protected hasRsvpData = computed(() => this.rsvpAcceptedCount() > 0 || this.rsvpDeclinedCount() > 0 || this.rsvpPendingCount() > 0);
  protected userInitials = computed(() => {
    const name = this.user()?.name || 'User';
    return name.substring(0, 2).toUpperCase();
  });
  protected isMobileViewport = signal(false);
  protected drawerPosition = computed(() => (this.isMobileViewport() ? 'bottom' : 'right') as 'bottom' | 'right');
  // Parent project (foundation) for context display
  protected parentProject: Signal<Project | null>;
  // Registrant list, fetched only when the user is the meeting organizer or invited.
  // Pre-loaded with the meeting so the Show Members drawer renders instantly from cache.
  protected registrants: Signal<MeetingRegistrant[]>;
  protected registrantsLoading: WritableSignal<boolean> = signal(false);
  // Re-fires the registrants fetch (e.g. after a guest is added from the drawer).
  private registrantsRefresh$ = new BehaviorSubject<void>(undefined);
  // Counts from actual data
  protected totalInvitees = computed(() => this.registrants().length);
  // Optimistic + actual: post-add we bump optimisticAdditional immediately and let the refetch
  // catch up; the max keeps the count stable while query indexing settles.
  public additionalRegistrantsCount = computed(() => {
    const meeting = this.meeting();
    const baseCount = (meeting?.individual_registrants_count || 0) + (meeting?.committee_members_count || 0);
    const fetched = Math.max(0, this.registrants().length - baseCount);
    return Math.max(fetched, this.optimisticAdditional());
  });
  // Past meeting participants (fetched from API for attendance stats)
  protected pastMeetingParticipants: Signal<PastMeetingParticipant[]>;
  // Past meeting attendance stats (derived from participants)
  protected participantCount = computed(() => this.pastMeetingParticipants().length);
  protected attendedCount = computed(() => this.pastMeetingParticipants().filter((p) => p.is_attended).length);
  protected absentCount = computed(() => this.participantCount() - this.attendedCount());
  protected invitedCount = computed(() => this.pastMeetingParticipants().filter((p) => p.is_invited).length);
  protected attendancePercentage = computed(() => {
    const total = this.participantCount();
    const attended = this.attendedCount();
    return total > 0 ? Math.round((attended / total) * 100) : 0;
  });
  protected hasAttendanceData = computed(() => this.isPastMeeting() && this.participantCount() > 0);
  // Computed signals for invited/registration status
  public isInvited: Signal<boolean>;
  public canRegisterForMeeting: Signal<boolean>;
  public canToggleRsvpView: Signal<boolean>;
  public showMyRsvp: WritableSignal<boolean> = signal<boolean>(false);

  // Current user's RSVP for this meeting (null when not responded). Fetched at this level so
  // the detail page can show the RSVP status even in the default guest-count view, without
  // waiting for the user to click "Set My RSVP" to mount the button-group child.
  public currentUserRsvp: Signal<MeetingRsvp | null>;
  public currentUserRsvpLabel: Signal<string | null>;
  public currentUserRsvpIcon: Signal<string | null>;
  public rsvpToggleLabel: Signal<string>;
  // Emits the freshly-submitted RSVP from the button-group so the chip updates immediately,
  // bypassing any query-service indexing lag that would otherwise return stale data on refetch.
  private readonly rsvpUpdateTrigger$ = new Subject<MeetingRsvp>();
  // Monotonic counter bumped on every manual RSVP update. Captured at fetch dispatch time and
  // checked on response; if it has advanced, the server response is stale relative to a newer
  // optimistic update and is dropped so the chip doesn't revert.
  private rsvpUpdateCounter = 0;

  // Form value signals for reactivity
  public formValues: Signal<{ name: string; email: string; organization: string }>;

  public constructor() {
    // Initialize all class variables
    this.authenticated = this.userService.authenticated;
    this.meeting = this.initializeMeeting();
    this.currentOccurrence = this.initializeCurrentOccurrence();
    this.occurrenceContext = this.initializeOccurrenceContext();
    this.previousOccurrenceUrl = this.initializePreviousOccurrenceUrl();
    this.nextOccurrenceUrl = this.initializeNextOccurrenceUrl();
    this.occurrenceLabel = this.initializeOccurrenceLabel();
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
    this.pastMeetingParticipants = this.initializePastMeetingParticipants();

    // Initialize invited/registration signals
    this.isInvited = this.initializeIsInvited();
    this.canRegisterForMeeting = this.initializeCanRegisterForMeeting();
    this.canToggleRsvpView = this.initializeCanToggleRsvpView();
    this.currentUserRsvp = this.initializeCurrentUserRsvp();
    this.currentUserRsvpLabel = this.initializeCurrentUserRsvpLabel();
    this.currentUserRsvpIcon = this.initializeCurrentUserRsvpIcon();
    this.rsvpToggleLabel = this.initializeRsvpToggleLabel();

    this.returnTo = this.initializeReturnTo();
    this.canJoinMeeting = this.initializeCanJoinMeeting();
    this.fetchedJoinUrl = this.initializeFetchedJoinUrl();
    this.attachments = this.initializeAttachments();
    this.messageSeverity = this.initializeMessageSeverity();
    this.messageIcon = this.initializeMessageIcon();
    this.alertMessage = this.initializeAlertMessage();
    this.emailError = this.initializeEmailError();
    this.registrants = this.initializeRegistrants();
    this.parentProject = this.initializeParentProject();
    this.initializeAutoJoin();
  }

  public ngOnInit(): void {
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(max-width: 639px)'); // Matches Tailwind sm: breakpoint (640px)
      this.isMobileViewport.set(mql.matches);
      const handler = (e: MediaQueryListEvent) => this.isMobileViewport.set(e.matches);
      mql.addEventListener('change', handler);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
    }
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

  public onRegistrantsRefreshRequested(addedCount: number): void {
    if (addedCount > 0) {
      this.optimisticAdditional.update((c) => c + addedCount);
    }
    this.registrantsRefresh$.next();
  }

  public onEmailErrorClick(): void {
    this.joinUrlError.set(null);
    this.showGuestForm.set(true);
  }

  public onShowMembersPlaceholder(): void {
    this.messageService.add({ severity: 'info', summary: 'Coming Soon', detail: 'Attendees list will be available soon.', life: 3000 });
  }

  public onRsvpViewToggle(): void {
    this.showMyRsvp.set(!this.showMyRsvp());
  }

  public onRsvpChanged(rsvp: MeetingRsvp): void {
    // rsvp-button-group emits the confirmed RSVP after the POST succeeds. Push it directly into the
    // signal stream so the chip updates instantly, even when the backend polling window times out
    // before the query service has indexed the new RSVP (server would still return stale on refetch).
    this.rsvpUpdateTrigger$.next(rsvp);
  }

  public openMaterialsDrawer(): void {
    this.materialsDrawerVisible.set(true);
  }

  public onMaterialsChanged(): void {
    // Immediate refresh + delayed retry: upload writes to meeting-service via ITX,
    // reads come from query-service indexed asynchronously via NATS, so a single
    // immediate fetch can return stale data before the NATS event propagates.
    this.refreshTrigger$.next();
    timer(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshTrigger$.next());
  }

  public downloadAttachment(attachment: MeetingAttachment | PastMeetingAttachment): void {
    const download$ = this.loadedViaPastMeetingId()
      ? this.meetingService.getPastMeetingAttachmentDownloadUrl(this.meeting().id, attachment.uid)
      : this.meetingService.getMeetingAttachmentDownloadUrl(this.meeting().id, attachment.uid);
    download$.pipe(take(1)).subscribe({
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

  /** Sets foundation context via ProjectContextService and opens /foundation/overview in a new tab. */
  public navigateToFoundation(): void {
    const parent = this.parentProject();
    const project = this.project();
    const meeting = this.meeting();
    const isTopLevelProject = !project?.parent_uid;
    const uid = parent?.uid || project?.parent_uid || (isTopLevelProject ? project?.uid || meeting?.project_uid : undefined);
    const name = parent?.name || project?.name || meeting?.project_name || '';
    const slug = parent?.slug || project?.slug || '';
    if (uid) {
      this.projectContextService.setFoundation({ uid, name, slug });
      window.open('/foundation/overview', '_blank', 'noopener,noreferrer');
    }
  }

  public openSummaryModal(): void {
    const summary = this.pastMeetingSummary();
    if (!summary) return;

    this.dialogService.open(MeetingSummaryModalComponent, {
      header: 'AI Summary',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { summary },
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
    return toSignal<Meeting & { project: Partial<Project> }>(
      combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refreshTrigger$]).pipe(
        debounceTime(0), // Coalesce rapid SSR hydration emissions so the fallback chain isn't canceled
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
              tap((res: PublicPastMeetingResponse) => {
                this.pastMeetingFullAccess.set(res.full_access);
              }),
              map((res: PublicPastMeetingResponse) => ({
                meeting: res.meeting,
                project: res.project as Partial<Project>,
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
              if (error.status === 404) {
                return this.meetingService.getPublicPastMeeting(meetingId).pipe(
                  tap((res: PublicPastMeetingResponse) => {
                    this.loadedViaPastMeetingId.set(true);
                    this.pastMeetingFullAccess.set(res.full_access);
                  }),
                  map((res: PublicPastMeetingResponse) => ({
                    meeting: res.meeting,
                    project: res.project as Partial<Project>,
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
    ) as Signal<Meeting & { project: Partial<Project> }>;
  }

  private isPastMeetingOccurrenceId(id: string): boolean {
    const parts = id.split('-');
    return parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{13}$/.test(parts[1]);
  }

  private initializeCurrentOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      const meeting = this.meeting();
      // Check if a specific occurrence was requested via query param
      const requestedOccurrence = this.activatedRoute.snapshot.queryParamMap.get('occurrence');
      if (requestedOccurrence && meeting?.occurrences?.length) {
        const requestedTime = parseInt(requestedOccurrence, 10);
        const active = getActiveOccurrences(meeting.occurrences);
        const match = active.find((o: MeetingOccurrence) => new Date(o.start_time).getTime() === requestedTime);
        if (match) return match;
      }
      return getCurrentOrNextOccurrence(meeting);
    });
  }

  private initializeOccurrenceContext(): Signal<{ sorted: MeetingOccurrence[]; currentIdx: number }> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.occurrences?.length) return { sorted: [], currentIdx: -1 };
      const sorted = getActiveOccurrences(meeting.occurrences).sort(
        (a: MeetingOccurrence, b: MeetingOccurrence) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
      const current = this.currentOccurrence();
      let currentTime: number;
      if (current) {
        currentTime = new Date(current.start_time).getTime();
      } else {
        // For past meetings loaded via /meetings/{id}-{timestamp}, extract timestamp from route
        const routeId = this.activatedRoute.snapshot.paramMap.get('id') ?? '';
        const parts = routeId.split('-');
        currentTime = parts.length === 2 && /^\d{13}$/.test(parts[1]) ? parseInt(parts[1], 10) : Date.now();
      }
      let currentIdx = sorted.findIndex((o: MeetingOccurrence) => new Date(o.start_time).getTime() === currentTime);
      if (currentIdx < 0) {
        currentIdx = sorted.findIndex((o: MeetingOccurrence) => new Date(o.start_time).getTime() >= currentTime);
      }
      if (currentIdx < 0) currentIdx = sorted.length - 1;
      return { sorted, currentIdx };
    });
  }

  private buildOccurrenceUrl(meetingId: string, occurrence: MeetingOccurrence): string {
    const timestamp = new Date(occurrence.start_time).getTime();
    const meeting = this.meeting();
    const isPast = hasMeetingEnded(meeting, occurrence);
    const password = this.password();
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    if (isPast) {
      const base = `/meetings/${meetingId}-${timestamp}`;
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
    params.set('occurrence', timestamp.toString());
    return `/meetings/${meetingId}?${params.toString()}`;
  }

  private initializePreviousOccurrenceUrl(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.recurrence) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (currentIdx <= 0) return null;
      return this.buildOccurrenceUrl(meeting.id, sorted[currentIdx - 1]);
    });
  }

  private initializeNextOccurrenceUrl(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.recurrence) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (currentIdx < 0 || currentIdx >= sorted.length - 1) return null;
      return this.buildOccurrenceUrl(meeting.id, sorted[currentIdx + 1]);
    });
  }

  private initializeOccurrenceLabel(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.recurrence) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (sorted.length === 0) return null;
      return `${currentIdx + 1} of ${sorted.length}`;
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
      // Hyphenated occurrence-ID URL expresses "view as past" intent — never show Join UI.
      if (this.loadedViaPastMeetingId()) return false;
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
      combineLatest([
        toObservable(this.meeting).pipe(
          filter((meeting) => {
            if (!meeting?.id) return false;
            if (meeting.visibility === 'public' && !meeting.restricted) return true;
            return this.authenticated();
          }),
          distinctUntilChanged((a, b) => a.id === b.id)
        ),
        this.refreshTrigger$,
      ]).pipe(
        switchMap(([meeting]) => this.meetingService.getMeetingAttachments(meeting.id)),
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

  private initializeCurrentUserRsvp(): Signal<MeetingRsvp | null> {
    const meeting$ = toObservable(this.meeting);
    const occurrence$ = toObservable(this.currentOccurrence);
    const authenticated$ = toObservable(this.authenticated);
    const canToggle$ = toObservable(this.canToggleRsvpView);

    // Fetch trigger: meeting/occurrence/auth/canToggle changes. Deduped on a stable key so that
    // derived signals settling in the same microtask don't cause redundant emissions.
    const fetchTrigger$ = combineLatest([meeting$, occurrence$, authenticated$, canToggle$]).pipe(
      distinctUntilChanged(([m1, o1, a1, c1], [m2, o2, a2, c2]) => {
        const occ1 = m1?.recurrence ? o1?.occurrence_id : undefined;
        const occ2 = m2?.recurrence ? o2?.occurrence_id : undefined;
        return m1?.id === m2?.id && occ1 === occ2 && a1 === a2 && c1 === c2;
      })
    );

    // Single pipeline routing both fetch triggers and manual updates through switchMap:
    // - fetch events cancel any in-flight fetch AND a previously-emitted manual update stays as
    //   the last emission only if no subsequent event overrides it
    // - manual update events (rsvpUpdateTrigger$) short-circuit with the confirmed RSVP, cancelling
    //   any in-flight server fetch so a late server response can't revert the chip to stale data
    const source$ = merge(
      fetchTrigger$.pipe(map((v) => ({ type: 'fetch' as const, data: v }))),
      this.rsvpUpdateTrigger$.pipe(map((rsvp) => ({ type: 'update' as const, data: rsvp })))
    );

    return toSignal(
      source$.pipe(
        switchMap((evt) => {
          if (evt.type === 'update') {
            // Button-group emits the confirmed RSVP after a successful POST — trust it, cancel
            // any in-flight server fetch so query-service indexing lag can't overwrite.
            this.rsvpUpdateCounter++;
            return of(evt.data);
          }
          const [meeting, occurrence, authenticated, canToggle] = evt.data;
          // Only fetch when the user can actually RSVP (organizer + invited).
          if (!authenticated || !canToggle || !meeting?.id) {
            return of(null);
          }
          const occurrenceId = meeting.recurrence ? occurrence?.occurrence_id : undefined;
          // Capture the current update revision at fetch dispatch time. If a manual update
          // bumps the counter before the server response arrives (typically because the
          // query-service hasn't indexed the new RSVP yet), the filter drops both the
          // `startWith(null)` reset and the stale server value so the optimistic local
          // update stays visible and the chip doesn't flash back.
          const counterAtDispatch = this.rsvpUpdateCounter;
          return this.meetingService.getMeetingRsvpForCurrentUser(meeting.id, occurrenceId).pipe(
            startWith(null),
            filter(() => this.rsvpUpdateCounter === counterAtDispatch)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initializeCurrentUserRsvpLabel(): Signal<string | null> {
    return computed(() => {
      const rsvp = this.currentUserRsvp();
      if (!rsvp) return null;
      switch (rsvp.response_type) {
        case 'accepted':
          return 'Yes';
        case 'declined':
          return 'No';
        case 'maybe':
          return 'Maybe';
        default:
          return rsvp.response_type;
      }
    });
  }

  private initializeCurrentUserRsvpIcon(): Signal<string | null> {
    return computed(() => {
      const rsvp = this.currentUserRsvp();
      if (!rsvp) return null;
      switch (rsvp.response_type) {
        case 'accepted':
          return 'fa-solid fa-circle-check text-emerald-500';
        case 'declined':
          return 'fa-solid fa-circle-xmark text-red-500';
        case 'maybe':
          return 'fa-solid fa-clock text-amber-500';
        default:
          return null;
      }
    });
  }

  private initializeRsvpToggleLabel(): Signal<string> {
    return computed(() => {
      if (this.showMyRsvp()) return 'Show Guests';
      return this.currentUserRsvp() ? 'Update My RSVP' : 'Set My RSVP';
    });
  }

  private initializeEmailError(): Signal<boolean> {
    return computed(() => {
      return this.joinUrlError()?.toLowerCase().includes('email address is not registered for this restricted meeting') ?? false;
    });
  }

  private initializeIsPastMeeting(): Signal<boolean> {
    return computed(() => {
      // Hyphenated occurrence-ID URL expresses "view as past" intent — trust it over the clock.
      if (this.loadedViaPastMeetingId()) return true;
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

  private initializePastMeetingParticipants(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      combineLatest([toObservable(this.pastMeetingFullAccess), toObservable(this.meeting)]).pipe(
        switchMap(([hasAccess, meeting]) => {
          if (!hasAccess || !meeting?.id || !this.authenticated()) return of([] as PastMeetingParticipant[]);
          return this.meetingService.getPastMeetingParticipants(meeting.id).pipe(catchError(() => of([] as PastMeetingParticipant[])));
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

  private initializeParentProject(): Signal<Project | null> {
    return toSignal(
      toObservable(this.project).pipe(
        map((p) => p?.parent_uid ?? null),
        distinctUntilChanged(),
        switchMap((parentUid) => {
          if (!parentUid) {
            // Top-level (or unknown) project — explicitly clear any stale foundation context
            // instead of suppressing the emission, which would leave the previous parent cached.
            return of(null);
          }
          return this.projectService.getProject(parentUid, false).pipe(
            map((parent) => (parent?.slug === ROOT_PROJECT_SLUG ? null : parent)),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initializeRegistrants(): Signal<MeetingRegistrant[]> {
    return toSignal(
      combineLatest([
        toObservable(this.meeting).pipe(distinctUntilChanged((a, b) => a?.id === b?.id)),
        toObservable(this.authenticated),
        this.registrantsRefresh$,
      ]).pipe(
        switchMap(([meeting, authenticated]) => {
          if (!meeting?.id || !authenticated || !(meeting.organizer || meeting.invited) || this.isPastMeeting()) {
            return of([] as MeetingRegistrant[]);
          }
          this.registrantsLoading.set(true);
          const baseCount = (meeting.individual_registrants_count || 0) + (meeting.committee_members_count || 0);
          return this.meetingService.getMyMeetingRegistrants(meeting.id, true).pipe(
            tap((list) => {
              // Once the refetch lands, drop the optimistic pad so it doesn't double-count.
              const fetchedAdditional = Math.max(0, list.length - baseCount);
              if (fetchedAdditional >= this.optimisticAdditional()) {
                this.optimisticAdditional.set(0);
              }
            }),
            finalize(() => this.registrantsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
