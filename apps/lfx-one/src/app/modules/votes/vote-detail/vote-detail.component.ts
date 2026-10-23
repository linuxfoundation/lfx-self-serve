// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, REQUEST_CONTEXT, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TagComponent } from '@components/tag/tag.component';
import { VOTE_DETAIL_DEFAULT_TAB, VOTE_DETAIL_TABS, VOTE_DETAIL_VALID_TABS } from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, PollStatus } from '@lfx-one/shared/enums';
import {
  MyVoteResponse,
  PollCommentResponse,
  PollCommentResult,
  RankedQuestionView,
  ServerRequestContext,
  StatCardItem,
  Vote,
  VoteDetailState,
  VoteDetailTab,
  VoteDetailTabOption,
  VoteParticipationStats,
  VoteResultsQuestion,
  VoteResultsResponse,
  VoterResultsState,
} from '@lfx-one/shared/interfaces';
import {
  buildRankedQuestionViews,
  buildVoteResultsQuestions,
  canVoterFetchVoteResults,
  computeVoteParticipationStats,
  isRankedPollType,
  mergeCommentResults,
  normalizePollStatus,
  resolveVoterResultsState,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { resolveVoteCanManage } from '@shared/utils/write-access.util';
import { DialogService } from 'primeng/dynamicdialog';
import { PaginatorState } from 'primeng/paginator';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, startWith, switchMap, tap, throwError } from 'rxjs';

import { NotFoundComponent } from '../../not-found/not-found.component';
import { VoteAbstainResultComponent } from '../components/vote-abstain-result/vote-abstain-result.component';
import { VoteCastDrawerComponent } from '../components/vote-cast-drawer/vote-cast-drawer.component';
import { VoteCommentResultsComponent } from '../components/vote-comment-results/vote-comment-results.component';
import { VoteDetailFactsComponent } from '../components/vote-detail-facts/vote-detail-facts.component';
import { VoteDetailHeaderComponent } from '../components/vote-detail-header/vote-detail-header.component';
import { VoteOptionResultsComponent } from '../components/vote-option-results/vote-option-results.component';
import { VoteParticipationCardComponent } from '../components/vote-participation-card/vote-participation-card.component';
import { VoteRankedQuestionResultsComponent } from '../components/vote-ranked-question-results/vote-ranked-question-results.component';
import { VoteReminderDialogComponent } from '../components/vote-reminder-dialog/vote-reminder-dialog.component';

/**
 * Vote detail page (#3913). Route: /votes/:id, behind `vote-detail-page-enabled` (`voteDetailPageGuard`); with the
 * flag off the same URL renders `VotePermalinkComponent`.
 *
 * The manager view follows write access on the vote (project writer, then committee writer — `resolveVoteCanManage`),
 * never the lens. Voters see only what the results drawer shows them today: their own response, and totals and comments
 * after the vote closes (the shared `canVoterFetchVoteResults` / `resolveVoterResultsState` rules). A vote the user can't
 * view (400/403/404) renders the shared not-found page in place with HTTP 404 under SSR, so a missing vote and a
 * forbidden one look identical; any other failure is a retry card. SSR stops after the vote fetch and paints the same
 * skeleton as the permalink; everything else resolves in the browser. An invited voter still awaiting a ballot on an
 * active vote gets the cast drawer once on load, as the reminder email intends.
 */
