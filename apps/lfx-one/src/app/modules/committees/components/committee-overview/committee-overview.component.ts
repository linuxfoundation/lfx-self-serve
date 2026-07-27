// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  PAST_MEETING_SORT,
  PENDING_ACTION_EMPTY_GRACE_MS,
  PENDING_ACTION_FADE_OUT_MS,
  PENDING_ACTION_LABEL,
  PENDING_ACTION_SEVERITY,
  POLL_STATUS_LABELS,
  SURVEY_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus, PollStatus, SurveyStatus } from '@lfx-one/shared/enums';
import {
  ActivityFeedItem,
  Committee,
  CommitteeDocument,
  CommitteeDocumentType,
  CommitteeMember,
  CommitteePendingActionRow,
  Meeting,
  PastMeeting,
  PendingActionItem,
  Survey,
  Vote,
} from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { SurveyService } from '@services/survey.service';
import { VoteService } from '@services/vote.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, filter, finalize, forkJoin, of, switchMap, take } from 'rxjs';

import { DashboardMeetingCardComponent } from '../../../dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { VoteResultsDrawerComponent } from '../../../votes/components/vote-results-drawer/vote-results-drawer.component';
import { getDocumentTypeIconClass } from '../../pipes/document-type-icon.pipe';
import { EditChairsDialogComponent } from '../edit-chairs-dialog/edit-chairs-dialog.component';

