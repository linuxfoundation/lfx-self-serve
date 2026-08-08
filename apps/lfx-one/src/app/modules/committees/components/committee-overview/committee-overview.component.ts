// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  DEFAULT_MEETING_TYPE_CONFIG,
  MEETING_TYPE_CONFIGS,
  PAST_MEETING_SORT,
  PENDING_ACTION_EMPTY_GRACE_MS,
  PENDING_ACTION_FADE_OUT_MS,
  PENDING_ACTION_LABEL,
  PENDING_ACTION_SEVERITY,
} from '@lfx-one/shared/constants';
import { CommitteeMemberRole, PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
import {
  ActivityFeedItem,
  ActivityFeedRow,
  ActivityMeetingBadge,
  Committee,
  CommitteeEngagementResponse,
  CommitteeEngagementWindow,
  CommitteeMember,
  CommitteePendingActionRow,
  Meeting,
  PastMeeting,
  PendingActionItem,
  Survey,
  Vote,
} from '@lfx-one/shared/interfaces';
import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW } from '@lfx-one/shared/constants';
import {
  assertNeverSilent,
  countVotingReps,
  formatRelativeTime,
  getSurveyDisplayStatus,
  isValidUrl,
  mapActivityEventsToFeedItems,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { SurveyService } from '@services/survey.service';
import { VoteService } from '@services/vote.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, EMPTY, filter, finalize, forkJoin, map, of, switchMap, take, tap } from 'rxjs';

import { DashboardMeetingCardComponent } from '../../../dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { SurveyResultsDrawerComponent } from '../../../surveys/components/survey-results-drawer/survey-results-drawer.component';
import { VoteResultsDrawerComponent } from '../../../votes/components/vote-results-drawer/vote-results-drawer.component';
import { CommitteeEngagementSummaryComponent } from '../committee-engagement-summary/committee-engagement-summary.component';
import { EditChairsDialogComponent } from '../edit-chairs-dialog/edit-chairs-dialog.component';
import { GroupJoinCtaComponent } from '../group-join-cta/group-join-cta.component';
import { WeeklyBriefCardComponent } from '../weekly-brief-card/weekly-brief-card.component';

@Component({
  selector: 'lfx-committee-overview',
  imports: [
    ButtonComponent,
    CardComponent,
    CommitteeEngagementSummaryComponent,
    DashboardMeetingCardComponent,
    GroupJoinCtaComponent,
    SkeletonModule,
    SurveyResultsDrawerComponent,
    TagComponent,
    VoteResultsDrawerComponent,
    WeeklyBriefCardComponent,
  ],
  providers: [DialogService],
  templateUrl: './committee-overview.component.html',
  styleUrl: './committee-overview.component.scss',
})
export class CommitteeOverviewComponent {
  protected readonly typeLabels = PENDING_ACTION_LABEL;

  // Injections
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly voteService = inject(VoteService);
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Inputs
  public committee = input.required<Committee>();
  public members = input<CommitteeMember[]>([]);
  public membersLoading = input<boolean>(true);
  public canEdit = input<boolean>(false);
  public myRole = input<string | null>(null);
  public myMemberUid = input<string | null>(null);
  public myRoleLoading = input<boolean>(true);
  // True when the viewer has a pending invitation to this group — suppresses the visitor join CTA
  // (the Accept/Decline banner on the group page is the action; a "Request Access" CTA would be redundant).
  public hasPendingInvite = input<boolean>(false);
  public hasPendingApplication = input<boolean>(false);
  // Passed down from committee-view, which already fetches this once for the page (both this tab
  // and About need it, and About's cadence card would otherwise cause a second, redundant fetch).
  public meetings = input<Meeting[]>([]);
  public upcomingMeetingsLoading = input<boolean>(true);
  // Engagement rollup (LFXV2-1705, behind wg-engagement-metrics) — fetched at the page level and
  // shared with the Members tab so the window selection survives tab switches.
  public engagementEnabled = input<boolean>(false);
  public engagement = input<CommitteeEngagementResponse | null>(null);
  public engagementLoading = input<boolean>(false);
  public engagementWindow = input<CommitteeEngagementWindow>(COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW);
  // Whether this user is authorized to read committee engagement data — computed once in
  // committee-view.component.ts (canAccessEngagement: roster member, writer, or a committee-level
  // OR inherited project/foundation auditor) and passed down here as the single source of truth,
  // rather than this component reconstructing its own narrower version (LFXV2-1705 review).
  public engagementAccessible = input<boolean>(false);

  // Outputs
  public readonly committeeUpdated = output<void>();
  public readonly joinRequested = output<void>();
  public readonly tabNavigated = output<string>();
  public readonly engagementWindowChange = output<CommitteeEngagementWindow>();

  // Vote drawer state
  public voteDrawerVisible = signal(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Survey drawer state
  public surveyDrawerVisible = signal(false);
  public selectedSurveyId = signal<string | null>(null);
  public selectedSurvey = signal<Survey | null>(null);

  // Loading states for stats
  public meetingsLoading = signal(true);
  public votesLoading = signal(true);
  public surveysLoading = signal(true);

  // Loading state for past meetings (upcoming meetings loading comes in as the input above)
  public pastMeetingsLoading = signal(true);

  // Activity feed loading — own dedicated signal (LFXV2-1707): the feed is now a single
  // server-merged fetch, no longer derived from four separate source-loading signals.
  public activityFeedLoading = signal(true);

  // Section-level fade-out for "My Pending Actions": true while the CSS collapse animation is in flight;
  // isSectionHidden removes the section from the DOM once the last vote/survey is resolved.
  // isSectionGracePending keeps the section mounted (not yet fading) during the post-empty grace window so a
  // context switch that briefly empties the list doesn't trigger a spurious fade before the new data arrives.
  // Template-only state — protected, matching pending-actions.component.ts.
  protected readonly isSectionFading = signal(false);
  protected readonly isSectionHidden = signal(false);
  protected readonly isSectionGracePending = signal(false);
  private sectionEverShown = false;
  // setTimeout handle for the in-flight grace/section-fade; cleared when actions repopulate or on destroy to prevent stale hides.
  private sectionFadeTimerId: ReturnType<typeof setTimeout> | null = null;

  // Lookup for the meeting-type/duration badge on `past_meeting` activity rows — keyed by
  // PastMeeting.id, the same field `action.meetingId` carries (see handleActivityItemClick's
  // 'past-meeting' case comment above: action.meetingId matches PastMeeting.id, not meeting_id).
  // pastMeetings() is its own independently-windowed fetch (like votes()/surveys() below), so a
  // meetingId with no entry here is an expected miss, not an error — activityMeetingBadge()
  // returns null for it and the row renders unchanged. Not used by the template directly (only
  // via activityMeetingBadge()), so this stays private rather than following the public-signal
  // convention the rest of this "data fetches" section uses.
  private readonly pastMeetingsById: Signal<Map<string, PastMeeting>> = this.initPastMeetingsById();

  // Computed: chairs derived from members
  public chairs: Signal<CommitteeMember[]> = this.initChairs();

  // Computed: member options for select dropdowns
  public memberOptions: Signal<{ label: string; value: string }[]> = computed(() =>
    this.members().map((m) => ({ label: `${m.first_name} ${m.last_name}`, value: m.uid }))
  );

  // Computed: distinct organization count from members
  public orgCount: Signal<number> = computed(() => {
    const allMembers = this.members();
    const orgs = new Set(allMembers.map((m) => m.organization?.name).filter(Boolean));
    return orgs.size;
  });

  // Computed: voting representative count from members. Not sourced from
  // committee().total_voting_repos — upstream (lfx-v2-committee-service) defines that field as
  // "total repositories with voting permissions" (not people), is optional (upstream only sets it
  // when > 0), and no production code path currently writes it, so it reads undefined in practice.
  // This derives the actual per-member voting-rep count instead, via the shared countVotingReps()
  // util (also used by committee-members.component.ts's votingRepCount).
  public votingRepsCount: Signal<number> = computed(() => countVotingReps(this.members()));

  // Committee-scoped data fetches
  public meetingsCount: Signal<number> = this.initMeetingsCount();
  public pastMeetings: Signal<PastMeeting[]> = this.initPastMeetings();
  public votes: Signal<Vote[]> = this.initVotes();
  public surveys: Signal<Survey[]> = this.initSurveys();

  // Computed stats from fetched data
  public activeVotesCount: Signal<number> = computed(() => this.votes().filter((v) => v.status === PollStatus.ACTIVE).length);

  public openSurveysCount: Signal<number> = computed(() => this.surveys().filter((s) => getSurveyDisplayStatus(s) === SurveyStatus.OPEN).length);

  // Server-merged "Recent Activity" feed (LFXV2-1707): fetched as one call, mapped to the UI
  // view-model client-side. See mapActivityEventsToFeedItems for the label/icon/action mapping.
  public activityItems: Signal<ActivityFeedItem[]> = this.initActivityItems();

  // Per-row display fields (timestamp label, tooltip, meeting-type/duration badge), precomputed
  // here rather than via template method calls — docs/reviews/frontend-checklist.md §4 only
  // allows signal reads, computed values, and pipes in templates. Mirrors
  // my-groups-card-grid.component.ts's initCards() precomputed-view-model pattern.
  public activityFeedRows: Signal<ActivityFeedRow[]> = this.initActivityFeedRows();

  // Feature flag: WG Weekly Brief AI Assistant card
  public readonly weeklyBriefEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag('wg-weekly-brief', false);

  // Role-based computed signals
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.myRoleLoading());

  public pendingVotes: Signal<Vote[]> = computed(() => this.votes().filter((v) => v.status === PollStatus.ACTIVE));
  public pendingSurveys: Signal<Survey[]> = computed(() =>
    this.surveys().filter((s) => getSurveyDisplayStatus(s) === SurveyStatus.OPEN && s.response_status?.toLowerCase() !== 'responded')
  );
  public respondedSurveys: Signal<Survey[]> = computed(() =>
    this.surveys().filter((s) => getSurveyDisplayStatus(s) === SurveyStatus.OPEN && s.response_status?.toLowerCase() === 'responded')
  );
  public hasPendingActions: Signal<boolean> = computed(() => this.pendingVotes().length > 0 || this.pendingSurveys().length > 0);

  public pendingActionItems: Signal<CommitteePendingActionRow[]> = this.initPendingActionItems();
  public pendingActionsViewAllTab: Signal<'votes' | 'surveys'> = this.initPendingActionsViewAllTab();
  public categoryLabel: Signal<string> = computed(() => (this.committee().category || 'Group').toLowerCase());

  public nextMeeting: Signal<Meeting | null> = computed(() => {
    const upcoming = [...this.meetings()].sort((a, b) => a.start_time.localeCompare(b.start_time));
    return upcoming[0] ?? null;
  });

  public lastMeeting: Signal<PastMeeting | null> = computed(() => {
    const past = [...this.pastMeetings()].sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''));
    return past[0] ?? null;
  });

  public constructor() {
    // When the last pending vote/survey is resolved, fade the section out then remove it from the DOM.
    // sectionEverShown prevents the fade from triggering on initial load with zero actions.
    toObservable(this.pendingActionItems)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        if (items.length > 0) {
          this.sectionEverShown = true;
          // Cancel any in-flight grace/fade so a repopulated section stays visible.
          this.clearSectionFadeTimer();
          this.isSectionGracePending.set(false);
          this.isSectionHidden.set(false);
          this.isSectionFading.set(false);
        } else if (this.sectionEverShown && !this.isSectionHidden() && this.sectionFadeTimerId === null) {
          // Wait a grace period before fading: a context switch (changing group) can briefly empty the list
          // before new data arrives — if it repopulates within the grace, the items>0 branch cancels this timer
          // and nothing fades. The sectionFadeTimerId guard also prevents overlapping timers on repeated empty
          // emissions. isSectionGracePending keeps the section mounted (stable, not collapsing) during the grace.
          this.isSectionGracePending.set(true);
          this.sectionFadeTimerId = setTimeout(() => {
            // Still empty after the grace — commit to the fade.
            this.sectionFadeTimerId = null;
            this.isSectionGracePending.set(false);
            this.isSectionFading.set(true);
            this.sectionFadeTimerId = setTimeout(() => {
              this.sectionFadeTimerId = null;
              this.isSectionHidden.set(true);
            }, PENDING_ACTION_FADE_OUT_MS + 50);
          }, PENDING_ACTION_EMPTY_GRACE_MS);
        }
      });

    // Cancel pending section-hide so it can't fire on a destroyed component.
    this.destroyRef.onDestroy(() => this.clearSectionFadeTimer());
  }

  // Action methods
  public navigateToTab(tab: string): void {
    this.tabNavigated.emit(tab);
  }

  // Shared by handleActivityItemClick's 'vote-drawer' case and weekly-brief-card's
  // voteDrawerRequested output (LFXV2-3044) — both need the same lookup-or-toast behavior,
  // not two copies of it.
  //
  // this.votes() and the caller's own source (the activity feed, or a weekly brief's
  // source_refs) are independent server fetches (the former page_size=100 by updated_at) — a
  // vote recent enough to appear in either isn't guaranteed to be within this fetch's window,
  // so this lookup can miss.
  //
  // A miss here is recoverable in principle — VoteResultsDrawerComponent's own initVote()
  // re-fetches by voteId with a startWith(listVote) fallback, so opening the drawer with just
  // voteId set (no local seed) would still resolve. Not done here: the drawer's template has
  // no `@else` on `@if (vote(); as voteData)`, so a null seed renders an empty drawer with no
  // loading or not-found state until (or unless) that fetch settles — worse than this toast
  // for the genuinely-missing case, and out of this component's scope to add. Toast instead.
  public openVoteDrawer(voteUid: string): void {
    const vote = this.votes().find((v) => v.uid === voteUid);
    if (vote) {
      this.selectedVoteId.set(vote.uid);
      this.selectedVote.set(vote);
      this.voteDrawerVisible.set(true);
    } else {
      this.messageService.add({ severity: 'warn', summary: 'Vote unavailable', detail: 'This vote could not be found. Try the Votes tab instead.' });
    }
  }

  public handlePendingActionClick(item: PendingActionItem): void {
    if (item.type === 'Vote') {
      const vote = this.pendingVotes().find((v) => v.uid === item.buttonLink);
      if (vote) {
        this.selectedVoteId.set(vote.uid);
        this.selectedVote.set(vote);
        this.voteDrawerVisible.set(true);
      }
    } else {
      this.tabNavigated.emit('surveys');
    }
  }

  public handleActivityItemClick(item: ActivityFeedItem): void {
    const { action } = item;
    switch (action.kind) {
      case 'past-meeting': {
        // Matches the "Past Meeting" card's own link two sections up
        // (`[detailUrl]="'/meetings/' + meeting.id"`) and its password query param
        // (`dashboard-meeting-card.component.ts`'s `initMeetingDetailQueryParams`) — a password-gated
        // committee meeting needs that param carried through, matching the established convention at
        // `meetings-dashboard.component.ts`'s `onCalendarEventClick`.
        //
        // action.password comes from the source event's own payload, not a lookup against
        // this.pastMeetings() — that signal is a separate, independently-windowed fetch, so a
        // password-protected meeting recent enough to appear in the activity feed isn't guaranteed
        // to be in pastMeetings()'s own window; a lookup-based password would silently be dropped on
        // navigation for exactly the rows this matters most for (Copilot/Cursor Bugbot/dealako review
        // on PR #1288).
        void this.router.navigate(['/meetings', action.meetingId], action.password ? { queryParams: { password: action.password } } : {});
        break;
      }
      case 'vote-drawer':
        this.openVoteDrawer(action.voteUid);
        break;
      case 'survey-drawer': {
        // Different failure mode than the vote-drawer case above, same toast-instead remedy.
        // Unlike votes (a genuine window-size mismatch — getVotesByCommittee pins page_size=100),
        // the server's SurveyService.getSurveys drains every page via fetchAllQueryResources, so
        // this.surveys() is not a windowed slice — but "drains every page" isn't "always complete":
        // fetchAllQueryResources defaults to failOnPartial=false (this call site doesn't override
        // it), so a later page failing after retries returns what was fetched so far rather than
        // throwing, and initSurveys' own catchError(() => of([])) yields an empty array on a
        // failed/in-flight fetch regardless of drain completeness. So a miss here is normally
        // fetch-timing staleness against the activity feed's independent request (the common case,
        // since surveys() usually is complete) rather than a bounded-window gap like votes — but
        // isn't guaranteed to be. Same recoverable-in-principle/toast-instead trade-off regardless:
        // SurveyResultsDrawerComponent's own initSurvey() has the identical startWith/re-fetch
        // shape and the identical missing `@else` on its template's `@if` as
        // VoteResultsDrawerComponent.
        const survey = this.surveys().find((s) => s.uid === action.surveyUid);
        if (survey) {
          this.selectedSurveyId.set(survey.uid);
          this.selectedSurvey.set(survey);
          this.surveyDrawerVisible.set(true);
        } else {
          this.messageService.add({ severity: 'warn', summary: 'Survey unavailable', detail: 'This survey could not be found. Try the Surveys tab instead.' });
        }
        break;
      }
      case 'external-url':
        // mapActivityEventsToFeedItems only emits this action for urls that pass isValidUrl, but
        // re-check at this sink rather than trusting that comment-enforced invariant — the action
        // is constructed client-side from a server-fed ActivityEvent, not a value this component
        // controls end-to-end.
        if (isValidUrl(action.url)) {
          window.open(action.url, '_blank', 'noopener,noreferrer');
        }
        break;
      case 'tab':
        this.navigateToTab(action.tab);
        break;
      default:
        // assertNeverSilent: this runs inside a DOM click handler, and this action is constructed
        // from a server-fed ActivityEvent (LFXV2-1707), so an unrecognized future `kind` (e.g. a
        // version-skewed client) should no-op rather than throw uncaught from a click. The
        // compile-time guarantee is unchanged — a new unhandled kind still fails to compile, since
        // the call below only type-checks if `action` has narrowed to `never`. console.error (not
        // .warn) matches the level this app already uses elsewhere for genuinely-unexpected state
        // (e.g. datadog-rum.provider.ts) — not a confirmed guarantee this specific call reaches
        // Datadog RUM, since RUM here isn't configured to forward console output.
        console.error('Unhandled activity action kind:', (action as { kind: string }).kind);
        assertNeverSilent(action);
    }
  }

  // Mirrors surveys-dashboard.component.ts's own stub handling (also TODOs there) rather than
  // silently swallowing the event.
  public onSurveyDuplicate(surveyId: string): void {
    // TODO: Implement survey duplication when API is available
    console.warn('Survey duplication not yet implemented for:', surveyId);
    this.surveyDrawerVisible.set(false);
  }

  public onSurveyClose(surveyId: string): void {
    // TODO: Implement survey close when API is available
    console.warn('Survey close not yet implemented for:', surveyId);
    this.surveyDrawerVisible.set(false);
  }

  // Chairs edit methods
  public startEditChairs(): void {
    const currentChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.CHAIR);
    const currentViceChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.VICE_CHAIR);

    const ref = this.dialogService.open(EditChairsDialogComponent, {
      header: 'Edit Chairs',
      width: '480px',
      modal: true,
      closable: true,
      draggable: false,
      data: {
        members: this.memberOptions(),
        currentChairUid: currentChair?.uid || null,
        currentViceChairUid: currentViceChair?.uid || null,
      },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: { chairUid: string | null; viceChairUid: string | null } | undefined) => {
      if (result) {
        this.saveChairs(result.chairUid, result.viceChairUid);
      }
    });
  }

  public saveChairs(newChairUid: string | null, newViceChairUid: string | null): void {
    const committeeId = this.committee().uid;
    const currentChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.CHAIR);
    const currentViceChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.VICE_CHAIR);

    if (newChairUid && newChairUid === newViceChairUid) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Chair and Vice Chair must be different members' });
      return;
    }

    // Serialize: removals first, then assignments to avoid race conditions
    const removals: ReturnType<typeof this.committeeService.updateCommitteeMember>[] = [];
    const assignments: ReturnType<typeof this.committeeService.updateCommitteeMember>[] = [];

    // Remove old chair role if changed
    if (currentChair && currentChair.uid !== newChairUid) {
      removals.push(this.committeeService.updateCommitteeMember(committeeId, currentChair.uid, { role: { name: CommitteeMemberRole.NONE } }));
    }
    // Remove old vice chair role if changed
    if (currentViceChair && currentViceChair.uid !== newViceChairUid) {
      removals.push(this.committeeService.updateCommitteeMember(committeeId, currentViceChair.uid, { role: { name: CommitteeMemberRole.NONE } }));
    }
    // Assign new chair
    if (newChairUid && newChairUid !== currentChair?.uid) {
      assignments.push(this.committeeService.updateCommitteeMember(committeeId, newChairUid, { role: { name: CommitteeMemberRole.CHAIR } }));
    }
    // Assign new vice chair
    if (newViceChairUid && newViceChairUid !== currentViceChair?.uid) {
      assignments.push(this.committeeService.updateCommitteeMember(committeeId, newViceChairUid, { role: { name: CommitteeMemberRole.VICE_CHAIR } }));
    }

    if (removals.length === 0 && assignments.length === 0) {
      return;
    }

    // Execute removals first, then assignments
    (removals.length > 0 ? forkJoin(removals) : of([])).pipe(switchMap(() => (assignments.length > 0 ? forkJoin(assignments) : of([])))).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Chairs updated' });
        this.committeeUpdated.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Unable to Save',
          detail: getHttpErrorDetail(err, 'Failed to update chairs. Please try again.'),
        });
      },
    });
  }

  private clearSectionFadeTimer(): void {
    if (this.sectionFadeTimerId !== null) {
      clearTimeout(this.sectionFadeTimerId);
      this.sectionFadeTimerId = null;
    }
  }

  // Private initializer functions
  private initChairs(): Signal<CommitteeMember[]> {
    return computed(() => {
      const allMembers = this.members();
      return allMembers
        .filter((m) => m.role?.name === CommitteeMemberRole.CHAIR || m.role?.name === CommitteeMemberRole.VICE_CHAIR)
        .sort((a, b) => (a.role?.name === CommitteeMemberRole.CHAIR ? -1 : 1) - (b.role?.name === CommitteeMemberRole.CHAIR ? -1 : 1));
    });
  }

  private initMeetingsCount(): Signal<number> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.meetingsLoading.set(true);
          return this.meetingService.getMeetingsCountByCommittee(c.uid).pipe(
            catchError(() => of(0)),
            finalize(() => this.meetingsLoading.set(false))
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initPastMeetings(): Signal<PastMeeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.pastMeetingsLoading.set(true);
          return this.meetingService.getPastMeetingsByCommittee(c.uid, PAST_MEETING_SORT.NAME_DESC).pipe(
            catchError(() => of([])),
            finalize(() => this.pastMeetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initPastMeetingsById(): Signal<Map<string, PastMeeting>> {
    return computed(() => new Map(this.pastMeetings().map((meeting) => [meeting.id, meeting])));
  }

  private initVotes(): Signal<Vote[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.votesLoading.set(true);
          return this.voteService.getVotesByCommittee(c.uid, 'updated_at.desc').pipe(
            catchError(() => of([])),
            finalize(() => this.votesLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initPendingActionItems(): Signal<CommitteePendingActionRow[]> {
    return computed(() => {
      const voteItems: PendingActionItem[] = this.pendingVotes().map((vote) => ({
        type: 'Vote',
        badge: this.committee().name,
        text: vote.name,
        icon: 'fa-light fa-check-to-slot',
        severity: PENDING_ACTION_SEVERITY.Vote,
        buttonText: 'Review and Vote',
        buttonLink: vote.uid,
        date: vote.end_time
          ? `Deadline: ${new Date(vote.end_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : undefined,
      }));
      const surveyItems: PendingActionItem[] = this.pendingSurveys().map((survey) => {
        const sentDate = survey.created_at ? new Date(survey.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
        const dueDate = survey.survey_cutoff_date
          ? new Date(survey.survey_cutoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : null;
        const dateParts: string[] = [];
        if (sentDate) dateParts.push(`Sent: ${sentDate}`);
        if (dueDate) dateParts.push(`Due: ${dueDate}`);

        return {
          type: 'Survey',
          badge: this.committee().name,
          text: survey.survey_title,
          icon: 'fa-light fa-chart-simple',
          severity: PENDING_ACTION_SEVERITY.Survey,
          buttonText: 'Submit Survey',
          date: dateParts.length > 0 ? dateParts.join(' · ') : undefined,
        };
      });
      const respondedSurveyItems: PendingActionItem[] = this.respondedSurveys().map((survey) => ({
        type: 'Submitted',
        badge: this.committee().name,
        text: survey.survey_title,
        icon: 'fa-light fa-circle-check',
        severity: PENDING_ACTION_SEVERITY.Submitted,
        // No buttonLink: the committee surveys query does not populate the per-user
        // SurveyMonkey link (survey_link is Me-lens-only data on /api/surveys/my-surveys),
        // and handlePendingActionClick falls through to tabNavigated('surveys') for
        // non-Vote items. The label reflects what actually happens on click — navigation
        // to the surveys tab. To re-enable an in-place "Update" CTA, the committee
        // surveys endpoint would need to enrich each row with the current user's
        // survey_response.survey_link.
        buttonText: 'View',
        date: undefined,
      }));
      return [...voteItems, ...surveyItems, ...respondedSurveyItems].map((item, index) => {
        const rowKey = item.buttonLink ? `${item.type}-${item.buttonLink}` : `${item.type}-${item.text}-${index}`;
        return { ...item, rowKey };
      });
    });
  }

  private initPendingActionsViewAllTab(): Signal<'votes' | 'surveys'> {
    return computed(() => {
      const hasVotes = this.pendingActionItems().some((item) => item.type === 'Vote');
      return hasVotes ? 'votes' : 'surveys';
    });
  }

  private initSurveys(): Signal<Survey[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.surveysLoading.set(true);
          return this.surveyService.getSurveysByCommittee(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.surveysLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initActivityItems(): Signal<ActivityFeedItem[]> {
    // Skip-for-visitor + distinctUntilChanged shape mirrors this component's other committee-scoped
    // fetches: the feed (and everything else in the enclosing !isVisitor() block) never renders for
    // a visitor, so this fetch should never fire for one either. Derived from one combined computed
    // (not combineLatest over separate toObservable() sources) so committee/myRoleLoading/isVisitor —
    // all recomputed together in the same signal flush — can't glitch through an inconsistent
    // intermediate tick that fires then immediately cancels a request.
    return toSignal(
      toObservable(computed(() => ({ committee: this.committee(), roleLoading: this.myRoleLoading(), visitor: this.isVisitor() }))).pipe(
        filter(({ committee }) => !!committee?.uid),
        distinctUntilChanged((a, b) => a.committee.uid === b.committee.uid && a.roleLoading === b.roleLoading && a.visitor === b.visitor),
        switchMap(({ committee, roleLoading, visitor }) => {
          if (roleLoading) {
            // Role still resolving (e.g. mid silent-refresh) — hold state as-is; the fetch branch
            // below clears activityFeedLoading with tap (fires only on emission), not finalize (also
            // fires on switchMap-driven cancellation), so cancelling in-flight to enter this branch
            // can't have already cleared it out from under us.
            return EMPTY;
          }
          if (visitor) {
            this.activityFeedLoading.set(false);
            return of<ActivityFeedItem[]>([]);
          }
          this.activityFeedLoading.set(true);
          return this.committeeService.getCommitteeActivity(committee.uid).pipe(
            map((events) => mapActivityEventsToFeedItems(events, { votingEnabled: !!committee.enable_voting })),
            tap(() => this.activityFeedLoading.set(false)),
            // CommitteeService.getCommitteeActivity already falls back to of([]) on failure, so this
            // catchError is a belt-and-suspenders guard against that coupling changing underneath
            // this component — without it, an error here would kill this toSignal source permanently
            // and pin activityFeedLoading() on its skeleton for the rest of the session. Reaching this
            // handler at all means the mapping step itself threw (not the upstream fetch, which the
            // service already logs and degrades on its own) — worth its own log line, not just surviving.
            catchError((error: unknown) => {
              // A safe subset, not the raw error object — this is a synchronous mapping failure
              // (not an HTTP error, so no HttpErrorResponse.status here), and the underlying
              // upstream fetch failure (if any) is already logged server-side with more structure.
              console.error('Failed to map committee activity feed:', { message: error instanceof Error ? error.message : String(error) });
              this.activityFeedLoading.set(false);
              return of<ActivityFeedItem[]>([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initActivityFeedRows(): Signal<ActivityFeedRow[]> {
    return computed(() =>
      this.activityItems().map((item) => ({
        item,
        // item.timestamp is an ISO string (event.occurred_at); formatRelativeTime takes a Date.
        timestampLabel: formatRelativeTime(new Date(item.timestamp)),
        // Every ActivityFeedItem carries a timestamp, so this isn't scoped to meeting_held rows
        // the way deriveMeetingBadge() is — the absolute-date tooltip applies to all row types.
        // Deliberately NOT formatShortDate() — that util pins timeZone: 'UTC', which is correct
        // for the date-only range-preview strings it was written for but would show the wrong
        // calendar day here for a full-instant timestamp in negative-UTC-offset zones (e.g. an
        // evening event crossing into the next UTC day). Uses the same no-timezone-override Intl
        // options this file already uses for vote/survey dates above (initPendingActionItems),
        // which resolve in the viewer's local timezone instead.
        tooltip: `${item.label} (${new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`,
        meetingBadge: this.deriveMeetingBadge(item),
      }))
    );
  }

  // Enrichment scoped to past-meeting rows only (LFXV2-3009): differentiates otherwise-identical
  // recurring-series rows (e.g. 8x "Meeting held: Identity & Trust Working Group") with the
  // meeting's type + duration, sourced from pastMeetings() already loaded on this page — no
  // BFF/mapper change. Narrowing on action.kind (not item.type) gives TS access to meetingId.
  private deriveMeetingBadge(item: ActivityFeedItem): ActivityMeetingBadge | null {
    if (item.action.kind !== 'past-meeting') return null;
    const meeting = this.pastMeetingsById().get(item.action.meetingId);
    if (!meeting) return null;

    const config = meeting.meeting_type
      ? (MEETING_TYPE_CONFIGS[meeting.meeting_type.toLowerCase()] ?? DEFAULT_MEETING_TYPE_CONFIG)
      : DEFAULT_MEETING_TYPE_CONFIG;
    // meeting.duration is minutes, not seconds — formatDuration() takes seconds and would
    // misformat here; dashboard-meeting-card.component.ts's initFormattedTimeWithDuration
    // establishes the plain `${duration}m` convention for this exact field, reused verbatim.
    const label = meeting.duration > 0 ? `${config.label} · ${meeting.duration}m` : config.label;
    return { label, icon: config.icon };
  }
}
