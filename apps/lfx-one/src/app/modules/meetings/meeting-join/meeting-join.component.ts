// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe, isPlatformBrowser, isPlatformServer, NgClass } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  makeStateKey,
  OnInit,
  PLATFORM_ID,
  signal,
  Signal,
  TransferState,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { MeetingOrganizerComponent } from '@app/modules/meetings/components/meeting-organizer/meeting-organizer.component';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { MeetingSummaryModalComponent } from '@app/modules/meetings/components/meeting-summary-modal/meeting-summary-modal.component';
import { TranscriptModalComponent } from '@app/modules/meetings/components/transcript-modal/transcript-modal.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationBannerComponent } from '@components/impersonation-banner/impersonation-banner.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { HeaderComponent } from '@components/header/header.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  buildJoinUrlWithParams,
  buildOccurrenceNavTimeline,
  canJoinMeeting,
  DEFAULT_MEETING_TYPE_CONFIG,
  getActiveOccurrences,
  getCurrentOrNextOccurrence,
  resolveRsvpOccurrenceId,
  hasMeetingEnded,
  isPastMeetingSummaryAwaitingApproval,
  Meeting,
  MEETING_TYPE_CONFIGS,
  getLargestSessionShareUrl,
  getPastMeetingResourceId,
  getPastMeetingTranscriptUrl,
  MaterialsChangedEvent,
  MeetingAttachment,
  MeetingCancelOccurrenceResult,
  MeetingHostCandidate,
  MeetingJoinPageState,
  MeetingOccurrence,
  MeetingRecurrence,
  MeetingRescheduleOccurrenceResult,
  getMeetingSeriesUid,
  MeetingRegistrant,
  MeetingRemovalSource,
  MeetingRsvp,
  OccurrenceNavItem,
  resolveOccurrenceRecurrence,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  PublicMeetingOccurrencesResponse,
  PublicMeetingParentProject,
  PublicMeetingProject,
  PublicMeetingResponse,
  PublicPastMeetingResponse,
  TagSeverity,
  User,
} from '@lfx-one/shared';
import { MAX_CUSTOM_DURATION, MAX_MEETING_DURATION, MEETING_V2_ENABLED_DEFAULT, MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import {
  applyAttachmentScopeOverrides,
  applyMeetingAttachmentChanges,
  canScopeAttachmentToOccurrence,
  filterAttachmentsForOccurrence,
  getAttachmentScope,
  getMeetingSelfRemovalMessage,
  getUserTimezone,
  isHostKeyVisible,
  isMeetingAttendeeListShared,
  isMeetingInviteResponsesEnabled,
  isPastMeetingCompositeId,
  reconcileOptimisticPad,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { FileTypeDisplayPipe } from '@pipes/file-type-display.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { extractErrorMessage, isBffValidationError } from '@shared/utils/http-error.utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { PlausibleService } from '@services/plausible.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
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
  scan,
  skip,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';

import { CancelOccurrenceConfirmationComponent } from '../components/cancel-occurrence-confirmation/cancel-occurrence-confirmation.component';
import { GuestFormComponent } from '../components/guest-form/guest-form.component';
import { AttachmentScopeBadgeComponent } from '../components/attachment-scope-badge/attachment-scope-badge.component';
import { HostKeyPanelComponent } from '../components/host-key-panel/host-key-panel.component';
import { MeetingMaterialsDrawerComponent } from '../components/meeting-materials-drawer/meeting-materials-drawer.component';
import { MeetingRsvpDetailsComponent } from '../components/meeting-rsvp-details/meeting-rsvp-details.component';
import { PublicRegistrationModalComponent } from '../components/public-registration-modal/public-registration-modal.component';
import { RescheduleOccurrenceDialogComponent } from '../components/reschedule-occurrence-dialog/reschedule-occurrence-dialog.component';

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
    MeetingOrganizerComponent,
    GuestFormComponent,
    HostKeyPanelComponent,
    TooltipModule,
    ConfirmDialogModule,
    DrawerModule,
    SkeletonModule,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    LinkifyPipe,
    ExpandableTextComponent,
    HeaderComponent,
    FileTypeDisplayPipe,
    DynamicDialogModule,
    MeetingMaterialsDrawerComponent,
    AttachmentScopeBadgeComponent,
    ImpersonationBannerComponent,
  ],
  providers: [DialogService, ConfirmationService],
  templateUrl: './meeting-join.component.html',
})
export class MeetingJoinComponent implements OnInit {
  // Injected services
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly inviteResend = inject(MeetingInviteResendService);
  protected readonly userService = inject(UserService);
  private readonly clipboard = inject(Clipboard);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly plausibleService = inject(PlausibleService);
  private readonly dialogService = inject(DialogService);
  private readonly featureFlagService = inject(FeatureFlagService);
  /**
   * Whether meeting v2 is on for this user — read so the occurrence dialog allows the v2 composer's
   * 10-hour duration, and defaulted off so a slow flag provider keeps the pre-v2 cap. See
   * `MEETING_V2_ENABLED_FLAG`.
   */
  private readonly meetingsV2Enabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, MEETING_V2_ENABLED_DEFAULT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);

  // Persists the SSR-resolved meeting so the client's first paint matches the server DOM instead
  // of tearing it down at hydration (GH-2041) — see `MeetingJoinPageState` for why the meeting
  // alone isn't enough. Same pattern as `PublicProfilePageComponent`.
  private readonly stateKey = makeStateKey<MeetingJoinPageState>('meetingJoinState');

  // Class variables with types
  public authenticated: WritableSignal<boolean>;
  public user: Signal<User | null> = this.userService.user;
  // The identity the join link is built for — the real viewer, never the impersonation target.
  public joinIdentity: Signal<Pick<User, 'name' | 'email'> | null> = this.userService.meetingJoinIdentity;
  public joinForm: FormGroup;
  public project: WritableSignal<PublicMeetingProject | null> = signal<PublicMeetingProject | null>(null);
  public meeting: Signal<Meeting & { project: PublicMeetingProject }>;
  public currentOccurrence: Signal<MeetingOccurrence | null>;
  // Recurrence rule that drives the cadence badge: the displayed occurrence's own override when
  // present (cadence changed at/after it — LFXV2-2112), otherwise the series rule. NOTE: the
  // detail/join view loads the meeting via the live ITX endpoint, which does not currently carry
  // the per-occurrence override (occurrence.recurrence is null there), so this resolves to the
  // top-level rule until that backend path stamps the effective recurrence. Forward-compatible.
  public displayRecurrence: Signal<MeetingRecurrence | null>;
  // Full series timeline (past + future) fetched from the public occurrences endpoint for recurring meetings.
  private seriesOccurrences: Signal<PublicMeetingOccurrencesResponse>;
  private occurrenceContext: Signal<{ sorted: OccurrenceNavItem[]; currentIdx: number }>;
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
  /**
   * The password only when it is already in this page's own address bar.
   * @description Narrower than `password` on purpose: it answers "is this secret already
   * exposed here?", which is the only thing that makes writing it into another link harmless.
   * `buildOccurrenceUrl` reads this, never `password`.
   */
  private urlPassword: WritableSignal<string | null> = signal<string | null>(null);
  public canJoinMeeting: Signal<boolean>;
  public fetchedJoinUrl: Signal<string | undefined>;
  public isLoadingJoinUrl: WritableSignal<boolean> = signal<boolean>(false);
  public joinUrlError: WritableSignal<string | null> = signal<string | null>(null);
  public joinUrlErrorCode: WritableSignal<string | null> = signal<string | null>(null);
  public attachments: Signal<MeetingAttachment[]>;
  public messageSeverity: Signal<'success' | 'info' | 'warn'>;
  public messageIcon: Signal<string>;
  public alertMessage: Signal<string>;
  private hasAutoJoined: WritableSignal<boolean> = signal<boolean>(false);
  /** True when `zoom_redirect=false` is on the URL — suppresses automatic Zoom open. */
  private readonly zoomRedirectDisabled: Signal<boolean>;
  public showRegistrants: WritableSignal<boolean> = signal<boolean>(false);
  public showGuestForm: WritableSignal<boolean> = signal<boolean>(false);
  // Bumped immediately when a guest is added so the count in the RSVP card doesn't lag the
  // async query-service indexing. Floored back to 0 once the registrants refetch absorbs the
  // newly-added rows (see additionalRegistrantsCount computed below).
  private optimisticAdditional = signal(0);
  public materialsDrawerVisible = signal(false);
  protected showAllFiles = signal(false);
  // Single gate for the host-key callout: BFF authorized (can_view_host_key + key sent) and inside the
  // 70-min pre / 40-min post window applied server-side. The frontend trusts the BFF's flag directly.
  protected readonly hostKeyVisible: Signal<boolean> = computed(() => isHostKeyVisible(this.meeting()));
  protected readonly canManageOccurrence: Signal<boolean> = this.initCanManageOccurrence();
  protected visibleFiles = computed(() => (this.showAllFiles() ? this.materialFiles() : this.materialFiles().slice(0, 5)));
  protected hasMoreFiles = computed(() => this.materialFiles().length > 5);
  // Authoritative "view as past" flag derived from the hyphenated occurrence ID URL pattern —
  // when true, always show past-meeting UI regardless of clock. isPastMeeting remains as the
  // time-based fallback for non-hyphenated URLs where past-ness is only knowable from the clock.
  protected loadedViaPastMeetingId = signal(false);
  protected pastMeetingFullAccess = signal(false);
  // Mirrors pastMeetingFullAccess for the live/upcoming meeting path — false whenever a private
  // meeting was only reached via its shared password link (anonymous or guest), gating agenda,
  // materials, and date/time from both unauthenticated and guest-only viewers.
  protected liveMeetingFullAccess = signal(false);
  // Server-computed join-window result for the live/upcoming meeting path when not full access —
  // the anonymous/guest response strips start_time/early_join_time_minutes, so the client can't run
  // its own canJoinMeeting() timing check; this substitutes the server's isWithinJoinWindow() result.
  protected liveMeetingCanJoin = signal(false);
  // Set when the meeting fetch settles with an error that doesn't navigate away (e.g. a 5xx or
  // network failure) — 404/403/400 already redirect to /meetings/not-found, so this only covers
  // the terminal, non-navigating case where the skeleton would otherwise spin forever (GH-2041).
  protected meetingLoadFailed = signal(false);
  // Route `id` param the fetch pipeline is currently attempting (or last attempted) — set
  // synchronously as soon as a new attempt starts, so it updates immediately on navigation, before
  // that attempt's response (success or failure) settles.
  private meetingRouteId = signal<string | null>(null);
  // Route `id` param the currently-held `meeting()` value actually resolved successfully for. Only
  // updated on a successful fetch.
  private meetingResolvedRouteId = signal<string | null>(null);
  // False right after navigating to a different `/meetings/:id` until that route's fetch settles.
  // `toSignal` retains `meeting()`'s last emission across both a failing `catchError`'s `EMPTY` and
  // an in-flight new-route fetch, so without this the template would keep rendering the PREVIOUS
  // meeting (incl. its `host_key`/join links) under the new URL — either as a stale error state, or
  // as stale *success* content while the new route is still pending (copilot review on #2046).
  // Gates both the error branch (so a same-route background refresh failure, dealako review on
  // #2046, still doesn't tear down the page) and the success branch (so cross-meeting navigation
  // shows the skeleton, not meeting A's content, until meeting B resolves).
  protected meetingMatchesRoute = computed(() => this.meetingRouteId() === this.meetingResolvedRouteId());
  private refreshTrigger$ = new BehaviorSubject<void>(undefined);
  // Re-reads the series timeline after an organizer moves or cancels an occurrence; the timeline is
  // otherwise fetched once per series and would keep the occurrence at its old slot.
  private seriesOccurrencesRefresh$ = new BehaviorSubject<void>(undefined);
  private pastMeetingAttachmentsRefresh$ = new BehaviorSubject<void>(undefined);
  // Set immediately on self-registration success so the UI responds before the meeting refetch
  // settles the invited flag (query-service indexing lag).
  private optimisticInvited = signal(false);
  // Where a removal came from: the page itself, or the link in an invite email or calendar event.
  private leaveSource = signal<MeetingRemovalSource>('meeting-join');
  // True once the user has removed themselves from the meeting on screen, so the UI responds before the meeting
  // refetch settles the invited flag (same query-service indexing lag, in the other direction). Keyed by meeting
  // id in the service, so a page that stays mounted across meetings never carries one meeting's removal to another.
  private optimisticLeft = computed(() => this.meetingService.removedRegistrationMeetingIds().has(this.meeting()?.id ?? ''));
  public leavingMeeting = signal(false);
  public resendingInvite = computed(() => this.inviteResend.isResendingOwn(this.meeting()?.id));
  private readonly optimisticDeletedUids = signal(new Set<string>());
  private readonly optimisticAddedAttachments = signal<PastMeetingAttachment[]>([]);
  public emailError: Signal<boolean>;

  public meetingTitle: Signal<string>;
  public meetingDescription: Signal<string>;
  public hasAiCompanion: Signal<boolean>;
  protected isPastMeeting: Signal<boolean>;
  // Gates agenda, materials, and date/time rendering for both the past-meeting and live-meeting
  // paths — picks whichever full-access flag matches how the current meeting() was loaded.
  protected canViewMeetingDetails = computed(() => (this.loadedViaPastMeetingId() ? this.pastMeetingFullAccess() : this.liveMeetingFullAccess()));
  protected pastMeetingSummary: Signal<PastMeetingSummary | null>;
  protected hasSummaryContent: Signal<boolean>;
  protected summaryAwaitingApproval: Signal<boolean>;
  private pastMeetingRecording: Signal<PastMeetingRecording | null>;
  protected pastMeetingAttachments: Signal<PastMeetingAttachment[]>;
  protected primaryRecordingUrl: Signal<string | null>;
  protected transcriptUrl: Signal<string | null>;
  // Past meetings badge on a real fetched recording; upcoming keep the recording_enabled config flag.
  protected showRecordingBadge = computed(() => (this.loadedViaPastMeetingId() ? !!this.primaryRecordingUrl() : !!this.meeting()?.recording_enabled));
  // Returns meeting_and_occurrence_id when set (occurrences use a composite key for attachment API calls).
  protected pastMeetingResourceId = computed(() => (this.loadedViaPastMeetingId() && this.meeting() ? getPastMeetingResourceId(this.meeting()!) : undefined));
  // A live meeting's materials span every date; the page shows one occurrence, so another date's materials are dropped.
  protected currentAttachments = computed(() =>
    this.pastMeetingFullAccess()
      ? this.pastMeetingAttachments()
      : filterAttachmentsForOccurrence(
          // Scope changes saved in this session are overlaid because a refetch can still return the old scope while the query service catches up.
          applyAttachmentScopeOverrides(
            applyMeetingAttachmentChanges(this.attachments(), this.meetingService.attachmentChanges().get(this.meeting()?.id ?? '')),
            this.meetingService.attachmentScopeOverrides()
          ),
          this.currentOccurrence()?.occurrence_id
        )
  );
  // Materials carry a scope worth showing only on an upcoming recurring meeting, where each is for one date or the series.
  protected showAttachmentScopes = computed(() => !this.pastMeetingFullAccess() && !!this.meeting()?.recurrence);
  // Each listed attachment's scope, keyed by uid, so the template reads a value instead of calling a method per row.
  protected attachmentScopes = computed(
    () => new Map(this.currentAttachments().map((attachment) => [attachment.uid, getAttachmentScope(attachment as MeetingAttachment)] as const))
  );
  // The occurrence the materials drawer manages: the one this page shows, for an upcoming recurring meeting.
  protected attachmentOccurrence = computed(() => (this.showAttachmentScopes() && !this.loadedViaPastMeetingId() ? this.currentOccurrence() : null));
  // False once the shown occurrence is cancelled or past, where the service would reject a scope.
  protected canScopeToOccurrence = computed(() => {
    const meeting = this.meeting();
    return !!meeting && !!this.attachmentOccurrence() && canScopeAttachmentToOccurrence(meeting, this.currentOccurrence());
  });
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
  protected inviteResponsesEnabled = computed(() => isMeetingInviteResponsesEnabled(this.meeting()));
  protected hasRsvpData = computed(
    () => this.inviteResponsesEnabled() && (this.rsvpAcceptedCount() > 0 || this.rsvpDeclinedCount() > 0 || this.rsvpPendingCount() > 0)
  );
  protected userInitials = computed(() => {
    const name = this.user()?.name || 'User';
    return name.substring(0, 2).toUpperCase();
  });
  protected isMobileViewport = signal(false);
  // Null on the server and until hydration resolves the browser timezone — the badge shows a skeleton while null.
  protected userTimezone = signal<string | null>(null);
  protected drawerPosition = computed(() => (this.isMobileViewport() ? 'bottom' : 'right') as 'bottom' | 'right');
  // Parent project (foundation) for context display — read straight off the response (LFXV2-3266),
  // resolved server-side rather than fetched here.
  protected parentProject: Signal<PublicMeetingParentProject | null>;
  // Registrant list, fetched only when the user is the meeting organizer or invited.
  // Pre-loaded with the meeting so the Show Members drawer renders instantly from cache.
  protected registrants: Signal<MeetingRegistrant[]>;
  // Starts true so the RSVP card (which now derives its own `loading` from this signal) shows a
  // skeleton on first paint instead of a premature "0 of 0" — cleared once the initial fetch
  // resolves, including the early-return branches that never issue a request (GH-1731).
  protected registrantsLoading: WritableSignal<boolean> = signal(true);
  // Re-fires the registrants fetch (e.g. after a guest is added from the drawer).
  private registrantsRefresh$ = new BehaviorSubject<void>(undefined);
  // Snapshot of the roster size immediately before a refresh was requested — lets the refetch
  // tell whether it has absorbed the newly-added rows without needing a separate counts fetch.
  private rosterCountBeforeAdd = signal<number | null>(null);
  // Meeting+occurrence key the last successful registrants fetch belongs to. A failed refetch's
  // catchError only falls back to the last-known roster when this still matches the meeting AND
  // occurrence it was fetching for. Meeting alone isn't enough: the roster carries per-occurrence
  // `rsvp` data (the fetch passes `include_rsvp=true` with the resolved occurrence id), so a
  // fallback after switching occurrences within the same series would show accepted/declined
  // chips from the wrong occurrence even though the underlying registrant rows are still valid.
  // Also guards the original case — the component is reused across in-place `meetings/:id`
  // navigations, so a stale key (different meeting entirely) must fall back to an empty list
  // instead of leaking a previous meeting's roster into the new one.
  private registrantsRosterKey = signal<string | null>(null);
  // Counts from actual data
  // An invitee who may not see the guests gets no roster, only the server's count.
  protected totalInvitees = computed(() => (this.canViewGuests() ? this.registrants().length : (this.meeting()?.registrant_count ?? 0)));
  // The roster the child component holds is now the base count — this pad is purely optimistic,
  // covering the window between an add and the query-service refetch catching up.
  public additionalRegistrantsCount = computed(() => this.optimisticAdditional());
  // Past meeting participants (fetched from API for attendance stats)
  protected pastMeetingParticipants: Signal<PastMeetingParticipant[]>;
  // Host source for the organizer chip: registrants for upcoming, participants for past (the
  // upcoming registrants signal is empty on past join pages), so the chip and the participants
  // drawer resolve organizers from the same people.
  protected organizerChipHosts = computed<MeetingHostCandidate[]>(() => (this.isPastMeeting() ? this.pastMeetingParticipants() : this.registrants()));
  // Past meeting attendance stats: derived from the participants when the viewer gets them, else
  // the server's counts — the participants endpoint hides the rows from viewers not on them.
  protected participantCount = computed(() => this.pastMeetingParticipants().length || (this.meeting()?.participant_count ?? 0));
  protected attendedCount = computed(() => {
    const participants = this.pastMeetingParticipants();
    return participants.length ? participants.filter((p) => p.is_attended).length : (this.meeting()?.attended_count ?? 0);
  });
  protected absentCount = computed(() => this.participantCount() - this.attendedCount());
  protected invitedCount = computed(() => {
    const participants = this.pastMeetingParticipants();
    return participants.length ? participants.filter((p) => p.is_invited).length : (this.meeting()?.individual_registrants_count ?? 0);
  });
  protected attendancePercentage = computed(() => {
    const total = this.participantCount();
    const attended = this.attendedCount();
    return total > 0 ? Math.round((attended / total) * 100) : 0;
  });
  protected hasAttendanceData = computed(() => this.isPastMeeting() && this.participantCount() > 0);
  // Computed signals for invited/registration status
  public isInvited: Signal<boolean>;
  public effectivelyInvited: Signal<boolean>;
  public canLeaveMeeting: Signal<boolean>;
  public canResendInvite: Signal<boolean>;
  // Matches the BFF roster gate: an invitee sees the other guests only when the organizer shares them.
  protected attendeeListShared = computed(() => isMeetingAttendeeListShared(this.meeting()));
  protected canViewGuests = computed(() => !!this.meeting()?.organizer || (this.effectivelyInvited() && this.attendeeListShared()));
  public canRegisterForMeeting: Signal<boolean>;
  // Invited organizers respond directly alongside their guest overview.
  public canRespondAsOrganizer: Signal<boolean>;

  // Current user's RSVP for this meeting (null when not responded). Fetched at this level so a
  // confirmed organizer response reaches the guest overview and leaving can clear its registration.
  public currentUserRsvp: Signal<MeetingRsvp | null>;
  public overviewConfirmedRsvps: Signal<MeetingRsvp[]>;
  // Emits the freshly-submitted RSVP from the button-group so the chip updates immediately,
  // bypassing any query-service indexing lag that would otherwise return stale data on refetch.
  private readonly rsvpUpdateTrigger$ = new Subject<MeetingRsvp | null>();
  // Monotonic counter bumped on every manual RSVP update. Captured at fetch dispatch time and
  // checked on response; if it has advanced, the server response is stale relative to a newer
  // optimistic update and is dropped so the chip doesn't revert.
  private rsvpUpdateCounter = 0;

  // Form value signals for reactivity
  public formValues: Signal<{ name: string; email: string; organization: string }>;

  public constructor() {
    // Initialize all class variables
    this.authenticated = this.userService.authenticated;

    // Seed the client's first paint from the SSR-serialized state (matches the server's resolved
    // branch, no blank flash on hydration — GH-2041). Null on the server and on client
    // navigations with no prior SSR state for this component instance.
    const transferredMeeting = this.transferState.get(this.stateKey, null);
    // Consume the SSR state exactly once so a later re-creation of this component (e.g. a
    // different `/meetings/:id`) can't paint the previous meeting's state under the new URL.
    if (isPlatformBrowser(this.platformId) && transferredMeeting) {
      this.transferState.remove(this.stateKey);
    }
    if (transferredMeeting) {
      this.loadedViaPastMeetingId.set(transferredMeeting.loadedViaPastMeetingId);
      this.pastMeetingFullAccess.set(transferredMeeting.pastMeetingFullAccess);
      this.liveMeetingFullAccess.set(transferredMeeting.liveMeetingFullAccess ?? false);
      this.liveMeetingCanJoin.set(transferredMeeting.liveMeetingCanJoin ?? false);
      if (transferredMeeting.meetingLoadFailed) {
        this.meetingLoadFailed.set(true);
        // Seed `meetingRouteId` here too — otherwise the first hydration emission (route id vs.
        // the signal's initial `null`) reads as a navigation and clears this flag while the
        // client's matching refetch is still in flight, flashing the skeleton until it fails
        // again (cursor / copilot review on #2046).
        this.meetingRouteId.set(this.activatedRoute.snapshot.paramMap.get('id'));
      } else if (transferredMeeting.meeting) {
        this.project.set(transferredMeeting.meeting.project);
        const seededRouteId = this.activatedRoute.snapshot.paramMap.get('id');
        this.meetingRouteId.set(seededRouteId);
        this.meetingResolvedRouteId.set(seededRouteId);
      }
    }

    // Set synchronously from the route snapshot before `meeting` is exposed below —
    // `initializeSeriesOccurrences()` subscribes to `meeting` immediately and would otherwise
    // read `password` before the debounced pipeline (line ~755) gets a chance to set it,
    // sending a password-gated recurring meeting's occurrences request with no password.
    this.applyPassword(this.activatedRoute.snapshot.queryParamMap);

    this.meeting = this.initializeMeeting(transferredMeeting);
    this.currentOccurrence = this.initializeCurrentOccurrence();
    this.displayRecurrence = computed(() => resolveOccurrenceRecurrence(this.meeting(), this.currentOccurrence()));
    this.seriesOccurrences = this.initializeSeriesOccurrences();
    this.occurrenceContext = this.initializeOccurrenceContext();
    this.previousOccurrenceUrl = this.initializePreviousOccurrenceUrl();
    this.nextOccurrenceUrl = this.initializeNextOccurrenceUrl();
    this.occurrenceLabel = this.initializeOccurrenceLabel();
    this.joinForm = this.initializeJoinForm();
    this.formValues = this.initializeFormValues();
    this.meetingTypeBadge = this.initializeMeetingTypeBadge();

    this.meetingTitle = this.initializeMeetingTitle();
    bindLfxDocumentTitle(this.meetingTitle);
    this.meetingDescription = this.initializeMeetingDescription();
    this.hasAiCompanion = this.initializeHasAiCompanion();
    this.isPastMeeting = this.initializeIsPastMeeting();
    this.pastMeetingSummary = this.initializePastMeetingSummary();
    this.hasSummaryContent = this.initializeHasSummaryContent();
    this.summaryAwaitingApproval = this.initializeSummaryAwaitingApproval();
    this.pastMeetingRecording = this.initializePastMeetingRecording();
    const pastMeetingAttachmentsRaw = this.initializePastMeetingAttachments();
    this.pastMeetingAttachments = computed(() => {
      const deleted = this.optimisticDeletedUids();
      const added = this.optimisticAddedAttachments();
      const raw = pastMeetingAttachmentsRaw();
      const rawUids = new Set(raw.map((a) => a.uid));
      const filtered = deleted.size > 0 ? raw.filter((a) => !deleted.has(a.uid)) : raw;
      // Prepend optimistic additions not yet confirmed by the server
      const pending = added.filter((a) => !rawUids.has(a.uid) && !deleted.has(a.uid));
      return pending.length > 0 ? [...pending, ...filtered] : filtered;
    });
    // Clear optimistic state when navigating to a different past meeting so stale
    // entries from the previous meeting don't bleed into the next one's attachment list.
    toObservable(this.pastMeetingResourceId)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.optimisticDeletedUids.set(new Set());
        this.optimisticAddedAttachments.set([]);
      });

    // Reset post-registration optimistic flag when navigating to a different meeting so a
    // previous registration doesn't grant registrant-list access for an unrelated meeting.
    // Use getMeetingSeriesUid (not meeting.id) because past-occurrence composite ids differ
    // from the live-series uid — occurrence navigation must not clear the flag. Also clear the
    // guest-add pad/snapshot so a pending count from the previous meeting doesn't leak into
    // the next one's total.
    toObservable(this.meeting)
      .pipe(
        map((m) => (m ? getMeetingSeriesUid(m) : undefined)),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.optimisticInvited.set(false);
        this.optimisticAdditional.set(0);
        this.rosterCountBeforeAdd.set(null);
      });

    this.primaryRecordingUrl = this.initializePrimaryRecordingUrl();
    this.transcriptUrl = this.initializeTranscriptUrl();
    this.pastMeetingParticipants = this.initializePastMeetingParticipants();

    // Initialize invited/registration signals
    this.isInvited = this.initializeIsInvited();
    this.effectivelyInvited = computed(() => (this.isInvited() && !this.optimisticLeft()) || this.optimisticInvited());
    this.canLeaveMeeting = computed(() => this.effectivelyInvited());
    // Resending goes to the viewer's own registrant row, so it is offered under the same rule as removing it.
    this.canResendInvite = computed(() => this.canLeaveMeeting());
    this.canRegisterForMeeting = this.initializeCanRegisterForMeeting();
    this.canRespondAsOrganizer = this.initializeCanRespondAsOrganizer();
    this.currentUserRsvp = this.initializeCurrentUserRsvp();
    this.overviewConfirmedRsvps = this.initializeOverviewConfirmedRsvps();

    this.returnTo = this.initializeReturnTo();
    this.canJoinMeeting = this.initializeCanJoinMeeting();
    this.fetchedJoinUrl = this.initializeFetchedJoinUrl();
    this.zoomRedirectDisabled = toSignal(this.activatedRoute.queryParamMap.pipe(map((params) => params.get('zoom_redirect')?.toLowerCase() === 'false')), {
      initialValue: this.activatedRoute.snapshot.queryParamMap.get('zoom_redirect')?.toLowerCase() === 'false',
    });
    this.attachments = this.initializeAttachments();
    this.messageSeverity = this.initializeMessageSeverity();
    this.messageIcon = this.initializeMessageIcon();
    this.alertMessage = this.initializeAlertMessage();
    this.emailError = this.initializeEmailError();
    this.registrants = this.initializeRegistrants();
    this.parentProject = this.initializeParentProject();
    this.initializeAutoJoin();
    this.initializeLeaveFromLink();
    this.initializePublicMeetingPageviewTracking();

    // Runs after first render so the SSR skeleton hydrates before swapping to the timezone tag.
    afterNextRender(() => {
      this.userTimezone.set(getUserTimezone());
    });
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

    // meeting.password is stripped from the anonymous/guest response — fall back to the password
    // this client already validated against the server (query param or composer nav state).
    const password = meeting.password || this.password();
    if (password) {
      meetingUrl.searchParams.set('password', password);
    }
    this.clipboard.copy(meetingUrl.toString());
    this.messageService.add({
      severity: 'success',
      summary: 'Meeting Link Copied',
      detail: 'The meeting link has been copied to your clipboard',
    });
  }

  /** Opens the edit dialog (time, duration, title, agenda) for the occurrence this page is showing. */
  public rescheduleCurrentOccurrence(): void {
    const meeting = this.meeting();
    const occurrence = this.currentOccurrence();
    if (!occurrence) {
      return;
    }

    const dialogRef = this.dialogService.open(RescheduleOccurrenceDialogComponent, {
      header: 'Edit Occurrence',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { meeting, occurrence, maxDuration: this.meetingsV2Enabled() ? MAX_MEETING_DURATION : MAX_CUSTOM_DURATION },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingRescheduleOccurrenceResult | undefined) => {
      if (!result?.confirmed || !result.start_time) {
        return;
      }

      this.messageService.add({
        severity: 'success',
        summary: 'Occurrence updated',
        detail: 'Only this occurrence was changed. The rest of the series is unchanged.',
      });
      this.showOccurrenceAfterChange(new Date(result.start_time).getTime());
    });
  }

  /** Opens the cancel confirmation for the occurrence this page is showing. */
  public cancelCurrentOccurrence(): void {
    const meeting = this.meeting();
    const occurrence = this.currentOccurrence();
    if (!occurrence) {
      return;
    }

    const dialogRef = this.dialogService.open(CancelOccurrenceConfirmationComponent, {
      header: 'Cancel Occurrence',
      width: '450px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { meeting, occurrence },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingCancelOccurrenceResult | undefined) => {
      if (result?.confirmed) {
        this.messageService.add({
          severity: 'success',
          summary: 'Occurrence cancelled',
          detail: 'This occurrence was cancelled. The rest of the series is unchanged.',
        });
        this.showOccurrenceAfterChange(this.nextLiveOccurrenceStartMs());
      } else if (result?.error) {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: result.error });
      }
    });
  }

  public onRegistrantsToggle(): void {
    const meeting = this.meeting();
    if (!meeting.organizer && !meeting.invited && !this.optimisticInvited()) {
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
      // Only snapshot as a real baseline when the current roster is a confirmed, successful fetch
      // for this meeting+occurrence — otherwise `registrants()` may still hold the initial `[]`
      // (roster hasn't loaded yet) or a failure fallback, and reconcileOptimisticPad would treat
      // that unconfirmed value as "absorbed" on the next real fetch, zeroing the pad before the
      // added guests land.
      const meeting = this.meeting();
      const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence: this.currentOccurrence() });
      const hasConfirmedRoster = this.registrantsRosterKey() === this.buildRegistrantsRosterKey(meeting.id, occurrenceId);
      this.rosterCountBeforeAdd.set(hasConfirmedRoster ? this.registrants().length : null);
      this.optimisticAdditional.update((c) => c + addedCount);
    }
    this.registrantsRefresh$.next();
  }

  public onEmailErrorClick(): void {
    this.joinUrlError.set(null);
    this.joinUrlErrorCode.set(null);
    this.showGuestForm.set(true);
  }

  public onShowMembersPlaceholder(): void {
    this.messageService.add({ severity: 'info', summary: 'Coming Soon', detail: 'Attendees list will be available soon.', life: 3000 });
  }

  public onRsvpChanged(rsvp: MeetingRsvp): void {
    // rsvp-button-group emits the confirmed RSVP after the POST succeeds. Push it directly into the
    // signal stream so the chip updates instantly, even when the backend polling window times out
    // before the query service has indexed the new RSVP (server would still return stale on refetch).
    if (!this.userService.isMeetingRsvpCurrent(rsvp, this.meeting())) return;
    this.rsvpUpdateTrigger$.next(rsvp);
  }

  public openMaterialsDrawer(): void {
    this.materialsDrawerVisible.set(true);
  }

  public onMaterialsChanged({ deletedUids = [], addedAttachments = [] }: MaterialsChangedEvent = { deletedUids: [], addedAttachments: [] }): void {
    // Immediate refresh + delayed retry: upload writes to meeting-service via ITX,
    // reads come from query-service indexed asynchronously via NATS, so a single
    // immediate fetch can return stale data before the NATS event propagates.
    // Optimistic updates apply immediately; the re-fetch corrects state once indexed.
    if (this.loadedViaPastMeetingId()) {
      if (deletedUids.length > 0) {
        this.optimisticDeletedUids.update((set) => {
          const next = new Set(set);
          deletedUids.forEach((uid) => next.add(uid));
          return next;
        });
        // Remove from optimistic additions too: a link added then deleted in the same
        // drawer session must not reappear once the deletion exclusion is cleared.
        this.optimisticAddedAttachments.update((current) => current.filter((a) => !deletedUids.includes(a.uid)));
      }
      if (addedAttachments.length > 0) {
        this.optimisticAddedAttachments.update((current) => [...addedAttachments, ...current]);
      }
      this.pastMeetingAttachmentsRefresh$.next();
      timer(1000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.pastMeetingAttachmentsRefresh$.next());
    } else {
      this.refreshTrigger$.next();
      timer(1000)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.refreshTrigger$.next());
    }
  }

  public downloadAttachment(attachment: MeetingAttachment | PastMeetingAttachment): void {
    const download$ = this.loadedViaPastMeetingId()
      ? this.meetingService.getPastMeetingAttachmentDownloadUrl(getPastMeetingResourceId(this.meeting()), attachment.uid)
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
        this.optimisticInvited.set(true);
        this.meetingService.clearRemovedRegistration(meeting.id);
        this.registrantsRefresh$.next();
        this.refreshTrigger$.next();
      }
    });
  }

  public confirmLeaveMeeting(): void {
    this.confirmationService.confirm({
      header: 'Remove Yourself',
      message: getMeetingSelfRemovalMessage(this.meetingTitle(), { viaCommittee: this.meeting()?.invited_via_committee, organizer: this.meeting()?.organizer }),
      acceptLabel: 'Remove Me',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.leaveMeeting(),
      reject: () => this.leaveSource.set('meeting-join'),
    });
  }

  public resendInvite(): void {
    this.inviteResend.resendOwn(this.meeting().id, this.currentOccurrence()?.occurrence_id);
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

  public openTranscriptModal(): void {
    const meeting = this.meeting();
    if (!meeting) return;

    this.dialogService.open(TranscriptModalComponent, {
      header: 'Transcript',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { pastMeetingUid: getPastMeetingResourceId(meeting), meetingTitle: meeting.title },
    });
  }

  private initializeAutoJoin(): void {
    // Use toObservable to create an Observable from the signals, then subscribe once
    // This executes only when all conditions are met
    combineLatest([toObservable(this.fetchedJoinUrl), toObservable(this.zoomRedirectDisabled)])
      .pipe(
        // Take only the first emission where we have a valid URL and haven't auto-joined yet
        // Only auto-join for authenticated users using their own email (not guest form)
        filter(([url, zoomRedirectDisabled]) => {
          const authenticated = this.authenticated();
          const user = this.joinIdentity();
          const canJoin = this.canJoinMeeting();
          const alreadyJoined = this.hasAutoJoined();
          const usingGuestForm = this.showGuestForm();

          return !!url && authenticated && !!user && !!user.email && canJoin && !alreadyJoined && !usingGuestForm && !zoomRedirectDisabled;
        }),
        // Take only the first valid URL
        take(1)
      )
      .subscribe(([url]) => {
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

  private initializeMeeting(seed: MeetingJoinPageState | null) {
    const meeting$ = combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap, this.refreshTrigger$]).pipe(
      // Update `meetingRouteId` here, ahead of `debounceTime`, so `meetingMatchesRoute` flips to
      // false the instant a route change is observed. Setting it inside `switchMap` instead left a
      // one-macrotask window (the debounce itself) where the old route's id was still current and
      // the template kept rendering the previous meeting's content under the new URL
      // (copilot review on #2046).
      tap(([params]) => {
        const meetingId = params.get('id');
        const previousRouteId = this.meetingRouteId();
        this.meetingRouteId.set(meetingId);
        // Only clear a stale `meetingLoadFailed` when the route id actually changed (a real
        // navigation to a different meeting) — not on a same-route re-emission (`refreshTrigger$`,
        // or the initial hydration matching a seeded terminal-error state). Otherwise a prior
        // same-route background failure (dealako review on #2046) would still be flagged when
        // navigating away, and the new route's `!meetingMatchesRoute()` mismatch would trip the
        // error branch immediately, before this attempt's fetch even starts (cursor review on #2046).
        if (meetingId !== previousRouteId) {
          this.meetingLoadFailed.set(false);
        }
      }),
      debounceTime(0), // Coalesce rapid SSR hydration emissions so the fallback chain isn't canceled
      switchMap(([params, queryParams]) => {
        const meetingId = params.get('id');
        this.applyPassword(queryParams);

        // A signed-out visitor is sent to login by the browser; fetching here would bounce a private meeting to not-found first.
        if (isPlatformServer(this.platformId) && queryParams.get('action') === 'leave' && !this.authenticated()) {
          return EMPTY;
        }

        if (!meetingId) {
          this.router.navigate(['/meetings/not-found']);
          return EMPTY;
        }

        let result$: Observable<{ meeting: Meeting; project: PublicMeetingProject }>;

        // Check if this is a past meeting occurrence ID (format: meetingId-timestamp)
        if (isPastMeetingCompositeId(meetingId)) {
          this.loadedViaPastMeetingId.set(true);
          result$ = this.meetingService.getPublicPastMeeting(meetingId).pipe(
            tap((res: PublicPastMeetingResponse) => {
              this.pastMeetingFullAccess.set(res.full_access);
            }),
            map((res: PublicPastMeetingResponse) => ({
              // Preserve the legacy join-page view model without claiming a complete PastMeeting at the HTTP boundary.
              meeting: res.meeting as Meeting,
              project: res.project,
            })),
            catchError((error) => {
              if ([404, 403, 400].includes(error.status)) {
                this.router.navigate(['/meetings/not-found']);
              } else {
                this.setMeetingLoadFailed();
              }
              return EMPTY;
            })
          );
        } else {
          // No hyphen — could be upcoming or past. Try upcoming first. Flags are reset to
          // "upcoming" only once that lookup actually succeeds (tap below), not eagerly here —
          // a seeded past-meeting id re-entering this branch on hydration (e.g. refreshTrigger$)
          // would otherwise flip to the upcoming/default view and cancel the past-meeting's
          // summary/recording/attachments/participant streams before the 404 fallback resolves.
          result$ = this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
            tap((res: PublicMeetingResponse) => {
              this.loadedViaPastMeetingId.set(false);
              this.pastMeetingFullAccess.set(false);
              this.liveMeetingFullAccess.set(res.full_access);
              this.liveMeetingCanJoin.set(res.can_join);
            }),
            map((res: PublicMeetingResponse) => ({
              // Preserve the legacy join-page view model without claiming a complete Meeting at the HTTP boundary.
              meeting: res.meeting as Meeting,
              project: res.project,
            })),
            catchError((error) => {
              if (error.status === 404) {
                return this.meetingService.getPublicPastMeeting(meetingId).pipe(
                  tap((res: PublicPastMeetingResponse) => {
                    this.loadedViaPastMeetingId.set(true);
                    this.pastMeetingFullAccess.set(res.full_access);
                  }),
                  map((res: PublicPastMeetingResponse) => ({
                    // Preserve the legacy join-page view model without claiming a complete PastMeeting at the HTTP boundary.
                    meeting: res.meeting as Meeting,
                    project: res.project,
                  })),
                  catchError((fallbackError) => {
                    if ([404, 403, 400].includes(fallbackError.status)) {
                      this.router.navigate(['/meetings/not-found']);
                    } else {
                      this.setMeetingLoadFailed();
                    }
                    return EMPTY;
                  })
                );
              }
              if ([403, 400].includes(error.status)) {
                this.router.navigate(['/meetings/not-found']);
              } else {
                this.setMeetingLoadFailed();
              }
              return EMPTY;
            })
          );
        }

        return result$;
      }),
      map((res) => ({ ...res.meeting, project: res.project })),
      tap((res) => {
        this.project.set(res.project);
        // Clear any prior terminal-error state here, not eagerly at the top of the pipeline —
        // clearing eagerly would reset a seeded terminal-error hydration before the refetch it
        // triggers actually settles, flashing the error view back to the skeleton (GH-2041
        // follow-up). Only a settled success should clear it.
        this.meetingLoadFailed.set(false);
        this.meetingResolvedRouteId.set(this.meetingRouteId());
        // Persist the resolved state during SSR so the client can hydrate to the same branch.
        // Angular defers serialization until this tracked HTTP call settles.
        if (isPlatformServer(this.platformId)) {
          this.transferState.set(this.stateKey, {
            meeting: res,
            loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
            pastMeetingFullAccess: this.pastMeetingFullAccess(),
            liveMeetingFullAccess: this.liveMeetingFullAccess(),
            liveMeetingCanJoin: this.liveMeetingCanJoin(),
            meetingLoadFailed: false,
          });
        }
      })
    );

    // Two overload shapes rather than one `initialValue: seed?.meeting` call — `toSignal`'s
    // `initialValue` overload requires a value assignable to `T`, not `T | undefined`, so the
    // branch is on `seed?.meeting` itself rather than threading the optionality through the
    // option object. A seed carrying the terminal-error branch (`meeting: null`) falls through to
    // the no-initial-value overload — `meetingLoadFailed` (seeded synchronously in the
    // constructor) already renders the SSR-matching error branch before this signal settles.
    return (seed?.meeting ? toSignal(meeting$, { initialValue: seed.meeting }) : toSignal(meeting$)) as Signal<Meeting & { project: PublicMeetingProject }>;
  }

  // Persists the terminal-error branch during SSR so the client hydrates to the same error view
  // instead of starting `meetingLoadFailed` at `false` and tearing down the SSR-rendered error
  // content (GH-2041 follow-up). Mirrors the success-path `TransferState` write in `initializeMeeting`.
  private setMeetingLoadFailed(): void {
    this.meetingLoadFailed.set(true);
    if (isPlatformServer(this.platformId)) {
      this.transferState.set(this.stateKey, {
        meeting: null,
        loadedViaPastMeetingId: this.loadedViaPastMeetingId(),
        pastMeetingFullAccess: this.pastMeetingFullAccess(),
        liveMeetingFullAccess: this.liveMeetingFullAccess(),
        liveMeetingCanJoin: this.liveMeetingCanJoin(),
        meetingLoadFailed: true,
      });
    }
  }

  // Prefers the `?password=` query param, falling back to the router navigation state that the
  // composer's post-create toast link carries. The composer keeps the password out of the URL --
  // a query param writes a shared secret into the address bar, the history entry, the `Referer`
  // header of anything this page later loads, and every proxy log in between -- but the param
  // remains the shared shape everywhere else (meeting cards, copied join links), so it still wins
  // when present.
  //
  // The two sources are recorded separately because they are not equally safe to pass on: a param
  // password is already in this URL, a state password is deliberately not, and only the first may
  // be written into a link this page generates.
  private applyPassword(queryParams: ParamMap): void {
    const fromQuery = queryParams.get('password');
    this.urlPassword.set(fromQuery);
    this.password.set(fromQuery || this.statePassword());
  }

  /**
   * Re-reads the series after an occurrence was moved or cancelled and points the page at the right one.
   * @description The `occurrence` query param is the occurrence's start instant, and a reschedule gives
   * the occurrence a new one — so it is rewritten to `startMs`. A cancel passes the successor's start,
   * or `null` when there is none so the page falls through to whatever is still active. The explicit refresh covers the case where the
   * URL does not change, which the router treats as a no-op.
   */
  private showOccurrenceAfterChange(startMs: number | null): void {
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: { occurrence: startMs === null ? null : String(startMs) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.seriesOccurrencesRefresh$.next();
    this.refreshTrigger$.next();
  }

  // The password the composer's post-create toast hands over in router navigation state.
  // `history` is browser-only, so the read is guarded; on the server the query param is the only
  // source a page has.
  private statePassword(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    const stated = (history.state as { password?: unknown } | null)?.password;
    return typeof stated === 'string' && stated ? stated : null;
  }

  private initializeCurrentOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      const meeting = this.meeting();
      // Check if a specific occurrence was requested via query param
      const requestedOccurrence = this.activatedRoute.snapshot.queryParamMap.get('occurrence');
      if (requestedOccurrence && meeting?.occurrences?.length) {
        const requestedTime = parseInt(requestedOccurrence, 10);
        const active = getActiveOccurrences(meeting.occurrences, meeting.cancelled_occurrences);
        const match = active.find((o: MeetingOccurrence) => new Date(o.start_time).getTime() === requestedTime);
        if (match) return match;
      }
      return getCurrentOrNextOccurrence(meeting);
    });
  }

  /**
   * Fetches the full series timeline (past + future occurrences) for recurring meetings.
   * Skipped on the server — the nav is progressive enhancement; the client fetches at hydration.
   */
  private initializeSeriesOccurrences(): Signal<PublicMeetingOccurrencesResponse> {
    const empty: PublicMeetingOccurrencesResponse = { past: [], future: [] };
    if (isPlatformServer(this.platformId)) {
      return signal(empty).asReadonly();
    }
    return toSignal(
      toObservable(this.meeting).pipe(
        // Recurring meetings always fetch. Past payloads (composite id ≠ series uid) fetch even
        // without a recurrence rule — the ITX past_meetings payload omits `recurrence` entirely,
        // and the timeline itself reveals whether there is anywhere to navigate.
        filter((meeting) => !!meeting && (!!meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id)),
        map((meeting) => getMeetingSeriesUid(meeting)),
        distinctUntilChanged(),
        switchMap((seriesUid) =>
          this.seriesOccurrencesRefresh$.pipe(switchMap(() => this.meetingService.getPublicMeetingOccurrences(seriesUid, this.password())))
        )
      ),
      { initialValue: empty }
    );
  }

  // Upstream enforces `organizer` on both occurrence writes; this only decides whether to offer them.
  private initCanManageOccurrence(): Signal<boolean> {
    return computed(
      () =>
        this.authenticated() &&
        !!this.meeting()?.organizer &&
        !!this.meeting()?.recurrence &&
        !this.loadedViaPastMeetingId() &&
        !this.isPastMeeting() &&
        !!this.currentOccurrence()
    );
  }

  /**
   * Start instant (ms) of the live occurrence after the one this page is showing, or `null` if none.
   * @description Read before a cancel lands: once the cancelled slot drops out of the timeline, clearing
   * `?occurrence=` would fall back to the series' earliest upcoming occurrence rather than this one's
   * successor. Past records are excluded — they are never a cancel's natural next stop.
   */
  private nextLiveOccurrenceStartMs(): number | null {
    const { sorted, currentIdx } = this.occurrenceContext();
    const next = currentIdx >= 0 ? sorted[currentIdx + 1] : undefined;
    if (!next || next.meeting_and_occurrence_id) {
      return null;
    }
    return new Date(next.start_time).getTime();
  }

  private initializeOccurrenceContext(): Signal<{ sorted: OccurrenceNavItem[]; currentIdx: number }> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return { sorted: [], currentIdx: -1 };
      // On past pages the payload's occurrences (if any) describe the live series, not the
      // viewed occurrence — the merged timeline below supplies both directions instead.
      const liveOccurrences = !this.loadedViaPastMeetingId() ? getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences) : [];
      const sorted = buildOccurrenceNavTimeline(liveOccurrences, this.seriesOccurrences(), meeting.duration);
      if (sorted.length === 0) return { sorted, currentIdx: -1 };

      const routeId = this.activatedRoute.snapshot.paramMap.get('id') ?? '';
      if (this.loadedViaPastMeetingId()) {
        // The route id IS the composite past-occurrence id — match it directly first
        const idxById = sorted.findIndex((o: OccurrenceNavItem) => o.meeting_and_occurrence_id === routeId);
        if (idxById >= 0) return { sorted, currentIdx: idxById };
      }

      const current = this.currentOccurrence();
      let currentTime: number;
      if (current) {
        currentTime = new Date(current.start_time).getTime();
      } else {
        // For past meetings loaded via /meetings/{id}-{timestamp}, extract timestamp from route
        const parts = routeId.split('-');
        currentTime = parts.length === 2 && /^\d{13}$/.test(parts[1]) ? parseInt(parts[1], 10) : Date.now();
      }
      let currentIdx = sorted.findIndex((o: OccurrenceNavItem) => new Date(o.start_time).getTime() === currentTime);
      if (currentIdx < 0) {
        currentIdx = sorted.findIndex((o: OccurrenceNavItem) => new Date(o.start_time).getTime() >= currentTime);
      }
      if (currentIdx < 0) currentIdx = sorted.length - 1;
      return { sorted, currentIdx };
    });
  }

  private buildOccurrenceUrl(seriesUid: string, occurrence: OccurrenceNavItem): string {
    // `urlPassword`, not `password`: these are plain `href`s, so anything put here lands in the
    // address bar, the history entry and the `Referer` of whatever the next page loads. Forwarding a
    // param that is already visible here changes nothing; forwarding a password the composer handed
    // over in navigation state would publish a secret that was deliberately kept out of the URL.
    // A visitor who arrived that way is asked for the password on the next occurrence instead,
    // exactly as they would be reaching that occurrence from anywhere else.
    const password = this.urlPassword();
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    // Past record: its composite id is the canonical past-meeting URL — never reconstruct from start_time
    if (occurrence.meeting_and_occurrence_id) {
      const base = `/meetings/${occurrence.meeting_and_occurrence_id}`;
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
    const timestamp = new Date(occurrence.start_time).getTime();
    const meeting = this.meeting();
    const isPast = hasMeetingEnded(meeting, occurrence);
    if (isPast) {
      const base = `/meetings/${seriesUid}-${timestamp}`;
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
    params.set('occurrence', timestamp.toString());
    return `/meetings/${seriesUid}?${params.toString()}`;
  }

  private initializePreviousOccurrenceUrl(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (currentIdx <= 0) return null;
      return this.buildOccurrenceUrl(getMeetingSeriesUid(meeting), sorted[currentIdx - 1]);
    });
  }

  private initializeNextOccurrenceUrl(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (currentIdx < 0 || currentIdx >= sorted.length - 1) return null;
      return this.buildOccurrenceUrl(getMeetingSeriesUid(meeting), sorted[currentIdx + 1]);
    });
  }

  private initializeOccurrenceLabel(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return null;
      const { sorted, currentIdx } = this.occurrenceContext();
      if (sorted.length === 0) return null;
      // Payloads without a recurrence rule (e.g. past pages) only surface the nav when the
      // series timeline actually has somewhere to go.
      if (!meeting.recurrence && sorted.length < 2) return null;
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

      // meeting.password is stripped from the anonymous/guest response — fall back to the password
      // this client already validated against the server (query param or composer nav state).
      const password = meeting.password || this.password();
      if (password) {
        params.set('password', password);
      }
      const queryString = params.toString();
      return queryString ? `${environment.urls.home}/meetings/${meeting.id}?${queryString}` : `${environment.urls.home}/meetings/${meeting.id}`;
    });
  }

  private initializeCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      // Hyphenated occurrence-ID URL expresses "view as past" intent — never show Join UI.
      if (this.loadedViaPastMeetingId()) return false;
      // Anonymous/guest responses strip the timing fields canJoinMeeting() needs — use the
      // server-computed can_join instead of running the (always-false) client-side timing check.
      if (!this.liveMeetingFullAccess()) return this.liveMeetingCanJoin();
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
          const user = this.joinIdentity();

          // Reset error state
          this.joinUrlError.set(null);
          this.joinUrlErrorCode.set(null);

          if (isPlatformServer(this.platformId)) {
            this.isLoadingJoinUrl.set(false);
            return of(undefined);
          }

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

    // meeting.password is stripped from the anonymous/guest response — fall back to the password
    // this client already validated against the server (query param or composer nav state).
    return this.meetingService.getPublicMeetingJoinUrl(meeting.id, meeting.password || this.password(), { email }).pipe(
      map((res) => {
        this.isLoadingJoinUrl.set(false);
        if (res.link) {
          // For authenticated users, use the user object
          // For guests, pass name and organization from form
          if (this.authenticated()) {
            return buildJoinUrlWithParams(res.link, this.joinIdentity());
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
        this.joinUrlErrorCode.set(error?.error?.code ?? null);
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
    return computed(() => this.meeting()?.ai_summary_enabled || false);
  }

  private initializeIsInvited(): Signal<boolean> {
    return computed(() => this.meeting()?.invited ?? false);
  }

  private initializeCanRegisterForMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      return !this.effectivelyInvited() && !meeting?.restricted && meeting?.visibility === 'public';
    });
  }

  private initializeCanRespondAsOrganizer(): Signal<boolean> {
    return computed(() => !!this.meeting()?.organizer && this.effectivelyInvited() && this.inviteResponsesEnabled());
  }

  private initializeCurrentUserRsvp(): Signal<MeetingRsvp | null> {
    const meeting$ = toObservable(this.meeting);
    const occurrence$ = toObservable(this.currentOccurrence);
    const authenticated$ = toObservable(this.authenticated);
    const canRespond$ = toObservable(this.canRespondAsOrganizer);
    const identity$ = toObservable(this.userService.meetingFeedIdentity);

    // Fetch trigger: meeting/occurrence/auth/canRespond/viewer-identity changes. Deduped on a stable key
    // so that derived signals settling in the same microtask don't cause redundant emissions. An in-place
    // subject swap (impersonation) refetches and clears the previous viewer's answer while pending.
    const fetchTrigger$ = combineLatest([meeting$, occurrence$, authenticated$, canRespond$, identity$]).pipe(
      distinctUntilChanged(([m1, o1, a1, c1, i1], [m2, o2, a2, c2, i2]) => {
        const occ1 = m1?.recurrence ? o1?.occurrence_id : undefined;
        const occ2 = m2?.recurrence ? o2?.occurrence_id : undefined;
        return m1?.id === m2?.id && occ1 === occ2 && a1 === a2 && c1 === c2 && i1 === i2;
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
          const [meeting, occurrence, authenticated, canRespond] = evt.data;
          // Only fetch when the user can actually RSVP (organizer + invited).
          if (!authenticated || !canRespond || !meeting?.id) {
            return of(null);
          }
          const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence });
          const allDatesOnly = !!meeting.recurrence && !occurrenceId;
          // Capture the current update revision at fetch dispatch time. If a manual update
          // bumps the counter before the server response arrives (typically because the
          // query-service hasn't indexed the new RSVP yet), the filter drops both the
          // `startWith(null)` reset and the stale server value so the optimistic local
          // update stays visible and the chip doesn't flash back.
          const counterAtDispatch = this.rsvpUpdateCounter;
          return this.meetingService.getMeetingRsvpForCurrentUser(meeting.id, occurrenceId, allDatesOnly).pipe(
            startWith(null),
            filter(() => this.rsvpUpdateCounter === counterAtDispatch),
            map((rsvp) => (rsvp && this.userService.isMeetingRsvpCurrent(rsvp, meeting) ? rsvp : null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  // Hands the confirmed organizer responses to the overview so its counts update before the roster re-indexes.
  // Retained answers outlive an occurrence switch or remount (whose lookup restarts at `null`); the overview
  // applies each one by date, matching the meeting card.
  private initializeOverviewConfirmedRsvps(): Signal<MeetingRsvp[]> {
    return computed(() => {
      const meeting = this.meeting();
      const rsvp = this.currentUserRsvp();
      const retained = meeting?.id
        ? this.userService.confirmedMeetingRsvps(meeting.id).filter((saved) => this.userService.isMeetingRsvpCurrent(saved, meeting))
        : [];
      return rsvp ? [...retained, rsvp] : retained;
    });
  }

  private initializeEmailError(): Signal<boolean> {
    return computed(() => this.joinUrlErrorCode() === 'NOT_REGISTERED_FOR_MEETING');
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

  // `meeting` re-emits a new object for the same resource on hydration refetch (the seeded value
  // is replaced once `meeting$` resolves) — dedupe on the pair that actually determines whether a
  // past-meeting resource fetch should (re)run, so that refetch doesn't cancel/restart every one
  // of these fan-out requests for no reason. `refreshTrigger` carries an explicit refresh signal
  // through undeduped, since its whole purpose is to force a refetch even when the key is stable.
  private pastMeetingResourceKey$<T>(refreshTrigger: Observable<T>): Observable<{ hasAccess: boolean; id: string | null }> {
    // `refreshTrigger` emissions must always force a refetch, even when `hasAccess`/`id` are
    // unchanged — tagging each emission with a monotonically increasing tick (rather than the
    // trigger's own value, which for a void `Subject` is always the same) keeps every refresh
    // distinct from the previous key so `distinctUntilChanged` below never swallows one.
    const tick$ = refreshTrigger.pipe(scan((count) => count + 1, 0));
    return combineLatest([toObservable(this.pastMeetingFullAccess), toObservable(this.meeting), tick$]).pipe(
      map(([hasAccess, meeting, tick]) => ({ hasAccess, id: meeting ? getPastMeetingResourceId(meeting) : null, tick })),
      distinctUntilChanged((a, b) => a.hasAccess === b.hasAccess && a.id === b.id && a.tick === b.tick),
      map(({ hasAccess, id }) => ({ hasAccess, id }))
    );
  }

  private initializePastMeetingSummary(): Signal<PastMeetingSummary | null> {
    return toSignal(
      this.pastMeetingResourceKey$(of(null)).pipe(
        switchMap(({ hasAccess, id }) => {
          if (!hasAccess || !id || !this.authenticated()) return of(null);
          return this.meetingService.getPastMeetingSummary(id).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initializePastMeetingRecording(): Signal<PastMeetingRecording | null> {
    return toSignal(
      this.pastMeetingResourceKey$(of(null)).pipe(
        switchMap(({ hasAccess, id }) => {
          if (!hasAccess || !id || !this.authenticated()) return of(null);
          return this.meetingService.getPastMeetingRecording(id).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initializePastMeetingAttachments(): Signal<PastMeetingAttachment[]> {
    return toSignal(
      this.pastMeetingResourceKey$(this.pastMeetingAttachmentsRefresh$).pipe(
        switchMap(({ hasAccess, id }) => {
          if (!hasAccess || !id || !this.authenticated()) return of([] as PastMeetingAttachment[]);
          return this.meetingService.getPastMeetingAttachments(id).pipe(
            tap((attachments) => {
              const fetchedUids = new Set(attachments.map((a) => a.uid));
              // Only drop a deleted UID from the exclusion set when the server confirms
              // it is absent — stale fetches leave the filter intact.
              this.optimisticDeletedUids.update((deleted) => {
                if (deleted.size === 0) return deleted;
                const remaining = new Set([...deleted].filter((uid) => fetchedUids.has(uid)));
                return remaining.size === deleted.size ? deleted : remaining;
              });
              // Drop optimistic additions that the server now confirms are indexed.
              this.optimisticAddedAttachments.update((added) => added.filter((a) => !fetchedUids.has(a.uid)));
            }),
            catchError(() => of([] as PastMeetingAttachment[]))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializePastMeetingParticipants(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      this.pastMeetingResourceKey$(of(null)).pipe(
        switchMap(({ hasAccess, id }) => {
          if (!hasAccess || !id || !this.authenticated()) return of([] as PastMeetingParticipant[]);
          return this.meetingService.getPastMeetingParticipants(id).pipe(catchError(() => of([] as PastMeetingParticipant[])));
        })
      ),
      { initialValue: [] }
    );
  }

  private initializePrimaryRecordingUrl(): Signal<string | null> {
    return computed(() => getLargestSessionShareUrl(this.pastMeetingRecording()));
  }

  private initializeHasSummaryContent(): Signal<boolean> {
    return computed(() => {
      const data = this.pastMeetingSummary()?.summary_data;
      return !!(data?.edited_content || data?.content);
    });
  }

  // "Pending" only applies when the summary requires approval and isn't approved
  // yet — summaries that never required approval are not pending.
  private initializeSummaryAwaitingApproval(): Signal<boolean> {
    return computed(() => isPastMeetingSummaryAwaitingApproval(this.pastMeetingSummary()));
  }

  private initializeTranscriptUrl(): Signal<string | null> {
    // Transcripts are a separate query-service resource — NOT part of the
    // recording's recording_files — so they must be fetched independently.
    return toSignal(
      this.pastMeetingResourceKey$(of(null)).pipe(
        switchMap(({ hasAccess, id }) => {
          if (!hasAccess || !id || !this.authenticated()) return of(null);
          return this.meetingService.getPastMeetingTranscript(id).pipe(
            map((transcript) => getPastMeetingTranscriptUrl(transcript)),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  // The server resolves the foundation project and maps root-level projects to null (LFXV2-3266) —
  // no client fetch needed here anymore.
  private initializeParentProject(): Signal<PublicMeetingParentProject | null> {
    return computed(() => this.project()?.parent ?? null);
  }

  // PlausibleService defers the auto-pageview for /meetings/:id — fire it here once context lands.
  private initializePublicMeetingPageviewTracking(): void {
    if (isPlatformServer(this.platformId)) {
      return;
    }
    // The parent (foundation) now arrives in the same payload as the project (LFXV2-3266), so no
    // race against a separate fetch is needed here anymore — just wait for the project itself.
    const pageviewContext$ = toObservable(this.project).pipe(
      filter((p): p is PublicMeetingProject => !!p?.slug),
      map((project) => ({ project, parent: project.parent })),
      take(1)
    );
    // trackPage() silently drops calls made before the Plausible script executes, and this route's
    // pageview is deferred to this component — hold the single emission until the script is ready
    // instead of losing the pageview when project context resolves faster than the script loads.
    const analyticsReady$ = toObservable(this.plausibleService.ready).pipe(filter(Boolean));
    combineLatest([pageviewContext$, analyticsReady$])
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(([{ project, parent }]) => {
        const isTopLevel = !project.parent_uid;
        this.plausibleService.trackPage(
          PlausibleService.buildPageviewContext({
            foundationSlug: isTopLevel ? project.slug : parent?.slug,
            foundationName: isTopLevel ? project.name : parent?.name,
            projectSlug: isTopLevel ? undefined : project.slug,
            projectName: isTopLevel ? undefined : project.name,
          })
        );
      });
  }

  /** Builds the composite key `initializeRegistrants` uses to detect a stale roster fallback. */
  private buildRegistrantsRosterKey(meetingId: string, occurrenceId: string | undefined): string {
    return `${meetingId}::${occurrenceId ?? ''}`;
  }

  private initializeRegistrants(): Signal<MeetingRegistrant[]> {
    return toSignal(
      combineLatest([
        toObservable(this.meeting).pipe(distinctUntilChanged((a, b) => a?.id === b?.id)),
        toObservable(this.currentOccurrence).pipe(distinctUntilChanged((a, b) => a?.occurrence_id === b?.occurrence_id)),
        toObservable(this.authenticated),
        this.registrantsRefresh$,
        toObservable(this.optimisticInvited),
      ]).pipe(
        switchMap(([meeting, occurrence, authenticated, , optimisticInvited]) => {
          const canViewGuests = meeting?.organizer || ((meeting?.invited || optimisticInvited) && isMeetingAttendeeListShared(meeting));
          if (!meeting?.id || !authenticated || !canViewGuests || this.isPastMeeting()) {
            // No fetch will happen on this branch (unauthenticated, not allowed to see the guests, or
            // a past meeting) — clear the loading flag so the RSVP card doesn't hang on a skeleton.
            this.registrantsLoading.set(false);
            return of([] as MeetingRegistrant[]);
          }
          this.registrantsLoading.set(true);
          const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence });
          const allDatesOnly = isMeetingInviteResponsesEnabled(meeting) && !!meeting.recurrence && !occurrenceId;
          return this.meetingService.getMyMeetingRegistrants(meeting.id, true, occurrenceId, false, allDatesOnly).pipe(
            tap((list) => {
              // Only the rows the refetch has actually absorbed come off the pad — a partial
              // catch-up must not zero out rows the query-service index hasn't reflected yet.
              const next = reconcileOptimisticPad({
                pad: this.optimisticAdditional(),
                before: this.rosterCountBeforeAdd(),
                current: list.length,
              });
              this.optimisticAdditional.set(next.pad);
              this.rosterCountBeforeAdd.set(next.before);
              this.registrantsRosterKey.set(this.buildRegistrantsRosterKey(meeting.id, occurrenceId));
            }),
            catchError((error) => {
              // A failed refetch for the SAME meeting+occurrence must not reach reconcileOptimisticPad
              // as an empty list — that would look like "the roster shrank to zero" and zero out a
              // pending pad for guests that were actually added. But if the last successful fetch
              // belongs to a DIFFERENT meeting or occurrence (this component is reused across
              // in-place `meetings/:id` navigations, and the roster carries per-occurrence `rsvp`
              // data), `registrants()` is stale — falling back to it would either leak a previous
              // meeting's registrant names/emails, or show accepted/declined chips from the wrong
              // occurrence, so fall back to empty instead.
              console.error(`Failed to refresh registrants for meeting ${meeting.id}:`, error);
              const isSameRoster = this.registrantsRosterKey() === this.buildRegistrantsRosterKey(meeting.id, occurrenceId);
              if (!isSameRoster) {
                // Discarding a stale roster for a different meeting/occurrence — clear the key so a
                // later failure back on THIS meeting/occurrence doesn't mistake the resulting empty
                // list for a confirmed roster and let a guest-add snapshot `before = 0`.
                this.registrantsRosterKey.set(null);
              }
              return of(isSameRoster ? this.registrants() : []);
            }),
            finalize(() => this.registrantsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  /**
   * Handles the "remove yourself" link in invite emails and calendar events (`?action=leave`).
   * A signed-out visitor goes through login and comes back to the same link; a signed-in one gets the
   * usual removal confirmation once the meeting has loaded. Removal itself never runs from the link,
   * only from the confirmation, so a prefetched or forwarded link changes nothing.
   */
  private initializeLeaveFromLink(): void {
    if (!isPlatformBrowser(this.platformId) || this.activatedRoute.snapshot.queryParamMap.get('action') !== 'leave') {
      return;
    }

    // A new Zoom tab would bury the confirmation; stays off for the visit, including after the param is dropped.
    this.hasAutoJoined.set(true);

    const { paramMap, queryParamMap } = this.activatedRoute.snapshot;
    const leaveRouteId = paramMap.get('id');

    if (!this.authenticated()) {
      // `router.url` still holds the previous URL while the first navigation is in flight, so the link is rebuilt from the route.
      const returnParams = new URLSearchParams({ action: 'leave' });
      const password = queryParamMap.get('password');
      if (password) {
        returnParams.set('password', password);
      }
      window.location.href = `/login?returnTo=${encodeURIComponent(`/meetings/${encodeURIComponent(leaveRouteId ?? '')}?${returnParams.toString()}`)}`;
      return;
    }

    combineLatest([toObservable(this.meeting), toObservable(this.meetingMatchesRoute)])
      .pipe(
        // Tied to the meeting the link named, so a reused component navigating elsewhere never prompts for another meeting.
        filter(([meeting, matchesRoute]) => matchesRoute && !!meeting?.id && this.meetingRouteId() === leaveRouteId),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        // Drop the param so a refresh or a later visit doesn't ask again.
        this.router.navigate([], { relativeTo: this.activatedRoute, queryParams: { action: null }, queryParamsHandling: 'merge', replaceUrl: true });

        if (!this.canLeaveMeeting()) {
          this.messageService.add({ severity: 'info', summary: 'Not registered', detail: 'You are not registered for this meeting.' });
          return;
        }
        this.leaveSource.set('email-link');
        this.confirmLeaveMeeting();
      });
  }

  private leaveMeeting(): void {
    const meetingId = this.meeting().id;
    const subject = this.userService.user()?.sub || this.userService.viewerUsername() || this.userService.user()?.email || '';
    this.leavingMeeting.set(true);

    this.meetingService
      .removeMyMeetingRegistration(meetingId, this.leaveSource())
      .pipe(
        take(1),
        finalize(() => {
          this.leavingMeeting.set(false);
          this.leaveSource.set('meeting-join');
        })
      )
      .subscribe({
        next: (result) => {
          this.userService.clearConfirmedMeetingRsvps(meetingId, subject, result);
          const currentSubject = this.userService.user()?.sub || this.userService.viewerUsername() || this.userService.user()?.email || '';
          if (this.meeting().id !== meetingId || currentSubject !== subject) return;
          if (result.remaining_registrant_ids.length > 0) {
            const meeting = this.meeting();
            const occurrenceId = resolveRsvpOccurrenceId(meeting, { occurrence: this.currentOccurrence() });
            const currentRsvp = this.currentUserRsvp();
            const candidates = [...this.userService.confirmedMeetingRsvps(meetingId), ...(currentRsvp ? [currentRsvp] : [])].filter(
              (rsvp) => this.userService.isMeetingRsvpCurrent(rsvp, meeting) && (!meeting.recurrence || !!occurrenceId || rsvp.scope === 'all')
            );
            this.rsvpUpdateTrigger$.next(selectApplicableRsvp(occurrenceId, candidates));
            this.optimisticInvited.set(true);
            this.messageService.add({
              severity: 'warn',
              summary: 'Removal incomplete',
              detail: 'Some of your registrations could not be removed. You are still invited to this meeting. Please try again.',
            });
            this.userService.refreshUserMeetings(false);
          } else {
            this.rsvpUpdateTrigger$.next(null);
            this.optimisticInvited.set(false);
            this.meetingService.markRegistrationRemoved(meetingId);
            this.messageService.add({
              severity: 'success',
              summary: 'Removed',
              detail: 'You have been removed from this meeting.',
            });
          }
          this.registrantsRefresh$.next();
          this.refreshTrigger$.next();
        },
        error: (error: unknown) => {
          const fallback = 'Unable to remove you from this meeting. Please try again.';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: isBffValidationError(error) ? extractErrorMessage(error, fallback) : fallback,
          });
        },
      });
  }
}