@Component({
  selector: 'lfx-committee-overview',
  imports: [CardComponent, ButtonComponent, DashboardMeetingCardComponent, SkeletonModule, TagComponent, VoteResultsDrawerComponent],
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

  // Outputs
  public readonly committeeUpdated = output<void>();
  public readonly joinRequested = output<void>();
  public readonly tabNavigated = output<string>();

  // Vote drawer state
  public voteDrawerVisible = signal(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Loading states for stats
  public meetingsLoading = signal(true);
  public votesLoading = signal(true);
  public surveysLoading = signal(true);
  public documentsLoading = signal(true);

  // Loading states for meeting sections
  public upcomingMeetingsLoading = signal(true);
  public pastMeetingsLoading = signal(true);

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
  // "total repositories with voting permissions" (not people) and no production code path writes
  // it, so it always reads 0. This derives the actual per-member voting-rep count instead.
  public votingRepsCount: Signal<number> = computed(() => this.members().filter((m) => m.voting?.status === CommitteeMemberVotingStatus.VOTING_REP).length);

  // Committee-scoped data fetches
  public meetingsCount: Signal<number> = this.initMeetingsCount();
  public meetings: Signal<Meeting[]> = this.initMeetings();
  public pastMeetings: Signal<PastMeeting[]> = this.initPastMeetings();
  public votes: Signal<Vote[]> = this.initVotes();
  public surveys: Signal<Survey[]> = this.initSurveys();
  // Documents aren't otherwise loaded on Overview — fetched here solely to seed the activity feed.
  // CommitteeService.getCommitteeDocuments has no shared cache, so the Documents tab still issues
  // its own request; accepted as a cheap duplicate GET rather than lifting the fetch up to committee-view.
  public documents: Signal<CommitteeDocument[]> = this.initDocuments();

  // Computed stats from fetched data
  public activeVotesCount: Signal<number> = computed(() => this.votes().filter((v) => v.status === PollStatus.ACTIVE).length);

  public openSurveysCount: Signal<number> = computed(() => this.surveys().filter((s) => getSurveyDisplayStatus(s) === SurveyStatus.OPEN).length);

  // Activity feed stop-gap: merges the latest items across past meetings, votes, surveys, and
  // documents into one time-ordered list. Replaced by the real activity stream in LFXV2-1707.
  public activityFeedLoading: Signal<boolean> = computed(
    () => this.pastMeetingsLoading() || this.votesLoading() || this.surveysLoading() || this.documentsLoading()
  );

  public activityItems: Signal<ActivityFeedItem[]> = this.initActivityItems();

  // Role-based computed signals
  public isVisitor: Signal<boolean> = computed(() => this.myRole() === null && !this.myRoleLoading());
  public isChairOrAbove: Signal<boolean> = computed(() => this.myRole() === 'Chair' || this.myRole() === 'Vice Chair');

  public bannerType: Signal<'visitor' | 'member' | 'chair' | null> = computed(() => {
    if (this.myRoleLoading()) {
      return null;
    }
    if (this.myRole() === null) {
      return 'visitor';
    }
    if (this.isChairOrAbove()) {
      return 'chair';
    }
    return 'member';
  });

  public canJoin: Signal<boolean> = computed(() => {
    const mode = this.committee().join_mode;
    return this.isVisitor() && mode === 'open' && !this.hasPendingInvite();
  });

  public showInviteOnlyNotice: Signal<boolean> = computed(() => {
    const mode = this.committee().join_mode;
    return this.isVisitor() && (mode === 'invite_only' || !mode) && !this.hasPendingInvite();
  });

  public joinButtonLabel: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'open') return 'Join Group';
    if (mode === 'application') return 'Request to Join';
    return 'Contact Admin';
  });

  /** Icon for the CTA button — matches the header button icon */
  public joinButtonIcon: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'open') return 'fa-light fa-user-plus';
    if (mode === 'application') return 'fa-light fa-paper-plane';
    return 'fa-light fa-envelope';
  });

  /** Large illustrative icon above the CTA card title */
  public joinCtaIcon: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'application') return 'fa-light fa-paper-plane';
    return 'fa-light fa-users';
  });

  public joinBannerText: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    const name = this.committee().name;
    if (mode === 'open') return `Interested in ${name}? Click Join Group above to become a member.`;
    if (mode === 'application') return `Interested in ${name}? Click Request to Join above to submit your application for admin review.`;
    return `${name} is closed to new members. Contact a group admin for access.`;
  });

  public joinCtaTitle: Signal<string> = computed(() => `Interested in ${this.committee().name}?`);

  public joinCtaDescription: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'application') return 'Submit a request and a group admin will review your application.';
    return 'Participate in meetings, vote on proposals, access resources, and collaborate with the group.';
  });

  public inviteOnlyTitle: Signal<string> = computed(() => 'Membership is by invitation only');

  public inviteOnlyDescription: Signal<string> = computed(() => {
    const name = this.committee().name;
    return `${name} is invite only. A group admin must send you an invitation before you can join.`;
  });

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
  public onJoinClick(): void {
    this.joinRequested.emit();
  }

  public navigateToTab(tab: string): void {
    this.tabNavigated.emit(tab);
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

  private initMeetings(): Signal<Meeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.upcomingMeetingsLoading.set(true);
          return this.meetingService.getUpcomingMeetingsByCommittee(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.upcomingMeetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
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

  private initDocuments(): Signal<CommitteeDocument[]> {
    // Documents only seed the activity feed, which the template never renders for a visitor
    // (behind !isVisitor()) — skip the fetch rather than issue a GET nothing will display.
    // Reactive over myRoleLoading/isVisitor (not just committee) so the fetch fires once the role
    // actually resolves, and documentsLoading is explicitly cleared on the skip path so
    // activityFeedLoading() can't get stuck true for a visitor whose role never triggers a fetch.
    return toSignal(
      combineLatest([toObservable(this.committee), toObservable(this.myRoleLoading), toObservable(this.isVisitor)]).pipe(
        filter(([c]) => !!c?.uid),
        switchMap(([c, roleLoading, visitor]) => {
          if (roleLoading || visitor) {
            this.documentsLoading.set(false);
            return of<CommitteeDocument[]>([]);
          }
          this.documentsLoading.set(true);
          // No catchError here: CommitteeService.getCommitteeDocuments already falls back to
          // of([]) on failure, so a component-level handler would never fire.
          return this.committeeService.getCommitteeDocuments(c.uid).pipe(finalize(() => this.documentsLoading.set(false)));
        })
      ),
      { initialValue: [] }
    );
  }

  private initActivityItems(): Signal<ActivityFeedItem[]> {
    return computed(() => {
      // Per-source cap before merging, so one noisy source can't crowd out the rest.
      const perSourceLimit = 5;

      // Upcoming meetings are intentionally excluded — they're future-dated, already covered by the
      // "Next Meeting" card, and would otherwise dominate a feed labelled "Recent Activity".
      const pastMeetingItems: ActivityFeedItem[] = [...this.pastMeetings()]
        .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
        .slice(0, perSourceLimit)
        .map((m) => ({
          type: 'past_meeting',
          key: `past_meeting-${m.meeting_and_occurrence_id ?? m.id}`,
          label: `Meeting held: ${m.title}`,
          timestamp: m.start_time ?? '',
          icon: 'fa-light fa-clock-rotate-left',
          tab: 'meetings:past',
        }));

      // Upstream Vote schema (lfx-v2-voting-service openapi3.yaml) marks `status` required with a
      // fixed lowercase enum (disabled/active/ended) — no case normalization needed here.
      const voteItems: ActivityFeedItem[] = [...this.votes()]
        .sort((a, b) => (b.last_modified_time ?? b.creation_time ?? '').localeCompare(a.last_modified_time ?? a.creation_time ?? ''))
        .slice(0, perSourceLimit)
        .map((v) => ({
          type: 'vote' as const,
          key: `vote-${v.uid}`,
          label: `Vote ${POLL_STATUS_LABELS[v.status]}: ${v.name}`,
          timestamp: v.last_modified_time ?? v.creation_time ?? '',
          icon: 'fa-light fa-check-to-slot',
          tab: 'votes',
        }));

      const surveyItems: ActivityFeedItem[] = [...this.surveys()]
        .sort((a, b) => (b.last_modified_at ?? b.created_at ?? '').localeCompare(a.last_modified_at ?? a.created_at ?? ''))
        .slice(0, perSourceLimit)
        .map((s) => {
          const displayStatus = getSurveyDisplayStatus(s);
          return {
            type: 'survey' as const,
            key: `survey-${s.uid}`,
            label: `Survey ${SURVEY_STATUS_LABELS[displayStatus] ?? displayStatus}: ${s.survey_title}`,
            timestamp: s.last_modified_at ?? s.created_at ?? '',
            icon: 'fa-light fa-chart-simple',
            tab: 'surveys',
          };
        });

      // CommitteeDocument.type is 'file' | 'link' | 'folder' — differentiate icon/label so a
      // folder or link doesn't misrepresent itself as a file in the feed.
      // No shared label map exists for CommitteeDocumentType (DOCUMENT_SOURCE_TAGS is keyed by the
      // unrelated CommitteeDocumentSource enum), but the icon is reused from the Documents tab's
      // own helper so the two surfaces can't drift.
      const documentTypeLabel: Record<CommitteeDocumentType, string> = { file: 'Document', link: 'Link', folder: 'Folder' };
      const documentItems: ActivityFeedItem[] = [...this.documents()]
        .sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''))
        .slice(0, perSourceLimit)
        .map((d) => ({
          type: 'document' as const,
          key: `document-${d.uid}`,
          label: `${documentTypeLabel[d.type]}: ${d.name}`,
          timestamp: d.updated_at ?? d.created_at ?? '',
          icon: getDocumentTypeIconClass(d.type),
          tab: 'documents',
        }));

      // Final row count shown in the feed after merge-sort.
      const feedLimit = 8;

      return [...pastMeetingItems, ...voteItems, ...surveyItems, ...documentItems].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, feedLimit);
    });
  }
}
