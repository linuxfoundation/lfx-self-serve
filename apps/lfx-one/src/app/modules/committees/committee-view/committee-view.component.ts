// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, linkedSignal, makeStateKey, PLATFORM_ID, signal, Signal, TransferState } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  Committee,
  CommitteeInvite,
  CommitteeMember,
  CommitteeMemberVisibility,
  CommitteePermissionLevel,
  CommitteeTab,
  CommitteeUser,
  getCommitteeCategorySeverity,
  TagSeverity,
} from '@lfx-one/shared';
import {
  AcceptInviteOrganizationDialogData,
  AcceptInviteOrganizationDialogResult,
  CommitteeEngagementResponse,
  CommitteeEngagementWindow,
  CommitteeJoinApplication,
  CommitteeOrganizationReference,
  GroupsIOMailingList,
  Meeting,
  PendingInvitation,
  ProjectContext,
  TabConfigEntry,
} from '@lfx-one/shared/interfaces';
import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW, COMMITTEE_VALID_TABS, WG_ENGAGEMENT_METRICS_FLAG } from '@lfx-one/shared/constants';
import {
  canManageCommitteeMembers,
  committeeRequiresOrganization,
  findPendingInvitationForCommittee,
  invitationRequiresOrganization,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { CommitteeJoinApplicationSessionService } from '@services/committee-join-application-session.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { CategoryAvatarColorPipe } from '@pipes/category-avatar-color.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { InvitationSubtextPipe } from '@pipes/invitation-subtext.pipe';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { DescriptionDialogComponent } from '../components/description-dialog/description-dialog.component';
import { MessageService } from 'primeng/api';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  filter,
  finalize,
  firstValueFrom,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  take,
  tap,
  timer,
} from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { syncEntityProjectContext } from '@shared/utils/entity-project-context.util';
import { JoinApplicationDialogResult } from '@lfx-one/shared/interfaces';
import { AcceptInviteOrganizationDialogComponent } from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import { JoinApplicationDialogComponent } from '../components/join-application-dialog/join-application-dialog.component';

import { CommitteeAboutComponent } from '../components/committee-about/committee-about.component';
import { CommitteeChannelsCardComponent } from '../components/committee-channels-card/committee-channels-card.component';
import { CommitteeDocumentsComponent } from '../components/committee-documents/committee-documents.component';
import { CommitteeMeetingsComponent } from '../components/committee-meetings/committee-meetings.component';
import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';
import { CommitteeOverviewComponent } from '../components/committee-overview/committee-overview.component';
import { CommitteeSettingsTabComponent } from '../components/committee-settings-tab/committee-settings-tab.component';
import { CommitteeSurveysComponent } from '../components/committee-surveys/committee-surveys.component';
import { CommitteeVotesComponent } from '../components/committee-votes/committee-votes.component';

/** Window before a declined invite is actually sent upstream, during which the user can undo. */
const INVITE_DECLINE_UNDO_MS = 5000;

/** Dedicated toast key so the inline undo template renders only for this component's decline toast. */
const INVITE_TOAST_KEY = 'committee-view-invite';

/**
 * Bounded retry window for an authorization denial on the *initial* committee read, sized to
 * absorb the FGA propagation lag after an invite accept. Same 400 ms cadence as
 * `refreshCommitteeAfterMembershipChange`, fewer attempts because nothing is on screen yet and a
 * genuine denial is waiting behind it. Counts retries after the immediate first read, so the
 * worst-case added delay is ATTEMPTS * INTERVAL — keep that product at or under 1.5 s.
 */
const ACCESS_RETRY_ATTEMPTS = 3;
const ACCESS_RETRY_INTERVAL_MS = 400;

@Component({
  selector: 'lfx-committee-view',
  imports: [
    ButtonComponent,
    CardComponent,
    TagComponent,
    RouteLoadingComponent,
    DatePipe,
    NgClass,
    PopoverModule,
    SkeletonModule,
    ToastModule,
    CategoryAvatarColorPipe,
    InitialsPipe,
    InvitationSubtextPipe,
    JoinModeLabelPipe,
    CommitteeAboutComponent,
    CommitteeChannelsCardComponent,
    CommitteeDocumentsComponent,
    CommitteeMeetingsComponent,
    CommitteeMembersComponent,
    CommitteeOverviewComponent,
    CommitteeSettingsTabComponent,
    CommitteeSurveysComponent,
    CommitteeVotesComponent,
  ],
  providers: [DialogService],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
})
export class CommitteeViewComponent {
  // -- Injections --
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly committeeService = inject(CommitteeService);
  private readonly mailingListService = inject(MailingListService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly invitationService = inject(InvitationService);
  private readonly joinApplicationSession = inject(CommitteeJoinApplicationSessionService);
  private readonly invitationAcceptFlow = inject(InvitationAcceptFlowService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);

  private readonly navBackLabel: string | null = this.router.getCurrentNavigation()?.extras?.state?.['backLabel'] ?? null;

  // Set when a server-side read is denied and the terminal decision is left to the client. Only
  // one read is ever in flight (switchMap), so a plain field is enough.
  private deferredToClient = false;

  // Carries the server's 403 across the hydration boundary: the browser boots a *new* component
  // instance, so a plain field (like `deferredToClient` above) doesn't survive to tell the
  // client's first read that the server was denied. Without this, a client-side 200 that still
  // lacks `my_role` looks identical to an ordinary visitor's read and never starts the membership
  // catch-up poll (Copilot).
  private readonly ssrDeniedCommitteeKey = makeStateKey<string>('committee-view-ssr-denied-committee-uid');

  public meetingsTimeFilter = signal<'upcoming' | 'past'>('upcoming');

  private readonly committeeId: Signal<string | null> = this.initCommitteeId();
  // Reactive so it updates when navigating to another committee with a different ?tab=.
  private readonly initialTab: Signal<CommitteeTab | null> = this.initInitialTab();

  // -- Writable signals --
  public loading = signal<boolean>(true);
  // Tracks any in-flight committee fetch (initial OR silent refresh). Distinct from
  // `loading`, which only gates the full-page spinner on the initial fetch.
  public committeeRefreshing = signal<boolean>(false);
  public error = signal<boolean>(false);
  public errorType = signal<'not-found' | 'access-denied' | 'server-error' | null>(null);
  // True while an initial-load denial is being retried. The denial is provisional until the
  // window is exhausted, so the view shows "finalizing access" rather than the error state.
  public accessFinalizing = signal<boolean>(false);
  public refresh = signal(0);
  public membersRefresh = signal(0);
  public membersLoading = signal<boolean>(true);
  public invitesLoading = signal<boolean>(true);
  public applicationsLoading = signal<boolean>(true);
  public joiningOrLeaving = signal(false);
  // Blocks the join/apply CTA during the async org-prefetch window so a second tap
  // doesn't fire a parallel resolveCurrentEmployer() + dialog pair.
  private readonly resolvingOrg = signal(false);
  // Engagement rollup (LFXV2-1705): shared window state so the Members table and the Overview
  // summary stay in sync across tab switches (tab panels unmount in the @switch below).
  // linkedSignal, not signal: resets to the default window whenever committeeId() changes, the same
  // way the adjacent activeTab linkedSignal resets per-committee state — otherwise Angular's reuse
  // of this component instance across /groups/:id navigations would carry the previous committee's
  // window selection (e.g. 'ytd') into a different committee's first render.
  public engagementWindow = linkedSignal<{ id: string | null }, CommitteeEngagementWindow>({
    source: () => ({ id: this.committeeId() }),
    computation: (source, previous) => {
      if (previous && previous.source.id === source.id) {
        return previous.value;
      }
      return COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW;
    },
  });
  // Starts true, not false: toObservable's effect that drives initEngagement's pipeline runs
  // asynchronously, so a false initial value would let the first render (and any render during a
  // committee-navigation gap) fall through the loading check and either show the "unavailable"
  // state or a stale previous committee's engagement() before the pipeline's first tick sets this.
  // Matches every sibling loader in this file/committee-overview.component.ts (membersLoading,
  // documentsLoading, etc.), all of which start true for the same reason (Cursor Bugbot, LFXV2-1705).
  public engagementLoading = signal<boolean>(true);

  // -- Computed / toSignal --
  public committee: Signal<Committee | null> = this.initializeCommittee();
  public members: Signal<CommitteeMember[]> = this.initializeMembers();
  // Pending invites share the members refresh trigger so adding/revoking refreshes both.
  public invites: Signal<CommitteeInvite[]> = this.initializeInvites();
  public applications: Signal<CommitteeJoinApplication[]> = this.initializeApplications();
  // Feature flag: engagement metrics UI (LFXV2-1705). Defaults false, so SSR and an unreachable
  // LaunchDarkly both fail closed — flag off means zero engagement UI and zero engagement fetches.
  public readonly engagementMetricsEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(WG_ENGAGEMENT_METRICS_FLAG, false);
  public engagement: Signal<CommitteeEngagementResponse | null> = this.initEngagement();

  // Membership identity comes from server-enriched fields on the committee record,
  // resolved via the username-tagged membership query so visibility doesn't depend
  // on the caller's authenticated email matching their member row.
  public myRole: Signal<string | null> = computed(() => this.committee()?.my_role ?? null);
  public myMemberUid: Signal<string | null> = computed(() => this.committee()?.my_member_uid ?? null);
  // Track the committee request itself (initial + silent refresh) so the join/leave CTA
  // doesn't flash the wrong state in the window between a join action and the refreshed
  // committee response carrying the new my_role.
  public myRoleLoading: Signal<boolean> = computed(() => this.loading() || this.committeeRefreshing());
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.myRoleLoading());
  /** True when the visitor submitted an application for the current committee this session. */
  public hasPendingApplication: Signal<boolean> = computed(() => {
    const uid = this.committee()?.uid;
    return !!uid && this.joinApplicationSession.pendingCommitteeUids().has(uid);
  });

