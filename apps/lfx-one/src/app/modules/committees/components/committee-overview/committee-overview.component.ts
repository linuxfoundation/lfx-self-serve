// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { TagComponent } from '@components/tag/tag.component';
import { DashboardMeetingCardComponent } from '../../../dashboards/components/dashboard-meeting-card/dashboard-meeting-card.component';
import { VoteResultsDrawerComponent } from '../../../votes/components/vote-results-drawer/vote-results-drawer.component';

import { Committee, CommitteeMember, Meeting, PastMeeting, PendingActionItem, Survey, Vote } from '@lfx-one/shared/interfaces';
import { CommitteeMemberRole, PollStatus } from '@lfx-one/shared/enums';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { VoteService } from '@services/vote.service';
import { SurveyService } from '@services/survey.service';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, forkJoin, of, switchMap } from 'rxjs';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';

@Component({
  selector: 'lfx-committee-overview',
  imports: [
    CardComponent,
    ReactiveFormsModule,
    ButtonComponent,
    Dialog,
    DashboardMeetingCardComponent,
    MessageComponent,
    NgClass,
    SkeletonModule,
    SelectComponent,
    TagComponent,
    VoteResultsDrawerComponent,
  ],
  templateUrl: './committee-overview.component.html',
  styleUrl: './committee-overview.component.scss',
})
export class CommitteeOverviewComponent {
  // Injections
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly voteService = inject(VoteService);
  private readonly surveyService = inject(SurveyService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public committee = input.required<Committee>();
  public members = input<CommitteeMember[]>([]);
  public membersLoading = input<boolean>(true);
  public canEdit = input<boolean>(false);
  public myRole = input<string | null>(null);
  public myMemberUid = input<string | null>(null);
  public myRoleLoading = input<boolean>(true);

  // Outputs
  public readonly committeeUpdated = output<void>();
  public readonly joinRequested = output<void>();
  public readonly tabNavigated = output<string>();

  // Chairs modal state
  public showChairsModal = signal(false);
  public savingChairs = signal(false);
  public chairsForm = new FormGroup({
    chairUid: new FormControl<string | null>(null),
    viceChairUid: new FormControl<string | null>(null),
  });

  // Vote drawer state
  public voteDrawerVisible = signal(false);
  public selectedVoteId = signal<string | null>(null);
  public selectedVote = signal<Vote | null>(null);

  // Loading states for stats
  public meetingsLoading = signal(true);
  public votesLoading = signal(true);
  public surveysLoading = signal(true);

  // Loading states for meeting sections
  public upcomingMeetingsLoading = signal(true);
  public pastMeetingsLoading = signal(true);

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

  // Committee-scoped data fetches
  public meetingsCount: Signal<number> = this.initMeetingsCount();
  public meetings: Signal<Meeting[]> = this.initMeetings();
  public pastMeetings: Signal<PastMeeting[]> = this.initPastMeetings();
  public votes: Signal<Vote[]> = this.initVotes();
  public surveys: Signal<Survey[]> = this.initSurveys();

  // Computed stats from fetched data
  public activeVotesCount: Signal<number> = computed(() => this.votes().filter((v) => v.status === PollStatus.ACTIVE).length);

  public openSurveysCount: Signal<number> = computed(() => this.surveys().filter((s) => s.survey_status === 'open' || s.survey_status === 'sent').length);

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

  public canJoin: Signal<boolean> = computed(() => this.isVisitor() && this.committee().join_mode !== 'closed');

  public joinButtonLabel: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'open') return 'Join Group';
    if (mode === 'application') return 'Request to Join';
    if (mode === 'invite_only') return 'Request Access';
    return 'Contact Admin';
  });

  /** Icon for the CTA button — matches the header button icon */
  public joinButtonIcon: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'open') return 'fa-light fa-user-plus';
    if (mode === 'invite_only' || mode === 'application') return 'fa-light fa-paper-plane';
    return 'fa-light fa-envelope';
  });

  /** Large illustrative icon above the CTA card title */
  public joinCtaIcon: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'application' || mode === 'invite_only') return 'fa-light fa-paper-plane';
    return 'fa-light fa-users';
  });

  public joinBannerText: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    const name = this.committee().name;
    if (mode === 'open') return `Interested in ${name}? Click Join Group above to become a member.`;
    if (mode === 'application') return `Interested in ${name}? Click Request to Join above to submit your application for admin review.`;
    if (mode === 'invite_only') return `Interested in ${name}? Click Request Access above to submit a membership request for admin review.`;
    return `${name} is closed to new members. Contact a group admin for access.`;
  });

  public joinCtaTitle: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    const name = this.committee().name;
    if (mode === 'application') return `Apply to join ${name}`;
    if (mode === 'invite_only') return `Request access to ${name}`;
    return `Join ${name}`;
  });

  public joinCtaDescription: Signal<string> = computed(() => {
    const mode = this.committee().join_mode;
    if (mode === 'application') return 'Submit a request and a group admin will review your application.';
    if (mode === 'invite_only') return 'Submit a request and a group admin will review and send you an invitation if approved.';
    return 'Participate in meetings, vote on proposals, access resources, and collaborate with the group.';
  });

  public pendingVotes: Signal<Vote[]> = computed(() => this.votes().filter((v) => v.status === PollStatus.ACTIVE));
  public pendingSurveys: Signal<Survey[]> = computed(() => this.surveys().filter((s) => s.survey_status === 'open' || s.survey_status === 'sent'));
  public hasPendingActions: Signal<boolean> = computed(() => this.pendingVotes().length > 0 || this.pendingSurveys().length > 0);

  public pendingActionItems: Signal<PendingActionItem[]> = this.initPendingActionItems();
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

  // Action methods
  public onJoinClick(): void {
    this.joinRequested.emit();
  }

  public navigateToTab(tab: string): void {
    this.tabNavigated.emit(tab);
  }

  public handlePendingActionClick(item: PendingActionItem): void {
    if (item.type === 'Cast Vote') {
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
    this.chairsForm.patchValue({
      chairUid: currentChair?.uid || null,
      viceChairUid: currentViceChair?.uid || null,
    });
    this.showChairsModal.set(true);
  }

  public cancelEditChairs(): void {
    this.showChairsModal.set(false);
  }

  public saveChairs(): void {
    this.savingChairs.set(true);
    const committeeId = this.committee().uid;
    const currentChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.CHAIR);
    const currentViceChair = this.chairs().find((c) => c.role?.name === CommitteeMemberRole.VICE_CHAIR);
    const newChairUid = this.chairsForm.get('chairUid')?.value;
    const newViceChairUid = this.chairsForm.get('viceChairUid')?.value;

    if (newChairUid && newChairUid === newViceChairUid) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Chair and Vice Chair must be different members' });
      this.savingChairs.set(false);
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
      this.showChairsModal.set(false);
      this.savingChairs.set(false);
      return;
    }

    // Execute removals first, then assignments
    (removals.length > 0 ? forkJoin(removals) : of([]))
      .pipe(
        switchMap(() => (assignments.length > 0 ? forkJoin(assignments) : of([]))),
        finalize(() => this.savingChairs.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Chairs updated' });
          this.showChairsModal.set(false);
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
          return this.meetingService.getPastMeetingsByCommittee(c.uid, 20, 'updated_desc').pipe(
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
          return this.voteService.getVotesByCommittee(c.uid, 'updated_at.desc', 50).pipe(
            catchError(() => of([])),
            finalize(() => this.votesLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initPendingActionItems(): Signal<PendingActionItem[]> {
    return computed(() => {
      const voteItems: PendingActionItem[] = this.pendingVotes().map((vote) => ({
        type: 'Cast Vote',
        badge: this.committee().name,
        text: vote.name,
        icon: 'fa-light fa-check-to-slot',
        severity: 'warn' as const,
        buttonText: 'Review and Vote',
        buttonLink: vote.uid,
        date: vote.end_time
          ? `Deadline: ${new Date(vote.end_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : undefined,
      }));
      const surveyItems: PendingActionItem[] = this.pendingSurveys().map((survey) => ({
        type: 'Submit Feedback',
        badge: this.committee().name,
        text: survey.survey_title,
        icon: 'fa-light fa-chart-simple',
        severity: 'warn' as const,
        buttonText: 'Submit Survey',
        date: survey.survey_cutoff_date
          ? `Deadline: ${new Date(survey.survey_cutoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : undefined,
      }));
      return [...voteItems, ...surveyItems];
    });
  }

  private initPendingActionsViewAllTab(): Signal<'votes' | 'surveys'> {
    return computed(() => {
      const overflow = this.pendingActionItems().slice(2);
      const hasVotes = overflow.some((item) => item.type === 'Cast Vote');
      return hasVotes ? 'votes' : 'surveys';
    });
  }

  private initSurveys(): Signal<Survey[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.surveysLoading.set(true);
          return this.surveyService.getSurveysByCommittee(c.uid, 50).pipe(
            catchError(() => of([])),
            finalize(() => this.surveysLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