@Component({
  selector: 'lfx-vote-detail',
  imports: [
    NgClass,
    NgTemplateOutlet,
    ButtonComponent,
    CardComponent,
    NotFoundComponent,
    SkeletonModule,
    StatCardGridComponent,
    TagComponent,
    VoteAbstainResultComponent,
    VoteCastDrawerComponent,
    VoteCommentResultsComponent,
    VoteDetailFactsComponent,
    VoteDetailHeaderComponent,
    VoteOptionResultsComponent,
    VoteParticipationCardComponent,
    VoteRankedQuestionResultsComponent,
  ],
  providers: [DialogService],
  templateUrl: './vote-detail.component.html',
})
export class VoteDetailComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly voteService = inject(VoteService);
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  /** Re-runs the vote load: `retry` shows the skeleton again, `refresh` (after a ballot) reloads in place. */
  private readonly reload$ = new BehaviorSubject<'retry' | 'refresh'>('retry');

  // === Writable Signals ===
  protected readonly castDrawerVisible = signal<boolean>(false);
  protected readonly myResponseLoading = signal<boolean>(false);
  /** True when the most recent my-response call failed (non-404) — a transient failure must not collapse into not-participant. */
  protected readonly myResponseError = signal<boolean>(false);
  protected readonly loadingVoteResults = signal<boolean>(false);
  protected readonly voteResultsError = signal<boolean>(false);
  /** Bumped after a ballot is submitted so my-response and results reload. */
  private readonly refreshTick = signal<number>(0);
  /** The vote a ballot was cast on from this page — it reads as submitted before the refreshed (indexed) response catches up. */
  private readonly submittedBallotFor = signal<string | null>(null);
  /** Comment paginator state owned here so a page survives switching tabs (bound two-way into lfx-vote-comment-results). */
  protected readonly commentPaginatorState = signal<Map<string, PaginatorState>>(new Map());

  // === Route Params (toSignal) ===
  protected readonly voteId: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('id'))), { initialValue: null });
  private readonly requestedTab: Signal<VoteDetailTab> = this.initRequestedTab();

  // === Data Signals (Complex — init via private functions) ===
  /** Single load-state stream: loading, not-found, transient error and the loaded vote derive from one emission. */
  protected readonly state: Signal<VoteDetailState> = this.initState();
  protected readonly vote: Signal<Vote | null> = computed(() => this.state().vote);
  /** The viewer's vote_response row; null+loaded means never invited, null+loading means in flight. */
  protected readonly myResponse: Signal<MyVoteResponse | null> = this.initMyResponse();
  /** Write access on the vote; null while the check is running. */
  protected readonly canManage: Signal<boolean | null> = this.initCanManage();
  protected readonly audience: Signal<'voter' | 'creator'> = computed(() => (this.canManage() ? 'creator' : 'voter'));
  /**
   * The body waits for both access inputs, so a manager never flashes the voter panel (or the reverse). A post-ballot
   * refresh keeps the previous response until the new one lands, so only the first load shows the skeleton — but only a
   * response for this same vote, never one left over from the previously opened vote.
   */
  protected readonly accessLoading: Signal<boolean> = computed(
    () => this.canManage() === null || (this.myResponseLoading() && this.myResponse()?.vote_uid !== this.vote()?.uid)
  );
  protected readonly voteResults: Signal<VoteResultsResponse | null> = this.initVoteResults();
  /** Settled, successful results — participation totals wait for these, since `computeVoteParticipationStats(null)` reads as zero. */
  protected readonly hasLoadedResults: Signal<boolean> = computed(() => !!this.voteResults() && !this.loadingVoteResults() && !this.voteResultsError());

  // === Computed Signals ===
  protected readonly tabs: Signal<readonly VoteDetailTabOption[]> = this.initTabs();
  protected readonly activeTab: Signal<VoteDetailTab> = this.initActiveTab();
  private readonly hasSubmittedBallot: Signal<boolean> = computed(() => !!this.vote() && this.submittedBallotFor() === this.vote()?.uid);
  protected readonly voterState: Signal<VoterResultsState> = this.initVoterState();
  /** Results (and comments) render for a manager, or for a voter once the vote closed; every other voter gets a state panel. */
  protected readonly showsResults: Signal<boolean> = computed(
    () => this.audience() === 'creator' || (this.voterState() === 'closed' && !this.myResponseError())
  );
  protected readonly canCastVote: Signal<boolean> = computed(() => !this.hasSubmittedBallot() && this.isAwaitingBallot(this.vote(), this.myResponse()));
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote()?.status) === PollStatus.ACTIVE);
  /** Formally ended. A draft (`disabled`) is neither active nor ended, so "closed" copy keys on this, never on `!isActive`. */
  protected readonly isEnded: Signal<boolean> = computed(() => normalizePollStatus(this.vote()?.status) === PollStatus.ENDED);
  /** Non-ranked poll types (generic, majority, and anything unrecognized) render the plurality layout — see isRankedPollType. */
  protected readonly isGenericPoll: Signal<boolean> = computed(() => !isRankedPollType(this.vote()?.poll_type));
  protected readonly participationStats: Signal<VoteParticipationStats> = computed(() => computeVoteParticipationStats(this.voteResults()));
  /** Abstain UI follows the data, not just the flag (same rule as the results drawer). */
  protected readonly showAbstain: Signal<boolean> = computed(
    () => !this.voteResultsError() && (!!this.vote()?.allow_abstain || this.participationStats().abstainedVoters > 0)
  );
  protected readonly isVoteClosed: Signal<boolean> = this.initIsVoteClosed();
  /** Overview results tag — a draft reads "Not open yet", never "Voting in progress". */
  protected readonly resultsStatusTag: Signal<{ value: string; severity: 'success' | 'secondary' }> = this.initResultsStatusTag();
  protected readonly questionsWithResults: Signal<VoteResultsQuestion[]> = computed(() => buildVoteResultsQuestions(this.voteResults(), this.isVoteClosed()));
  protected readonly rankedQuestions: Signal<RankedQuestionView[]> = computed(() => buildRankedQuestionViews(this.voteResults()));
  protected readonly commentResults: Signal<PollCommentResult[]> = this.initCommentResults();
  protected readonly commentCount: Signal<number> = computed(() =>
    this.commentResults().reduce((sum, result) => sum + (result.total_responses ?? result.responses.length), 0)
  );
  protected readonly firstComment: Signal<PollCommentResponse | null> = computed(
    () => this.commentResults().find((result) => result.responses.length > 0)?.responses[0] ?? null
  );
  protected readonly hasZeroVotes: Signal<boolean> = this.initHasZeroVotes();
  /** Generic results render as live tallies for an open vote's manager, final otherwise; voters only ever see final results. */
  protected readonly optionVariant: Signal<'live' | 'final' | 'voter-final'> = this.initOptionVariant();
  protected readonly notVotedCount: Signal<number> = computed(() => {
    const stats = this.participationStats();
    return Math.max(stats.eligibleVoters - stats.totalResponses, 0);
  });
  protected readonly summaryCards: Signal<StatCardItem[]> = this.initSummaryCards();

  public constructor() {
    this.initCastDrawerAutoOpen();
  }

  // === Protected Methods ===
  protected retry(): void {
    this.reload$.next('retry');
  }

  protected switchTab(tab: VoteDetailTab): void {
    if (this.activeTab() === tab) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === VOTE_DETAIL_DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onCastVote(): void {
    this.castDrawerVisible.set(true);
  }

  protected onVoteSubmitted(): void {
    this.submittedBallotFor.set(this.vote()?.uid ?? null);
    this.refreshTick.update((tick) => tick + 1);
    this.reload$.next('refresh');
  }

  protected onSendReminder(): void {
    const vote = this.vote();
    if (!vote) return;
    this.dialogService.open(VoteReminderDialogComponent, {
      header: 'Send vote reminder',
      width: 'min(960px, 96vw)',
      modal: true,
      closable: true,
      draggable: false,
      data: { vote },
    });
  }

  protected onViewResults(): void {
    this.switchTab('results');
  }

  protected goBack(): void {
    void this.router.navigate(['/votes']);
  }

  // === Private Initializers ===
  private initRequestedTab(): Signal<VoteDetailTab> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => {
          const raw = params.get('tab');
          return raw && VOTE_DETAIL_VALID_TABS.has(raw) ? (raw as VoteDetailTab) : VOTE_DETAIL_DEFAULT_TAB;
        })
      ),
      { initialValue: VOTE_DETAIL_DEFAULT_TAB }
    );
  }

  private initState(): Signal<VoteDetailState> {
    const loadingState: VoteDetailState = { loading: true, notFound: false, error: false, vote: null };
    const notFoundState: VoteDetailState = { loading: false, notFound: true, error: false, vote: null };
    const errorState: VoteDetailState = { loading: false, notFound: false, error: true, vote: null };
    // The state the page last showed a vote in — a `refresh` for the same vote reloads in place instead of flashing the skeleton.
    let lastLoaded: VoteDetailState | null = null;

    return toSignal(
      combineLatest([toObservable(this.voteId), this.reload$]).pipe(
        filter((args): args is [string, 'retry' | 'refresh'] => !!args[0]),
        switchMap(([id, reason]) => {
          const inPlace = reason === 'refresh' && lastLoaded?.vote?.uid === id;
          const load$ = this.voteService.fetchVote(id, { skipCache: inPlace }).pipe(
            // Only the vote fetch decides not-found: 400/403/404 means "no such vote, or not yours to see" — never
            // confirm which. Anything else (gateway 5xx, network) is transient and must not masquerade as a 404.
            catchError((err) => (this.isNotFoundStatus(err?.status) ? of(null) : throwError(() => err))),
            map((vote): VoteDetailState => {
              if (!vote) return notFoundState;
              // SSR only needs the vote fetch to decide the HTTP status; the page itself resolves in the browser.
              if (isPlatformServer(this.platformId)) return loadingState;
              return { loading: false, notFound: false, error: false, vote };
            }),
            catchError((err) => {
              console.error('Failed to load vote for detail page', err);
              // A failed in-place refresh keeps the page it already shows: the ballot was recorded, only the reload failed.
              return of(inPlace && lastLoaded ? lastLoaded : errorState);
            }),
            tap((state) => {
              lastLoaded = state.vote ? state : null;
              // Real HTTP 404 during SSR for the not-found branch only; the error state intentionally stays HTTP 200.
              if (state.notFound && isPlatformServer(this.platformId) && this.reqContext) {
                this.reqContext.notFound = true;
              }
            })
          );
          return inPlace ? load$ : load$.pipe(startWith(loadingState));
        })
      ),
      { initialValue: loadingState }
    );
  }

  /** Keyed on the loaded vote uid (null on the server, which never loads one) and the refresh tick. */
  private initMyResponse(): Signal<MyVoteResponse | null> {
    const key = computed(() => ({ uid: this.vote()?.uid ?? null, tick: this.refreshTick() }));
    return toSignal(
      toObservable(key).pipe(
        distinctUntilChanged((a, b) => a.uid === b.uid && a.tick === b.tick),
        switchMap(({ uid }) => {
          if (!uid) {
            this.myResponseLoading.set(false);
            this.myResponseError.set(false);
            return of(null);
          }
          this.myResponseLoading.set(true);
          this.myResponseError.set(false);
          return this.voteService.getMyVoteResponse(uid).pipe(
            // The service maps 404 to null; anything reaching this catch is a real failure — surface an error state.
            catchError(() => {
              this.myResponseError.set(true);
              return of(null);
            }),
            finalize(() => this.myResponseLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initCanManage(): Signal<boolean | null> {
    const voteUid = computed(() => this.vote()?.uid ?? null);
    return toSignal(
      toObservable(voteUid).pipe(
        switchMap((uid) => {
          const vote = this.vote();
          if (!uid || !vote) return of(null);
          return resolveVoteCanManage(
            vote,
            (slugOrUid) => this.projectService.getProjectStrict(slugOrUid),
            (committeeUid) => this.committeeService.fetchCommittee(committeeUid)
          ).pipe(startWith(null));
        })
      ),
      { initialValue: null }
    );
  }

  /** A ballot cast from this page reads as submitted even while the refreshed response is in flight or still lags behind. */
  private initVoterState(): Signal<VoterResultsState> {
    return computed(() => {
      const state = resolveVoterResultsState(this.vote(), this.myResponse(), this.myResponseLoading(), this.myResponseError(), this.vote()?.response_status);
      return state === 'not_voted' && this.hasSubmittedBallot() ? 'submitted' : state;
    });
  }

  /** Managers always load results; voters only after close with a settled, matching, non-removed response (same gate as the drawer). */
  private initVoteResults(): Signal<VoteResultsResponse | null> {
    const key = computed(() => {
      const id = this.voteId();
      const canManage = this.canManage();
      const tick = this.refreshTick();
      if (!id || canManage === null) return null;
      if (canManage) return { id, tick };
      const canFetch = canVoterFetchVoteResults(id, this.vote(), this.myResponse(), this.myResponseLoading(), this.myResponseError());
      return canFetch ? { id, tick } : null;
    });

    return toSignal(
      toObservable(key).pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.tick === b?.tick),
        switchMap((resultsKey) => {
          if (!resultsKey) {
            this.loadingVoteResults.set(false);
            this.voteResultsError.set(false);
            return of(null);
          }
          this.loadingVoteResults.set(true);
          this.voteResultsError.set(false);
          return this.voteService.getVoteResults(resultsKey.id).pipe(
            catchError(() => {
              this.voteResultsError.set(true);
              return of(null);
            }),
            finalize(() => this.loadingVoteResults.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  /** The Comments tab exists only when the vote asks for comments. */
  private initTabs(): Signal<readonly VoteDetailTabOption[]> {
    return computed(() => {
      const hasPrompts = (this.vote()?.poll_comment_prompts?.length ?? 0) > 0;
      return VOTE_DETAIL_TABS.filter((tab) => tab.key !== 'comments' || hasPrompts);
    });
  }

  /** A `?tab=` the vote doesn't offer (Comments on a vote without prompts) falls back to the default tab. */
  private initActiveTab(): Signal<VoteDetailTab> {
    return computed(() => {
      const requested = this.requestedTab();
      return this.tabs().some((tab) => tab.key === requested) ? requested : VOTE_DETAIL_DEFAULT_TAB;
    });
  }

  private initIsVoteClosed(): Signal<boolean> {
    return computed(() => {
      if (normalizePollStatus(this.vote()?.status) === PollStatus.ENDED) return true;
      // Treat 100% participation as finalized even if the vote hasn't formally ended (same rule as the drawer).
      const stats = this.participationStats();
      return stats.eligibleVoters > 0 && stats.participationRate >= 100;
    });
  }

  private initResultsStatusTag(): Signal<{ value: string; severity: 'success' | 'secondary' }> {
    return computed(() => {
      if (this.isVoteClosed()) return { value: 'Final results', severity: 'secondary' };
      if (this.isActive()) return { value: 'Voting in progress', severity: 'success' };
      return { value: 'Not open yet', severity: 'secondary' };
    });
  }

  /** A failed results fetch suppresses comments entirely, so a load failure never reads as "no responses yet". */
  private initCommentResults(): Signal<PollCommentResult[]> {
    return computed(() => {
      if (this.voteResultsError()) return [];
      return mergeCommentResults(this.voteResults()?.comment_results ?? [], this.vote()?.poll_comment_prompts);
    });
  }

  private initHasZeroVotes(): Signal<boolean> {
    return computed(() => {
      // Abstentions are cast responses upstream but excluded from choice tallies — they must not read as "no votes".
      if (this.participationStats().abstainedVoters > 0) return false;
      if (!this.isGenericPoll()) return this.rankedQuestions().length === 0;
      const questions = this.questionsWithResults();
      return !questions.length || questions.every((question) => question.totalVotes === 0);
    });
  }

  private initOptionVariant(): Signal<'live' | 'final' | 'voter-final'> {
    return computed(() => {
      if (this.audience() === 'voter') return 'voter-final';
      return this.isVoteClosed() ? 'final' : 'live';
    });
  }

  /** Manager-only summary — voters get no stats, matching the results drawer. */
  private initSummaryCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const stats = this.participationStats();
      const loaded = !!this.voteResults();
      const dash = '—';
      const abstained = stats.abstainedVoters;
      return [
        {
          value: loaded ? stats.totalResponses : dash,
          label: 'Responses',
          subLine: loaded ? this.responsesSubLine(stats.eligibleVoters, abstained) : undefined,
          icon: 'fa-light fa-users',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: loaded ? `${stats.participationRate}%` : dash,
          label: 'Participation',
          subLine: loaded ? `${stats.totalResponses} of ${stats.eligibleVoters} invited voters responded` : undefined,
          icon: 'fa-light fa-chart-simple',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
        },
        {
          value: loaded ? this.commentCount() : dash,
          label: 'Comments',
          subLine: (this.vote()?.poll_comment_prompts?.length ?? 0) > 0 ? 'Optional written responses' : 'Comments not enabled',
          icon: 'fa-light fa-comments',
          iconContainerClass: 'bg-violet-100 text-violet-600',
        },
        {
          value: loaded ? this.notVotedCount() : dash,
          ...this.notVotedCardText(),
          icon: 'fa-light fa-clock',
          iconContainerClass: 'bg-amber-100 text-amber-600',
        },
      ];
    });
  }

  /** Opens the cast drawer once per loaded vote for an invited voter still awaiting a ballot — the reminder email's intent. */
  private initCastDrawerAutoOpen(): void {
    let autoOpenedFor: string | null = null;
    const awaitingVoteUid = computed(() => (this.canCastVote() ? (this.vote()?.uid ?? null) : null));
    toObservable(awaitingVoteUid)
      .pipe(
        filter((uid): uid is string => !!uid && uid !== autoOpenedFor),
        takeUntilDestroyed()
      )
      .subscribe((uid) => {
        autoOpenedFor = uid;
        this.castDrawerVisible.set(true);
      });
  }

  // === Private Helpers ===
  /** Open, ended or draft — a draft hasn't opened for voting, so it reads neither as reminder-ready nor as closed. */
  private notVotedCardText(): Pick<StatCardItem, 'label' | 'subLine'> {
    if (this.isActive()) return { label: 'Not voted yet', subLine: 'Eligible for a reminder' };
    if (this.isEnded()) return { label: 'Did not vote', subLine: 'Voting is closed' };
    return { label: 'Not voted yet', subLine: 'Voting not open yet' };
  }

  private responsesSubLine(eligibleVoters: number, abstained: number): string {
    const base = `of ${eligibleVoters} invited`;
    if (abstained === 0) return base;
    return `${base} · ${abstained} ${abstained === 1 ? 'abstention' : 'abstentions'}`;
  }

  private isAwaitingBallot(vote: Vote | null, myResponse: MyVoteResponse | null): boolean {
    return (
      !!vote &&
      normalizePollStatus(vote.status) === PollStatus.ACTIVE &&
      myResponse?.vote_uid === vote.uid &&
      myResponse.vote_status === IndexedVoteResponseStatus.AWAITING_RESPONSE &&
      !myResponse.voter_removed
    );
  }

  private isNotFoundStatus(status: unknown): boolean {
    return typeof status === 'number' && [400, 403, 404].includes(status);
  }
}