  // Pending invitation for THIS committee, surfaced from the shared cross-surface cache so a user
  // landing on a group they were invited to can accept/decline right here. Excludes invites already
  // resolved this session, and is suppressed once the user is a member (my_role populated).
  public readonly inviteToastKey = INVITE_TOAST_KEY;
  public pendingInvitation: Signal<PendingInvitation | null> = computed(() => {
    const committee = this.committee();
    if (!committee?.uid || !this.isVisitor() || committee.join_mode !== 'invite_only') {
      return null;
    }
    return findPendingInvitationForCommittee(this.invitationService.pendingInvitations(), this.invitationService.resolvedInviteUids(), committee.uid);
  });

  // When the committee 403s and committee() is null, pendingInvitation() returns null because it
  // requires committee.uid. This signal resolves the same invite using the route :id directly so
  // the error state can surface the accept flow without a loaded committee record.
  public pendingInvitationFromRoute: Signal<PendingInvitation | null> = this.initPendingInvitationFromRoute();

  // Deferred-decline timers keyed by invite UID (committee UID stored alongside since the invite is
  // out of the cache by the time the timer/destroy flush fires). Mirrors the dashboard/My Groups UX.
  private readonly pendingDeclines = new Map<string, { committeeUid: string; timerId: ReturnType<typeof setTimeout> }>();

  public categorySeverity: Signal<TagSeverity> = computed(() => {
    const category = this.committee()?.category;
    return getCommitteeCategorySeverity(category || '');
  });

  public backLabel: Signal<string> = computed(() => this.navBackLabel ?? (this.lensService.activeLens() === 'me' ? 'My Groups' : 'Groups'));

  public canEdit: Signal<boolean> = computed(() => !!this.committee()?.writer);

  /** Non-writer members may send invites in invite_only groups (LFXV2-2690). */
  public canSendMemberInvites: Signal<boolean> = computed(() => {
    const committee = this.committee();
    if (!committee || this.canEdit() || this.isVisitor() || this.myRoleLoading()) return false;
    return committee.join_mode === 'invite_only';
  });

  public canReview: Signal<boolean> = computed(() => {
    if (this.canEdit()) return false;
    return this.isCallerInAuditorList(this.committee()?.auditors);
  });

  // Combined settle-state for the meeting_coordinator project fetch below, tagged with the resolved
  // committee().uid it belongs to. A single object signal, not separate primitive booleans: Angular
  // signals skip notifying dependents on a `.set()` that doesn't change a primitive's value, which a
  // prior version (two raw booleans wrapped by committeeId-keyed linkedSignals that forced `true`/
  // `false` once per navigation, waiting for the raw pipeline to "release" them) got bitten by --
  // navigating between two committees where the caller is already eligible via roster/writer both
  // times resolves the SAME `false` the previous committee already held, the no-op `.set()` never
  // notified the wrapper, and meetingCoordinatorLoading stayed forced `true` forever for the new
  // committee (Copilot). A fresh object literal is always reference-distinct, so every emission below
  // reliably propagates, and meetingCoordinatorLoading/meetingCoordinator (further down) compare the
  // tag against the LIVE committeeId() directly rather than needing a value-change to "release" them.
  private readonly meetingCoordinatorState: Signal<{ committeeUid: string | null; loading: boolean; coordinator: boolean }> = this.initMeetingCoordinator();
  // True until meetingCoordinatorState has settled FOR THE CURRENT committee (the tag comparison
  // covers both "still mid-navigation, state belongs to the previous committee" and "fetch actually
  // in flight" — see the state signal's doc comment above).
  public readonly meetingCoordinatorLoading: Signal<boolean> = computed(() => {
    const state = this.meetingCoordinatorState();
    return state.committeeUid !== this.committeeId() || state.loading;
  });
  // Only trusts the resolved grant once meetingCoordinatorState belongs to the CURRENT committee —
  // never leaks a stale previous committee's resolved value into eligible() below.
  public readonly meetingCoordinator: Signal<boolean> = computed(() => {
    const state = this.meetingCoordinatorState();
    return state.committeeUid === this.committeeId() && state.coordinator;
  });

  // Single source of truth for "can this user read committee engagement data" (LFXV2-1705), shared
  // by initEngagement's fetch gate below AND passed down to committee-overview for its card render
  // gate — a duplicated reconstruction in the child previously omitted canReview (Copilot: a
  // committee-scoped explicit auditor — on `committee.auditors[]`, neither a roster member nor a
  // writer — is precisely what the endpoint's committee#auditor grant means, yet was still blocked).
  // Also checks `inherited_auditors` (project/foundation-ancestry review grants — GET /committees/:id
  // always requests `includeInheritedPermissions`, so this is already on `committee()` today) so a
  // project-level auditor who isn't a committee-scoped auditor is included too (Copilot). Kept as a
  // separate check here rather than folded into `canReview()` itself: `canReview()` also drives
  // Settings-tab visibility and the 'review' permission level elsewhere, and broadening those to
  // inherited auditors is a larger, out-of-scope decision for this engagement slice. Also checks
  // meetingCoordinator() (project-level `meeting_coordinator`, the fourth leg of the endpoint's
  // `committee#auditor` FGA relation alongside member/writer/auditor-from-project — server/helpers/
  // committee-read-access.helper.ts:14-25) so a meeting coordinator who isn't a roster member,
  // writer, or listed/inherited auditor is still included (dealako, Copilot).
  //
  // Only updates on a *settled* (non-loading) resolution — never derived directly from
  // myRoleLoading() — so it neither reads optimistic-true during ANY loading window (which would
  // flash the Overview card open for a genuine visitor before resolving closed, Cursor Bugbot) nor
  // flips pessimistic-false during a later silent refreshCommittee() for an already-eligible user
  // (edit chairs, join/leave, member mutations all set committeeRefreshing() — briefly re-entering
  // myRoleLoading() — which would otherwise unmount+remount the card each time even though
  // initEngagement holds its data via EMPTY through that same window, Cursor Bugbot). Defaults to
  // false pre-first-resolution, then holds the last settled answer until the next settled one.
  public readonly canAccessEngagement: Signal<boolean> = this.initCanAccessEngagement();

  public myPermission: Signal<CommitteePermissionLevel> = computed(() => {
    if (this.canEdit()) return 'manage';
    if (this.canReview()) return 'review';
    return 'member';
  });

  public hasChannels: Signal<boolean> = computed(() => {
    const c = this.committee();
    return this.associatedMailingLists().length > 0 || !!(c?.chat_channel || c?.website) || this.canEdit();
  });

  // -- Associated mailing lists (rich objects filtered by ml.committees[]) --
  public associatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingLists();

  // -- Sub-groups --
  public subGroupsLoading = signal(true);
  public subGroups: Signal<Committee[]> = this.initSubGroups();

  // -- Parent group --
  public parentGroup: Signal<Committee | null> = this.initParentGroup();

  // -- Upcoming meetings (About tab's cadence card and Overview's next-meeting display both
  // consume this; fetched once here and passed down to both to avoid a duplicate round-trip). --
  public meetingsLoading = signal(true);
  public upcomingMeetings: Signal<Meeting[]> = this.initUpcomingMeetings();

  // -- Tab visibility signals --
  public isMembersTabVisible: Signal<boolean> = computed(
    () => this.committee()?.member_visibility === CommitteeMemberVisibility.BASIC_PROFILE || this.canEdit() || this.canSendMemberInvites()
  );
  public isVotesTabVisible: Signal<boolean> = computed(() => !!this.committee()?.enable_voting);

  // -- Visitor gating --
  public isMemberOrAdmin: Signal<boolean> = computed(() => !this.isVisitor() || this.canEdit());

  public readonly tabConfig: TabConfigEntry[] = [
    { key: 'overview', label: 'Overview', icon: 'fa-gauge', visible: () => true },
    { key: 'about', label: 'About', icon: 'fa-circle-info', visible: () => true },
    {
      key: 'members',
      label: () => {
        const count = this.committee()?.total_members;
        return count != null ? `Members (${count})` : 'Members';
      },
      icon: 'fa-users',
      visible: () => this.isMemberOrAdmin() && this.isMembersTabVisible(),
    },
    { key: 'votes', label: 'Votes', icon: 'fa-check-to-slot', visible: () => this.isMemberOrAdmin() && this.isVotesTabVisible() },
    { key: 'meetings', label: 'Meetings', icon: 'fa-calendar', visible: () => this.isMemberOrAdmin() },
    { key: 'surveys', label: 'Surveys', icon: 'fa-chart-simple', visible: () => this.isMemberOrAdmin() },
    { key: 'documents', label: 'Documents', icon: 'fa-folder-open', visible: () => this.isMemberOrAdmin() },
    { key: 'settings', label: 'Settings', icon: 'fa-gear', visible: () => this.canEdit() || this.canReview() },
  ];

  public visibleTabs = computed(() =>
    this.tabConfig.filter((tab) => tab.visible()).map((tab) => ({ ...tab, label: typeof tab.label === 'function' ? tab.label() : tab.label }))
  );

  // -- Tab state --
  public activeTab = linkedSignal<{ id: string | null; visible: TabConfigEntry[] }, CommitteeTab>({
    source: () => ({ id: this.committeeId(), visible: this.visibleTabs() }),
    computation: ({ id, visible }, previous) => {
      if (previous && previous.source.id === id && visible.some((t) => t.key === previous.value)) {
        return previous.value;
      }
      return 'overview';
    },
  });

  public constructor() {
    this.initAutoSelectInitialTab();

    // Populate the shared invitation cache once in the browser so a direct landing on an invited
    // group (e.g. via the email link) can surface the Accept/Decline banner. Browser-only: the
    // banner is an interactive surface and the list is per-user.
    if (isPlatformBrowser(this.platformId)) {
      this.invitationService.loadPendingInvitations().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe();
    }

    syncEntityProjectContext(this.committee, this.projectContextService, this.router, this.destroyRef);

    toObservable(this.committee)
      .pipe(
        filter((committee): committee is Committee => !!committee?.uid && !!committee.my_role),
        map((committee) => committee.uid),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((committeeUid) => {
        this.joinApplicationSession.clearPending(committeeUid);
      });

    // Flush any deferred decline on destroy so navigating away still commits it.
    this.destroyRef.onDestroy(() => {
      for (const inviteUid of [...this.pendingDeclines.keys()]) {
        this.flushDecline(inviteUid);
      }
    });
  }

  // -- Public methods --
  public goBack(): void {
    this.router.navigate(['/', 'groups']);
  }

  public refreshCommittee(): void {
    // Set synchronously here, not only inside initializeCommittee's async switchMap below (which
    // still sets it too, on the actual refetch) -- closes a race where refreshMembers() bumps
    // membersRefresh() (read by initEngagement's engagementKey) in the same synchronous call, but
    // that pipeline and this one are two independently-scheduled toObservable-driven effects with no
    // ordering guarantee between them. Without this, engagementKey could re-evaluate and fire a real
    // engagement fetch before myRoleLoading() picked up committeeRefreshing()=true, wasting a request
    // that then gets cancelled via EMPTY once roleLoading does catch up -- without engagementLoading
    // ever clearing, leaving skeletons over still-valid data for the whole refresh window (Cursor
    // Bugbot).
    this.committeeRefreshing.set(true);
    this.refresh.update((v) => v + 1);
  }

  public refreshMembers(): void {
    this.membersLoading.set(true);
    this.membersRefresh.update((v) => v + 1);
    // The caller's role lives on the committee payload (not the members list), so any
    // member-mutation that triggers a members refresh must also refetch the committee
    // — otherwise role-gated UI (CTAs, banners, tabs) keeps a stale `my_role` until the
    // user navigates away and back. Cheap: the committee GET is a single round-trip.
    this.refreshCommittee();
  }

  public onMembersRefreshed(): void {
    this.refreshMembers();
  }

  public onEngagementWindowChange(window: CommitteeEngagementWindow): void {
    this.engagementWindow.set(window);
  }

  public handleTabNavigation(tabWithContext: string): void {
    const [tab, context] = tabWithContext.split(':');
    if (!COMMITTEE_VALID_TABS.includes(tab as CommitteeTab)) {
      return;
    }
    this.activeTab.set(tab as CommitteeTab);
    if (tab === 'meetings' && (context === 'past' || context === 'upcoming')) {
      this.meetingsTimeFilter.set(context);
    }
  }

  public openEditDescription(): void {
    const ref = this.dialogService.open(DescriptionDialogComponent, {
      header: 'Edit Description',
      width: '560px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mode: 'edit', description: this.committee()?.description || '' },
    });
    ref?.onClose.pipe(take(1)).subscribe((newDescription: string | undefined) => {
      if (newDescription !== undefined) {
        this.saveDescription(newDescription);
      }
    });
  }

  public saveDescription(description: string): void {
    const committee = this.committee();
    if (!committee) {
      return;
    }
    this.committeeService.updateCommittee(committee.uid, { description }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Description updated' });
        this.refreshCommittee();
      },
      error: (err: HttpErrorResponse) => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: getHttpErrorDetail(err, 'Failed to update description. Please try again.') });
      },
    });
  }

  public async handleJoinRequest(): Promise<void> {
    const committee = this.committee();
    if (!committee || this.joiningOrLeaving() || this.resolvingOrg()) {
      return;
    }

    const joinMode = committee.join_mode;
    const requiresOrg = committeeRequiresOrganization(committee);

    if (joinMode === 'open') {
      let organization: CommitteeOrganizationReference | undefined;
      if (requiresOrg) {
        this.resolvingOrg.set(true);
        const result = await this.openOrganizationDialog(committee.name).finally(() => this.resolvingOrg.set(false));
        if (!result?.organization) {
          return;
        }
        organization = result.organization;
      }
      this.joiningOrLeaving.set(true);
      this.committeeService
        .joinCommittee(committee.uid, organization)
        .pipe(finalize(() => this.joiningOrLeaving.set(false)))
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Joined', detail: `You have joined "${committee.name}"` });
            this.refreshCommitteeAfterMembershipChange();
          },
          error: (err: HttpErrorResponse) => {
            const detail = this.getJoinErrorMessage(err, committee.name);
            this.messageService.add({ severity: 'error', summary: 'Unable to Join', detail, life: 6000 });
          },
        });
    } else if (joinMode === 'application') {
      if (this.hasPendingApplication()) {
        return;
      }
      let organization: CommitteeOrganizationReference | undefined;
      if (requiresOrg) {
        this.resolvingOrg.set(true);
        const result = await this.openOrganizationDialog(committee.name).finally(() => this.resolvingOrg.set(false));
        if (!result?.organization) {
          return;
        }
        organization = result.organization;
      }
      this.openApplicationDialog(committee.uid, committee.name, organization);
    } else {
      // closed — no self-service action available
      this.messageService.add({ severity: 'info', summary: 'Contact Admin', detail: 'Contact a group admin to request membership.' });
    }
  }

  public handleLeaveRequest(): void {
    const committee = this.committee();
    if (!committee || this.joiningOrLeaving()) {
      return;
    }
    this.joiningOrLeaving.set(true);
    this.committeeService
      .leaveCommittee(committee.uid)
      .pipe(finalize(() => this.joiningOrLeaving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Left', detail: `You have left "${committee.name}"` });
          this.refreshCommittee();
          this.membersRefresh.update((v) => v + 1);
        },
        error: (err: HttpErrorResponse) => {
          const detail =
            err.status === 404 ? 'You are not a member of this group.' : (err.error?.message ?? `Failed to leave "${committee.name}". Please try again.`);
          this.messageService.add({ severity: 'error', summary: 'Unable to Leave', detail, life: 6000 });
        },
      });
  }

  public onAcceptInvite(invite: PendingInvitation): void {
    const committeeName = this.committee()?.name ?? invite.committee_name ?? 'this group';
    const requiresOrganization = invitationRequiresOrganization(invite);

    if (!requiresOrganization) {
      this.invitationService.markResolved(invite.uid);
    }

    this.invitationAcceptFlow
      .accept({
        committeeUid: invite.committee_uid,
        inviteUid: invite.uid,
        committeeName,
        organization: invite.organization,
        enable_voting: invite.enable_voting,
        business_email_required: invite.business_email_required,
        inviteRequiresOrganization: requiresOrganization,
      })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (requiresOrganization) {
            this.invitationService.markResolved(invite.uid);
          }
          this.invitationService.forgetResolved(invite.uid);
          this.messageService.add({ severity: 'success', summary: 'Joined', detail: `You've joined "${committeeName}"` });
          this.refreshCommitteeAfterMembershipChange();
        },
        error: () => {
          if (!requiresOrganization) {
            this.invitationService.unmarkResolved(invite.uid);
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Accept',
            detail: `Couldn't accept the invitation to "${committeeName}". Please try again.`,
            life: 6000,
          });
        },
      });
  }

  public onDeclineInvite(invite: PendingInvitation): void {
    // Optimistic + deferred-undo: hide the banner now, only send the decline after the undo window.
    this.invitationService.markResolved(invite.uid);

    const timerId = setTimeout(() => {
      this.pendingDeclines.delete(invite.uid);
      this.sendDecline(invite.committee_uid, invite.uid);
    }, INVITE_DECLINE_UNDO_MS);
    this.pendingDeclines.set(invite.uid, { committeeUid: invite.committee_uid, timerId });

    this.messageService.add({
      key: INVITE_TOAST_KEY,
      severity: 'info',
      summary: 'Invitation declined',
      data: { uid: invite.uid },
      life: INVITE_DECLINE_UNDO_MS,
      closable: true,
    });
  }

  public onUndoDecline(inviteUid: string): void {
    const pending = this.pendingDeclines.get(inviteUid);
    // Timer already fired -> the decline is committed upstream; restoring would lie to the user.
    if (!pending) {
      this.messageService.clear(INVITE_TOAST_KEY);
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(inviteUid);
    this.invitationService.unmarkResolved(inviteUid);
    this.messageService.clear(INVITE_TOAST_KEY);
  }

  public navigateToParentGroup(): void {
    const parent = this.parentGroup();
    if (parent?.uid) {
      this.router.navigate(['/', 'groups', parent.uid]);
    }
  }

  public navigateToParentProject(): void {
    const c = this.committee();
    if (!c?.project_uid || !c.project_slug) return;
    const context: ProjectContext = {
      uid: c.project_uid,
      name: c.project_name || c.foundation_name || c.project_slug,
      slug: c.project_slug,
    };
    if (c.is_foundation) {
      this.projectContextService.setFoundation(context);
      this.lensService.setLens('foundation');
      this.router.navigate(['/foundation/overview']);
    } else {
      this.projectContextService.setProject(context);
      this.lensService.setLens('project');
      this.router.navigate(['/project/overview']);
    }
  }

  public navigateToSubGroup(subGroup: Committee): void {
    this.router.navigate(['/', 'groups', subGroup.uid]);
  }

  // -- Private methods --

  /**
   * Refreshes committee + members after join/accept. The membership query index can lag
   * the upstream write, so poll until `my_role` surfaces before giving up.
   */
  private refreshCommitteeAfterMembershipChange(): void {
    const committeeId = this.committee()?.uid ?? this.committeeId();
    this.refreshMembers();

    if (!committeeId) {
      return;
    }

    let pollSucceeded = false;

    timer(400, 400)
      .pipe(
        take(6),
        exhaustMap(() => this.committeeService.getCommittee(committeeId).pipe(catchError(() => of(null)))),
        filter((committee) => !!committee?.my_role),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          pollSucceeded = true;
          this.refreshMembers();
        },
        error: () => {
          if (!pollSucceeded && !this.committee()?.my_role) {
            this.refreshMembers();
          }
        },
        complete: () => {
          if (!pollSucceeded && !this.committee()?.my_role) {
            this.refreshMembers();
          }
        },
      });
  }

  /** Cancels the deferred timer and fires the upstream decline immediately (destroy flush). */
  private flushDecline(inviteUid: string): void {
    const pending = this.pendingDeclines.get(inviteUid);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timerId);
    this.pendingDeclines.delete(inviteUid);
    this.sendDecline(pending.committeeUid, inviteUid);
  }

  private sendDecline(committeeUid: string, inviteUid: string): void {
    this.invitationService
      .declineInvitation(committeeUid, inviteUid)
      .pipe(take(1))
      .subscribe({
        next: () => this.invitationService.forgetResolved(inviteUid),
        error: () => {
          this.invitationService.unmarkResolved(inviteUid);
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to Decline',
            detail: `Couldn't decline the invitation. Please try again.`,
            life: 6000,
          });
        },
      });
  }

  private openApplicationDialog(committeeUid: string, committeeName: string, organization?: CommitteeOrganizationReference): void {
    if (this.joiningOrLeaving()) {
      return;
    }

    this.joiningOrLeaving.set(true);

    const ref = this.dialogService.open(JoinApplicationDialogComponent, {
      header: 'Request to Join',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { committeeName },
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1)).subscribe((result: JoinApplicationDialogResult | null) => {
      if (!result) {
        this.joiningOrLeaving.set(false);
        return;
      }

      this.committeeService
        .submitApplication(committeeUid, result.message, organization)
        .pipe(finalize(() => this.joiningOrLeaving.set(false)))
        .subscribe({
          next: () => {
            this.joinApplicationSession.markPending(committeeUid);
            this.messageService.add({
              severity: 'success',
              summary: 'Application Submitted',
              detail: `Your request to join "${committeeName}" has been submitted. An admin will review it shortly.`,
              life: 8000,
            });
          },
          error: (err: HttpErrorResponse) => {
            const upstream = err.error?.message as string | undefined;
            let detail: string;
            if (err.status === 409) {
              this.joinApplicationSession.markPending(committeeUid);
              detail = 'You already have a pending application for this group.';
            } else {
              detail = upstream ?? `Failed to submit your request for "${committeeName}". Please try again.`;
            }
            this.messageService.add({ severity: 'error', summary: 'Unable to Submit', detail, life: 6000 });
          },
        });
    });
  }

  private async openOrganizationDialog(committeeName: string): Promise<AcceptInviteOrganizationDialogResult | null> {
    // Pre-fill from the user's profile work experiences — same pre-resolution the invite
    // accept flow uses so the user doesn't have to re-enter an org they've already set.
    // takeUntilDestroyed cancels the observable if the component is destroyed while the
    // profile/domain lookup (≤2 s) is still in flight, preventing dangling subscriptions.
    // We track destruction explicitly because firstValueFrom's defaultValue: null causes
    // the await to resolve successfully even when takeUntilDestroyed completed early due
    // to component teardown — without this guard the dialog would open over a new route.
    let destroyed = false;
    const cleanupDestroyListener = this.destroyRef.onDestroy(() => {
      destroyed = true;
    });

    const prefillOrg = await firstValueFrom(this.invitationAcceptFlow.resolveCurrentEmployer().pipe(takeUntilDestroyed(this.destroyRef)), {
      defaultValue: null,
    });

    cleanupDestroyListener();
    if (destroyed) {
      return null;
    }

    const ref = this.dialogService.open(AcceptInviteOrganizationDialogComponent, {
      header: 'Confirm Organization',
      width: '32rem',
      modal: true,
      closable: true,
      data: { committeeName, organization: prefillOrg } satisfies AcceptInviteOrganizationDialogData,
    });
    if (!ref) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      ref.onClose.pipe(take(1)).subscribe((result: AcceptInviteOrganizationDialogResult | null) => resolve(result ?? null));
    });
  }

  // -- Private initializer functions --
  private initPendingInvitationFromRoute(): Signal<PendingInvitation | null> {
    return computed(() => {
      if (this.errorType() !== 'access-denied') {
        return null;
      }
      return findPendingInvitationForCommittee(this.invitationService.pendingInvitations(), this.invitationService.resolvedInviteUids(), this.committeeId());
    });
  }

  private initCommitteeId(): Signal<string | null> {
    return toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { requireSync: true });
  }

  private initInitialTab(): Signal<CommitteeTab | null> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => {
          const tab = params.get('tab');
          return tab && COMMITTEE_VALID_TABS.includes(tab as CommitteeTab) ? (tab as CommitteeTab) : null;
        })
      ),
      { requireSync: true }
    );
  }

  private initAutoSelectInitialTab(): void {
    const navigationKey = computed(() => ({ id: this.committeeId(), tab: this.initialTab() }));
    // toObservable must run in an injection context; build the streams here, not inside switchMap.
    const visibleTabs$ = toObservable(this.visibleTabs);
    const membersLoading$ = toObservable(this.membersLoading);
    toObservable(navigationKey)
      .pipe(
        switchMap(({ tab }) => {
          if (!tab) return EMPTY;
          return combineLatest([visibleTabs$, membersLoading$]).pipe(
            filter(([, loading]) => !loading),
            take(1),
            filter(([tabs]) => tabs.some((t) => t.key === tab)),
            map(() => tab)
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((tab) => {
        if (this.activeTab() === 'overview') {
          this.activeTab.set(tab);
        }
      });
  }

  private initializeCommittee(): Signal<Committee | null> {
    return toSignal(
      combineLatest([this.route.paramMap, toObservable(this.refresh)]).pipe(
        switchMap(([params]) => {
          const committeeId = params?.get('id');
          if (!committeeId) {
            this.errorType.set('not-found');
            this.error.set(true);
            this.loading.set(false);
            return of(null);
          }

          this.error.set(false);
          this.errorType.set(null);

          // Only show full loading spinner on initial load, not on silent refreshes.
          // `committeeRefreshing` flips for both, so role-based UI (CTAs, banners) stays
          // accurate during silent refreshes after join/leave actions.
          if (!this.committee()) {
            this.loading.set(true);
          }
          this.committeeRefreshing.set(true);
          this.accessFinalizing.set(false);
          this.deferredToClient = false;

          // `this.committee()` holds the *previous* committee until this switchMap's read emits, so
          // navigating between groups (e.g. a parent/subgroup link) would otherwise misread a still-
          // loading different group as a silent refresh and skip the retry window (Cursor Bugbot).
          const isInitialLoad = this.committee()?.uid !== committeeId;

          return this.readCommitteeToleratingPropagation(committeeId, isInitialLoad).pipe(
            finalize(() => {
              // On the server a denial leaves the spinner up: the terminal call belongs to the
              // client, which re-fetches after hydration.
              if (!this.deferredToClient) {
                this.loading.set(false);
              }
              this.committeeRefreshing.set(false);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  /**
   * Reads the committee, treating an authorization denial as provisional rather than terminal —
   * but only on the initial load (`isInitialLoad`). A silent refresh (e.g. after `handleLeaveRequest`
   * calls `refreshCommittee()`) reaches this same pipeline with a committee already on screen; a 403
   * there is far more likely a real, deliberate access change than propagation lag, and retrying it
   * would flash "Finalizing your access" — copy aimed at users who just joined — over an intentional
   * leave (Cursor Bugbot).
   *
   * Accepting an invite writes the membership before the `committee:{uid}#member` FGA tuple is
   * applied, so a cold arrival can be denied for a few hundred milliseconds. Retrying briefly
   * absorbs that window; the denial only becomes terminal once the window is exhausted.
   *
   * Resolves on any non-403. It deliberately does not wait for `my_role` the way the sibling poll
   * does — the committee read is available to non-members, and an auditor or viewer legitimately
   * has no role, so requiring one would strand them in the retry.
   *
   * Two properties this relies on, both load-bearing:
   * - It runs inside the `refresh`-driven pipeline, so Try Again re-engages a full window rather
   *   than a single read, and `switchMap` cancels any window still in flight. That re-engagement
   *   is what carries the guarantee past this bounded window.
   * - Authenticated responses are not transfer-cached (`authentication.interceptor.ts:37-45` sets
   *   `withCredentials` and a `Cookie` header, and `app.config.ts` does not set
   *   `includeRequestsWithAuthHeaders`), so the client always re-fetches after hydration and gets
   *   its own window. Enabling that option would suppress the re-fetch and silently weaken this.
   *
   * A 403 with a known pending invite for this group is an *expected* denial, not propagation lag —
   * it resolves immediately (skipping the window) so `pendingInvitationFromRoute` can render
   * Accept/Decline right away instead of behind a misleading "Finalizing" flash (Cursor Bugbot).
   */
  private readCommitteeToleratingPropagation(committeeId: string, isInitialLoad: boolean): Observable<Committee | null> {
    const attemptRead = (retriesLeft: number, deniedBefore: boolean): Observable<Committee | null> =>
      this.committeeService.getCommittee(committeeId).pipe(
        tap((committee) => {
          this.accessFinalizing.set(false);
          // Authorization cleared but the membership index hasn't caught up. Hand that second,
          // separate wait to the mechanism already built for it instead of widening this retry.
          if (deniedBefore && committee && !committee.my_role) {
            this.refreshCommitteeAfterMembershipChange();
          }
        }),
        catchError((err: HttpErrorResponse) => {
          const status = err?.status;

          // Only an authorization denial on the initial load is provisional; everything else
          // (including a 403 on a silent refresh) keeps its existing immediate, terminal handling.
          if (status !== 403 || !isInitialLoad) {
            this.applyCommitteeLoadError(status);
            return of(null);
          }

          const hasPendingInvite = !!findPendingInvitationForCommittee(
            this.invitationService.pendingInvitations(),
            this.invitationService.resolvedInviteUids(),
            committeeId
          );
          if (hasPendingInvite) {
            this.applyCommitteeLoadError(status);
            return of(null);
          }

          if (!isPlatformBrowser(this.platformId)) {
            this.deferredToClient = true;
            this.transferState.set(this.ssrDeniedCommitteeKey, committeeId);
            return of(null);
          }

          if (retriesLeft > 0) {
            if (!this.accessFinalizing()) {
              this.accessFinalizing.set(true);
              console.info('[committee-view] access retry window engaged', { committee_uid: committeeId });
            }
            return timer(ACCESS_RETRY_INTERVAL_MS).pipe(switchMap(() => attemptRead(retriesLeft - 1, true)));
          }

          console.warn('[committee-view] access retry window exhausted', { committee_uid: committeeId });
          this.applyCommitteeLoadError(status);
          return of(null);
        })
      );

    // If the server was denied, seed the client's first attempt as "already denied once" so a 200
    // that still lacks `my_role` starts the membership catch-up poll instead of looking like an
    // ordinary visitor's read.
    const deniedByServer = isInitialLoad && this.consumeSsrDeniedFlag(committeeId);
    return attemptRead(ACCESS_RETRY_ATTEMPTS, deniedByServer);
  }

  /** One-shot: clears the flag on read so a later navigation to the same id doesn't reuse it. */
  private consumeSsrDeniedFlag(committeeId: string): boolean {
    if (!isPlatformBrowser(this.platformId) || !this.transferState.hasKey(this.ssrDeniedCommitteeKey)) {
      return false;
    }
    const deniedUid = this.transferState.get(this.ssrDeniedCommitteeKey, '');
    this.transferState.remove(this.ssrDeniedCommitteeKey);
    return deniedUid === committeeId;
  }

  private applyCommitteeLoadError(status: number | undefined): void {
    // Every terminal exit from the retry window must clear this itself: `accessFinalizing` can
    // already be true from an earlier retry in the same window, and the template checks it before
    // `error()`, so a stale true here would strand the page on "Finalizing your access" forever
    // (Cursor Bugbot).
    this.accessFinalizing.set(false);
    if (status === 403) {
      this.errorType.set('access-denied');
    } else if (status === 404) {
      this.errorType.set('not-found');
    } else {
      this.errorType.set('server-error');
    }
    this.error.set(true);
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: status === 404 ? 'Group not found' : 'Failed to load group details',
    });
  }

  private initializeMembers(): Signal<CommitteeMember[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          if (!committee?.uid) {
            this.membersLoading.set(false);
            return of([]);
          }

          this.membersLoading.set(true);

          return this.committeeService.getCommitteeMembers(committee.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.membersLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeInvites(): Signal<CommitteeInvite[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          // Writers need pending invites for direct-add stale-invite cleanup even in closed mode;
          // the Pending Invitations card is hidden separately in committee-members.
          if (!committee?.uid || !canManageCommitteeMembers(committee)) {
            this.invitesLoading.set(false);
            return of([] as CommitteeInvite[]);
          }

          this.invitesLoading.set(true);

          return this.committeeService.getCommitteeInvites(committee.uid).pipe(
            // Only pending invites belong on the roster — accepted ones are already members,
            // and declined/revoked ones shouldn't block re-inviting. Status casing varies
            // upstream, so compare case-insensitively.
            map((invites) => invites.filter((invite) => (invite.status ?? '').toLowerCase() === 'pending')),
            catchError(() => of([] as CommitteeInvite[])),
            finalize(() => this.invitesLoading.set(false))
          );
        })
      ),
      { initialValue: [] as CommitteeInvite[] }
    );
  }

  private initializeApplications(): Signal<CommitteeJoinApplication[]> {
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.membersRefresh)]).pipe(
        switchMap(([committee]) => {
          if (!committee?.uid || !canManageCommitteeMembers(committee) || committee.join_mode !== 'application') {
            this.applicationsLoading.set(false);
            return of([] as CommitteeJoinApplication[]);
          }

          this.applicationsLoading.set(true);

          return this.committeeService.getCommitteeApplications(committee.uid).pipe(
            catchError(() => of([] as CommitteeJoinApplication[])),
            finalize(() => this.applicationsLoading.set(false))
          );
        })
      ),
      { initialValue: [] as CommitteeJoinApplication[] }
    );
  }

  private initCanAccessEngagement(): Signal<boolean> {
    // linkedSignal, not toObservable/toSignal: the latter's Observable pipe is inherently a tick
    // behind the rest of the signal graph, so engagementKey's synchronous `roleLoading` (read from
    // myRoleLoading() directly) could see loading flip false a full tick before this signal caught
    // up, briefly re-reading its stale (loading-window) value as `notEligible` and flashing the
    // unavailable/em-dash state before the real eligibility resolved (Cursor Bugbot). linkedSignal's
    // computation runs synchronously within the same signal flush, so there's no such gap: it
    // returns the live eligibility once settled, or the last settled value while loading (false
    // pre-first-resolution, matching every other loader default in this file). Keyed on
    // committeeId() (the route-synchronous id, same distinguishing signal initEngagement's
    // routeCommitteeId uses) so the held value is only reused for a SAME-committee silent refresh:
    // route-reused navigation to a different committee must not keep rendering the previous
    // committee's eligibility (and therefore its stale Overview card, which is gated on this signal
    // alone with no loading check) while the new committee's own role is still resolving (Copilot).
    return linkedSignal<{ committeeId: string | null; loading: boolean; eligible: boolean }, boolean>({
      source: () => ({
        committeeId: this.committeeId(),
        // meetingCoordinatorLoading folded in here (not left as a separate downstream check) so the
        // linkedSignal holds its previous settled value through that fetch's window too, the same as
        // it already does for myRoleLoading().
        loading: this.myRoleLoading() || this.meetingCoordinatorLoading(),
        // Not `this.myRole() !== null` — the server's `committee#auditor` gate (`server/helpers/
        // committee-read-access.helper.ts:14-25`) deliberately excludes rank-and-file roster
        // members (`[user, team#member] or writer or auditor from project or meeting_coordinator
        // from project` has no plain-member leg); a roster member with none of the grants below
        // would open the Overview card / fire the fetch and land on a permanent unavailable state
        // after the expected 403 (Cursor Bugbot).
        eligible: this.canEdit() || this.canReview() || this.isCallerInAuditorList(this.committee()?.inherited_auditors) || this.meetingCoordinator(),
      }),
      computation: (source, previous) => {
        if (source.loading) {
          return previous && previous.source.committeeId === source.committeeId ? previous.value : false;
        }
        return source.eligible;
      },
    });
  }

  // Project-level `meeting_coordinator` FGA check (dealako, LFXV2-1705) — the fourth grant the
  // endpoint's `committee#auditor` relation accepts alongside member/writer/auditor-from-project,
  // which the checks above don't cover. Skips the fetch whenever one of the cheaper checks already
  // passed (mirrors ProjectService.getDirectGrantProjects' "only run meeting_coordinator for
  // non-writers" shortcut): those checks can't be invalidated by also being a meeting coordinator,
  // so there is nothing this fetch could change for an already-eligible caller. Uses
  // `getProject(uid, false, ...)` — `current: false` so this doesn't clobber ProjectService's
  // shared `project`/`project$` state, which the project-context surfaces elsewhere expect to
  // reflect the ACTIVE project, not incidentally whichever committee page happened to run this
  // check. getProject already resolves to `null` (never throws) on fetch failure, so this fails
  // closed like every other leg of canAccessEngagement.
  private initMeetingCoordinator(): Signal<{ committeeUid: string | null; loading: boolean; coordinator: boolean }> {
    return toSignal(
      toObservable(
        computed(() => ({
          // engagementMetricsEnabled() gates this the same as every other engagement fetch in this
          // file: flag off means zero engagement-related network activity, including this one, not
          // just the /engagement call itself (Cursor Bugbot -- this fetch fired for every non-roster
          // visitor regardless of the flag, breaking that guarantee).
          enabled: this.engagementMetricsEnabled(),
          // Tag every emission with the committee this evaluation is actually FOR (committee(),
          // resolved -- not committeeId(), the route-synchronous id) so meetingCoordinatorLoading/
          // meetingCoordinator above can tell a settled result apart from one still belonging to the
          // previous committee during a navigation gap.
          committeeUid: this.committee()?.uid ?? null,
          projectUid: this.committee()?.project_uid ?? null,
          // Same fix as canAccessEngagement's eligible above: a rank-and-file roster member on their
          // own doesn't satisfy committee#auditor, so their myRole() alone can't skip this probe.
          needed: !(this.canEdit() || this.canReview() || this.isCallerInAuditorList(this.committee()?.inherited_auditors)),
        }))
      ).pipe(
        distinctUntilChanged((a, b) => a.enabled === b.enabled && a.committeeUid === b.committeeUid && a.projectUid === b.projectUid && a.needed === b.needed),
        switchMap(({ enabled, committeeUid, projectUid, needed }) => {
          if (!enabled || !projectUid || !needed || !isPlatformBrowser(this.platformId)) {
            return of({ committeeUid, loading: false, coordinator: false });
          }
          return this.projectService.getProject(projectUid, false, { meetingCoordinator: true }).pipe(
            map((project) => ({ committeeUid, loading: false, coordinator: project?.meetingCoordinator === true })),
            startWith({ committeeUid, loading: true, coordinator: false })
          );
        })
      ),
      { initialValue: { committeeUid: null, loading: false, coordinator: false } }
    );
  }

  private initEngagement(): Signal<CommitteeEngagementResponse | null> {
    // One combined computed (not combineLatest over separate toObservable() sources) so the fields
    // — recomputed in the same signal flush — can't glitch through an inconsistent intermediate
    // tick that fires then immediately cancels a request (same reasoning as
    // committee-overview.component.ts's initDocuments). distinctUntilChanged only dedupes a
    // same-tuple re-emission — it does NOT suppress a silent refresh: like initDocuments, a
    // committee refresh flips roleLoading true then false through the tuple, which intentionally
    // cancels-and-refetches engagement (every refreshCommittee caller is membership/role-affecting,
    // so fresh rollups are wanted). The endpoint is Valkey-cached server-side but no-store on the
    // browser, so each such emission is a real round trip. membersRefresh is in the tuple so a
    // roster mutation (member added/removed) refetches engagement too — otherwise the members-tab
    // At-Risk count (client-joined against the fresh roster) and the overview card's server
    // summary could diverge until the next window switch.
    const engagementKey = computed(() => ({
      // The route's committee id updates synchronously on navigation (toSignal({requireSync:true})
      // on route.paramMap); `committee()` — and therefore `uid` below — only catches up once the
      // async committee fetch resolves. Comparing the two detects the in-between window where
      // engagement()/engagementLoading still reflect the PREVIOUS committee (Cursor Bugbot).
      routeCommitteeId: this.committeeId(),
      uid: this.committee()?.uid ?? null,
      window: this.engagementWindow(),
      // FeatureFlagService.providerReady() — not initialized(), which only confirms user context was
      // applied to the LaunchDarkly client, not that the provider has actually streamed real flag
      // values yet (dealako). engagementMetricsEnabled() is a plain computed() that reads its
      // LaunchDarkly default (false) until the provider is ready, and the Overview card's template
      // gate reads that same signal directly (synchronous). This async switchMap pipeline lags a tick
      // behind, so without flagResolved below, the transient pre-ready false could get treated as a
      // genuine "flag off" terminal state, then flash the unavailable UI once the real (true) value
      // resolves and the template gate opens before this pipeline's next emission catches up (Cursor
      // Bugbot).
      flagResolved: this.featureFlagService.providerReady(),
      enabled: this.engagementMetricsEnabled(),
      // meetingCoordinatorLoading folded in alongside myRoleLoading: canAccessEngagement's own
      // linkedSignal already holds through this fetch window, but this pipeline's EMPTY-hold branch
      // below reads roleLoading independently -- without it, a meeting-coordinator-only caller could
      // see notEligible momentarily true (canAccessEngagement synchronously settled false before the
      // project fetch even started) and clear engagementLoading before the real check resolves,
      // flashing the unavailable state (Cursor Bugbot).
      roleLoading: this.myRoleLoading() || this.meetingCoordinatorLoading(),
      // canAccessEngagement (roster member OR writer OR explicit committee-level auditor) — not raw
      // isVisitor(), which only means "not a roster member" and would wrongly block writers/auditors
      // who satisfy the endpoint's real committee#auditor gate without being on the roster.
      notEligible: !this.canAccessEngagement(),
      refresh: this.membersRefresh(),
    }));
    return toSignal(
      toObservable(engagementKey).pipe(
        // Suppress emissions entirely while there's no committee yet (matches initDocuments'
        // identical filter-before-switchMap shape) — the pipeline must not touch engagementLoading
        // at all during this phase, so it stays at its `true` initial value. Setting it `false` from
        // inside switchMap's old `!uid` branch fired on this very first tick (before the committee
        // fetch resolves), clearing the loading state prematurely and letting the unavailable/em-dash
        // states flash once the page's own spinner drops but before the real engagement fetch had a
        // chance to run (Cursor Bugbot).
        filter((key): key is typeof key & { uid: string } => key.uid !== null),
        distinctUntilChanged(
          (a, b) =>
            a.routeCommitteeId === b.routeCommitteeId &&
            a.uid === b.uid &&
            a.window === b.window &&
            a.flagResolved === b.flagResolved &&
            a.enabled === b.enabled &&
            a.roleLoading === b.roleLoading &&
            a.notEligible === b.notEligible &&
            a.refresh === b.refresh
        ),
        switchMap(({ routeCommitteeId, uid, window, flagResolved, enabled, roleLoading, notEligible }) => {
          // SSR (or an unreachable LaunchDarkly client that never initializes) fails closed to the
          // flag's default and stays that way forever — terminal immediately, no reason to wait.
          if (!isPlatformBrowser(this.platformId)) {
            this.engagementLoading.set(false);
            return of(null);
          }
          // Flag hasn't resolved a real value yet -- hold rather than treat the transient
          // pre-init default as a genuine "flag off" terminal state (see flagResolved comment above).
          if (!flagResolved) {
            return EMPTY;
          }
          // Flag resolved and genuinely off: the gated UI renders nothing, so a request would be
          // pure waste.
          if (!enabled) {
            this.engagementLoading.set(false);
            return of(null);
          }
          // Navigated to a different committee, but `committee()` (and thus `uid`) hasn't caught up
          // yet: `engagement()` still holds the PREVIOUS committee's data while `engagementWindow`
          // has already reset (linkedSignal keyed on committeeId, same tick as the route change) —
          // rendering that stale payload under the reset window pills would show mismatched
          // committee/window data with no loading indicator. Clear immediately (not EMPTY, which
          // would preserve it) and show the skeleton. Distinct from an ordinary same-committee
          // roleLoading refresh below, where the still-valid prior data should keep rendering.
          if (routeCommitteeId !== uid) {
            this.engagementLoading.set(true);
            return of(null);
          }
          // Role still resolving (e.g. mid silent-refresh) — hold current state rather than fire a
          // request that the eligibility check below might immediately invalidate.
          if (roleLoading) {
            return EMPTY;
          }
          // Not eligible per canAccessEngagement: skip the guaranteed-403 fetch entirely, matching
          // initDocuments' "don't issue a GET nothing will display" precedent. The Overview card is
          // gated on the same canAccessEngagement value (passed down as an input), so nothing would
          // render this response anyway.
          if (notEligible) {
            this.engagementLoading.set(false);
            return of(null);
          }
          this.engagementLoading.set(true);
          // Errors (including the expected 403 for non-auditor members) resolve to null inside the
          // service — the tabs degrade to their "attendance unavailable" states, roster unaffected.
          // tap on emission, not finalize: finalize also fires when switchMap cancels this in-flight
          // request (e.g. roleLoading flips true mid-refresh), which would clear engagementLoading
          // while engagement() still holds stale data — a visible flicker to the unavailable state on
          // every silent role refresh. Mirrors initDocuments' identical reasoning in
          // committee-overview.component.ts.
          return this.committeeService.getCommitteeEngagement(uid, window).pipe(tap(() => this.engagementLoading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }

  private initSubGroups(): Signal<Committee[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          this.subGroupsLoading.set(true);
          return this.committeeService.getChildCommittees(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.subGroupsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initParentGroup(): Signal<Committee | null> {
    return toSignal(
      toObservable(this.committee).pipe(
        switchMap((c) => {
          if (!c?.parent_uid) {
            return of(null);
          }
          return this.committeeService.fetchCommittee(c.parent_uid).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initAssociatedMailingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          return this.mailingListService.getMailingListsByCommittee(c.uid).pipe(catchError(() => of([])));
        })
      ),
      { initialValue: [] }
    );
  }

  private initUpcomingMeetings(): Signal<Meeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        map((c) => c.uid),
        // A refresh (e.g. a description save) re-emits a new Committee object with the same uid —
        // skip the redundant meetings round-trip when the id itself hasn't changed.
        distinctUntilChanged(),
        switchMap((uid) => {
          this.meetingsLoading.set(true);
          // Not skip_registrants: this list is now shared with the Meetings tab, which needs
          // full registrant data on each meeting (see committee-meetings.component.ts).
          return this.meetingService.getMeetingsByCommittee(uid).pipe(
            catchError((err) => {
              console.error('Failed to load committee meetings:', err);
              return of([]);
            }),
            finalize(() => this.meetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  /** Case-insensitive email OR username match against an auditor list (committee-scoped or inherited). */
  private isCallerInAuditorList(auditors: CommitteeUser[] | undefined): boolean {
    const email = this.userService.user()?.email?.toLowerCase();
    const username = this.userService.viewerUsername()?.toLowerCase();
    if (!email && !username) return false;
    return auditors?.some((u) => (email && u.email?.toLowerCase() === email) || (username && u.username?.toLowerCase() === username)) ?? false;
  }

  private getJoinErrorMessage(err: HttpErrorResponse, committeeName: string): string {
    const upstream = err.error?.message as string | undefined;
    if (err.status === 409) {
      return 'You are already a member of this group.';
    }
    if (upstream?.includes('organization')) {
      return 'This group requires a verified organization to join. Please contact an admin for access.';
    }
    if (upstream?.includes('business email')) {
      return 'This group requires a business email address to join. Please contact an admin for access.';
    }
    if (err.status === 403) {
      return 'You do not have permission to join this group.';
    }
    return upstream ?? `Failed to join "${committeeName}". Please try again.`;
  }
}
