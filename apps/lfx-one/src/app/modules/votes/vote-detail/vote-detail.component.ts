// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, isPlatformServer, NgTemplateOutlet } from '@angular/common';
import { Component, computed, ElementRef, inject, PLATFORM_ID, REQUEST_CONTEXT, signal, Signal, viewChild } from '@angular/core';
import { VoteDescriptionPipe } from '../pipes/vote-description.pipe';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ShareSlideComponent } from '@components/share-slide/share-slide.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  VOTE_DETAIL_DEFAULT_TAB,
  VOTE_DETAIL_SUMMARY_CARD_ACTIONS,
  VOTE_DETAIL_TABS,
  VOTE_DETAIL_VALID_TABS,
  VOTE_VOTERS_ABSTAINED_CHOICE_KEY,
  VOTE_IMPERSONATION_PRIVATE_NOTICE,
  VOTE_IMPERSONATION_READ_ONLY_NOTICE,
  VOTE_OVERVIEW_COMMENT_PREVIEW_LIMIT,
} from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, PollStatus } from '@lfx-one/shared/enums';
import {
  CommentResponseView,
  MyVoteBallot,
  MyVoteResponse,
  PollCommentPrompt,
  PollCommentResult,
  RankedQuestionView,
  ServerRequestContext,
  StatCardItem,
  Vote,
  VoteCommentAnonymityReason,
  VoteDetailState,
  VoteDetailSummaryCardAction,
  VoteDetailTab,
  VoteDetailTabOption,
  VoteParticipationStats,
  VoteResultsQuestion,
  VoteResultsResponse,
  VoteResultsSummaryLine,
  VoterResultsState,
} from '@lfx-one/shared/interfaces';
import {
  buildRankedQuestionViews,
  buildVoteResultsQuestions,
  buildVoteResultsSummary,
  canVoterFetchVoteResults,
  computeVoteParticipationStats,
  getRecentCommentResponses,
  isRankedPollType,
  mergeCommentResults,
  normalizePollStatus,
  resolveVoterResultsState,
  toAbsoluteUrl,
  votePermalinkPath,
  votePresenterPath,
} from '@lfx-one/shared/utils';
import { LinkifyHtmlPipe } from '@pipes/linkify-html.pipe';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { UserService } from '@services/user.service';
import { ExternalLinksDirective } from '@shared/directives/external-links.directive';
import { exportSlideImage, voteSlideFileName, voteSlideToast } from '@shared/utils/slide-export.util';
import { resolveVoteCanManage } from '@shared/utils/write-access.util';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { PaginatorState } from 'primeng/paginator';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, startWith, switchMap, tap, throwError } from 'rxjs';

import { NotFoundComponent } from '../../not-found/not-found.component';
import { VoteAbstainResultComponent } from '../components/vote-abstain-result/vote-abstain-result.component';
import { VoteCastDrawerComponent } from '../components/vote-cast-drawer/vote-cast-drawer.component';
import { VoteCommentItemComponent } from '../components/vote-comment-item/vote-comment-item.component';
import { VoteCommentResultsComponent } from '../components/vote-comment-results/vote-comment-results.component';
import { VoteDetailFactsComponent } from '../components/vote-detail-facts/vote-detail-facts.component';
import { VoteDetailHeaderComponent } from '../components/vote-detail-header/vote-detail-header.component';
import { VoteMyBallotComponent } from '../components/vote-my-ballot/vote-my-ballot.component';
import { VoteOptionResultsComponent } from '../components/vote-option-results/vote-option-results.component';
import { VoteParticipationCardComponent } from '../components/vote-participation-card/vote-participation-card.component';
import { VoteRankedQuestionResultsComponent } from '../components/vote-ranked-question-results/vote-ranked-question-results.component';
import { VoteReminderDialogComponent } from '../components/vote-reminder-dialog/vote-reminder-dialog.component';
import { VoteVotersComponent } from '../components/vote-voters/vote-voters.component';

/**
 * Vote detail page (#3913). Route: /votes/:id — the shareable vote permalink, the reminder-email target, and the
 * in-app vote destination (#3915), except active My Votes ballots still awaiting a response, which open on the list (#4330).
 *
 * The manager view follows write access on the vote (project writer, then committee writer — `resolveVoteCanManage`),
 * never the lens. Voters see only their own response, and totals and comments
 * after the vote closes (the shared `canVoterFetchVoteResults` / `resolveVoterResultsState` rules). A vote the user can't
 * view (400/403/404) renders the shared not-found page in place with HTTP 404 under SSR, so a missing vote and a
 * forbidden one look identical; any other failure is a retry card. SSR stops after the vote fetch and paints the loading
 * skeleton; everything else resolves in the browser. An invited voter still awaiting a ballot on an
 * active vote gets the cast drawer once on load, as the reminder email intends.
 *
 * The Voters tab (#3914) lists each invited voter's current ballot. It shows only to a manager on a vote that is open or
 * closed (`showVotersTab`), the same rules GET /api/votes/:uid/voters enforces; on a vote that is not explicitly named it is
 * participation-only (#3916). The results' count links and the comments' "View ballot" links open it through
 * `voters_choice` / `voters_ballot`; both links and both params are named-vote only (`showNamedBallotLinks`).
 *
 * On a pseudo-anonymous vote the BFF holds totals, the abstention count and comments until the vote ends (`results_held`,
 * #3916): the page shows a held panel in their place and keeps the participation numbers.
 *
 * Non-managers see comments as text only, on named votes too (#4330) — the BFF strips commenter identity for them.
 * Until manager access or a successful, non-removed invitation lookup for this vote is verified (`showVoteDetails`),
 * the page shows only the header basics and the loading or voter-state panel.
 */
@Component({
  selector: 'lfx-vote-detail',
  imports: [
    NgTemplateOutlet,
    ButtonComponent,
    CardComponent,
    ExternalLinksDirective,
    LinkifyHtmlPipe,
    VoteDescriptionPipe,
    NotFoundComponent,
    SkeletonModule,
    StatCardGridComponent,
    TagComponent,
    VoteAbstainResultComponent,
    VoteCastDrawerComponent,
    VoteCommentItemComponent,
    VoteCommentResultsComponent,
    VoteDetailFactsComponent,
    VoteDetailHeaderComponent,
    VoteMyBallotComponent,
    VoteOptionResultsComponent,
    VoteParticipationCardComponent,
    VoteRankedQuestionResultsComponent,
    ShareSlideComponent,
    VoteVotersComponent,
  ],
  providers: [DialogService],
  templateUrl: './vote-detail.component.html',
})
export class VoteDetailComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly voteService = inject(VoteService);
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  /** Re-runs the vote load: `retry` shows the skeleton again, `refresh` (after a ballot) reloads in place. */
  private readonly reload$ = new BehaviorSubject<'retry' | 'refresh'>('retry');

  // === Writable Signals ===
  protected readonly castDrawerVisible = signal<boolean>(false);
  protected readonly slideBusy = signal<boolean>(false);
  protected readonly impersonating = this.userService.impersonating;
  protected readonly impersonationReadOnlyNotice = VOTE_IMPERSONATION_READ_ONLY_NOTICE;
  protected readonly impersonationPrivateNotice = VOTE_IMPERSONATION_PRIVATE_NOTICE;
  protected readonly myResponseLoading = signal<boolean>(false);
  /** True when the most recent my-response call failed (non-404) — a transient failure must not collapse into not-participant. */
  protected readonly myResponseError = signal<boolean>(false);
  protected readonly myBallotLoading = signal<boolean>(false);
  protected readonly myBallotError = signal<boolean>(false);
  /** Records a settled lookup even when the viewer has no response row; null alone cannot identify its vote. */
  private readonly myResponseLoadedFor = signal<string | null>(null);
  /** Results status belongs to its request's vote, just like the retained payload. */
  private readonly voteResultsStatus = signal<{ voteId: string | null; loading: boolean; error: boolean }>({ voteId: null, loading: false, error: false });
  /** Bumped after a ballot is submitted so my-response and results reload. */
  private readonly refreshTick = signal<number>(0);
  /** The vote a ballot was cast on from this page — it reads as submitted before the refreshed (indexed) response catches up. */
  private readonly submittedBallotFor = signal<string | null>(null);
  /** Comment paginator state owned here so a page survives switching tabs (bound two-way into lfx-vote-comment-results). */
  protected readonly commentPaginatorState = signal<Map<string, PaginatorState>>(new Map());

  // === Route Params (toSignal) ===
  protected readonly voteId: Signal<string | null> = this.initVoteId();
  private readonly requestedTab: Signal<VoteDetailTab> = this.initRequestedTab();
  private readonly requestedVotersChoice: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('voters_choice'))), {
    initialValue: null,
  });
  private readonly requestedVotersBallot: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('voters_ballot'))), {
    initialValue: null,
  });

  // === Data Signals (Complex — init via private functions) ===
  /** Single load-state stream: loading, not-found, transient error and the loaded vote derive from one emission. */
  protected readonly state: Signal<VoteDetailState> = this.initState();
  protected readonly vote: Signal<Vote | null> = computed(() => (this.state().vote?.uid === this.voteId() ? this.state().vote : null));
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
  protected readonly accessLoading: Signal<boolean> = computed(() => this.canManage() === null || this.myResponseLoadedFor() !== this.vote()?.uid);
  protected readonly voteResults: Signal<VoteResultsResponse | null> = this.initVoteResults();
  protected readonly loadingVoteResults: Signal<boolean> = this.initLoadingVoteResults();
  protected readonly voteResultsError: Signal<boolean> = computed(() => this.voteResultsStatus().voteId === this.vote()?.uid && this.voteResultsStatus().error);
  /** Settled, successful results — participation totals wait for these, since `computeVoteParticipationStats(null)` reads as zero. */
  protected readonly hasLoadedResults: Signal<boolean> = computed(() => !!this.voteResults() && !this.loadingVoteResults() && !this.voteResultsError());
  /** Pseudo-anonymous totals, abstentions and comments are held until the vote ends (#3916) — a missing `num_abstained` must not read as 0. */
  protected readonly resultsHeld: Signal<boolean> = computed(() => this.voteResults()?.results_held === true);

  // === Computed Signals ===
  /** Voters tab: a manager (never while the access check runs) on a vote that is open or closed, never a draft. */
  protected readonly showVotersTab: Signal<boolean> = this.initShowVotersTab();
  /** A missing privacy flag fails closed, as the server does (#3911). */
  protected readonly isPseudoAnonymous: Signal<boolean> = computed(() => this.vote()?.pseudo_anonymity !== false);
  protected readonly ballotPrivacyRestricted = computed(() => this.impersonating() && this.isPseudoAnonymous());
  /** Ballot and "View voters" links (and their deep-link params) — explicitly named votes only, even though the tab now shows on any vote (#3916). */
  protected readonly showNamedBallotLinks: Signal<boolean> = computed(() => this.showVotersTab() && !this.isPseudoAnonymous());
  protected readonly votersChoice: Signal<string | null> = computed(() => (this.showNamedBallotLinks() ? this.requestedVotersChoice() : null));
  protected readonly votersBallot: Signal<string | null> = computed(() => (this.showNamedBallotLinks() ? this.requestedVotersBallot() : null));
  protected readonly tabs: Signal<readonly VoteDetailTabOption[]> = this.initTabs();
  protected readonly activeTab: Signal<VoteDetailTab> = this.initActiveTab();
  private readonly hasSubmittedBallot: Signal<boolean> = computed(() => !!this.vote() && this.submittedBallotFor() === this.vote()?.uid);
  protected readonly voterState: Signal<VoterResultsState> = this.initVoterState();
  /** The viewer's own current ballot, read only for a voter whose ballot is recorded on an active vote (#4331). */
  protected readonly myBallot: Signal<MyVoteBallot | null> = this.initMyBallot();
  /** A settled voter view for someone never invited or removed from the vote (#4330) — the page trims to the voter-state panel. */
  protected readonly isOutsider: Signal<boolean> = computed(
    () => !this.accessLoading() && this.audience() === 'voter' && (this.voterState() === 'not_participant' || this.voterState() === 'access_denied')
  );
  /** Non-basic details require verified manager access or a successful, non-removed invitation lookup (#4330). */
  protected readonly showVoteDetails: Signal<boolean> = this.initShowVoteDetails();
  /** Shared privacy gate for the Overview preview and the Comments tab. */
  protected readonly commentsAnonymous: Signal<boolean> = computed(() => this.isPseudoAnonymous() || this.audience() === 'voter');
  /** Why comments render without names: the vote is pseudo-anonymous, or the viewer is not a manager (#4330). */
  protected readonly commentAnonymityReason: Signal<VoteCommentAnonymityReason> = computed(() =>
    this.isPseudoAnonymous() ? 'pseudo_anonymous' : 'voter_view'
  );
  /** Present and Copy slide: a manager on an active or ended vote; votePresenterGuard re-checks `vote#writer`. */
  protected readonly canPresent: Signal<boolean> = computed(() => {
    const status = normalizePollStatus(this.vote()?.status);
    return this.audience() === 'creator' && (status === PollStatus.ACTIVE || status === PollStatus.ENDED);
  });
  /** Send ballots now (#4363): a manager on an active vote; the BFF re-checks `vote#writer`. */
  protected readonly canSendBallots: Signal<boolean> = computed(
    () => this.audience() === 'creator' && normalizePollStatus(this.vote()?.status) === PollStatus.ACTIVE
  );
  protected readonly slideLink: Signal<string> = computed(() => toAbsoluteUrl(votePermalinkPath(this.vote()?.uid ?? ''), isPlatformBrowser(this.platformId)));
  private readonly slideRef = viewChild<ElementRef<HTMLElement>>('slide');
  private readonly slideComponent = viewChild(ShareSlideComponent);

  /** Results (and comments) render for a manager, or for a voter once the vote closed; every other voter gets a state panel. */
  protected readonly showsResults: Signal<boolean> = computed(
    () => this.audience() === 'creator' || (this.voterState() === 'closed' && !this.myResponseError())
  );
  protected readonly canCastVote: Signal<boolean> = computed(
    () => !this.impersonating() && !this.hasSubmittedBallot() && this.isAwaitingBallot(this.vote(), this.myResponse())
  );
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote()?.status) === PollStatus.ACTIVE);
  /** Formally ended. A draft (`disabled`) is neither active nor ended, so "closed" copy keys on this, never on `!isActive`. */
  protected readonly isEnded: Signal<boolean> = computed(() => normalizePollStatus(this.vote()?.status) === PollStatus.ENDED);
  /** Non-ranked poll types (generic, majority, and anything unrecognized) render the plurality layout — see isRankedPollType. */
  protected readonly isGenericPoll: Signal<boolean> = computed(() => !isRankedPollType(this.vote()?.poll_type));
  protected readonly participationStats: Signal<VoteParticipationStats> = computed(() => computeVoteParticipationStats(this.voteResults()));
  /** Abstain UI follows the data, not just the flag. */
  protected readonly showAbstain: Signal<boolean> = computed(
    () => !this.voteResultsError() && (!!this.vote()?.allow_abstain || this.participationStats().abstainedVoters > 0)
  );
  protected readonly isVoteClosed: Signal<boolean> = this.initIsVoteClosed();
  /** Overview results tag — a draft reads "Not open yet", never "Voting in progress". */
  protected readonly resultsStatusTag: Signal<{ value: string; severity: 'success' | 'secondary' }> = this.initResultsStatusTag();
  protected readonly questionsWithResults: Signal<VoteResultsQuestion[]> = computed(() => buildVoteResultsQuestions(this.voteResults(), this.isVoteClosed()));
  protected readonly rankedQuestions: Signal<RankedQuestionView[]> = computed(() => buildRankedQuestionViews(this.voteResults()));
  /** One leader/winner line per question for the Overview results card; the full breakdown stays on the Results tab. */
  protected readonly overviewSummary: Signal<VoteResultsSummaryLine[]> = computed(() =>
    buildVoteResultsSummary(this.questionsWithResults(), this.rankedQuestions(), this.isGenericPoll(), this.isVoteClosed())
  );
  protected readonly commentResults: Signal<PollCommentResult[]> = this.initCommentResults();
  protected readonly commentPrompts: Signal<PollCommentPrompt[]> = computed(() => this.commentResults().map((result) => result.prompt));
  protected readonly commentPromptCount: Signal<number> = computed(() =>
    Math.max(this.vote()?.poll_comment_prompts?.length ?? 0, this.commentResults().length)
  );
  protected readonly commentCount: Signal<number> = computed(() =>
    this.commentResults().reduce((sum, result) => sum + (result.total_responses ?? result.responses.length), 0)
  );
  /** Overview preview: newest first across prompts where timestamps exist, else the server's text order (#4448). */
  protected readonly recentComments: Signal<CommentResponseView[]> = computed(() =>
    getRecentCommentResponses(this.commentResults(), VOTE_OVERVIEW_COMMENT_PREVIEW_LIMIT)
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
    // A tab picked from the strip opens unfiltered: the voters_* deep-link params belong to the link that set them.
    this.navigateToTab({ tab: tab === VOTE_DETAIL_DEFAULT_TAB ? null : tab, voters_choice: null, voters_ballot: null });
  }

  /** The vote count on a generic option opens its filtered voter list. */
  protected onViewOptionVoters(questionId: string, choiceId: string): void {
    this.onViewVoters(`${questionId}:${choiceId}`);
  }

  /** The abstention count selects the Abstained status on the Voters tab. */
  protected onViewAbstainedVoters(): void {
    this.onViewVoters(VOTE_VOTERS_ABSTAINED_CHOICE_KEY);
  }

  /** Opens the Voters tab filtered to a `<question_id>:<choice_id>` choice key. */
  protected onViewVoters(choiceKey: string): void {
    if (!this.showNamedBallotLinks()) return;
    this.navigateToTab({ tab: 'voters', voters_choice: choiceKey, voters_ballot: null });
  }

  /** Opens the Voters tab with a comment's ballot (its vote response uid) open. */
  protected onViewBallot(voteResponseUid: string): void {
    if (!this.showNamedBallotLinks()) return;
    this.navigateToTab({ tab: 'voters', voters_choice: null, voters_ballot: voteResponseUid });
  }

  protected onCastVote(): void {
    if (!this.impersonating()) this.castDrawerVisible.set(true);
  }

  protected onVoteSubmitted(voteId: string): void {
    // A delayed completion belongs to the ballot it submitted, not a vote reached since then.
    if (voteId !== this.voteId() || voteId !== this.vote()?.uid) return;
    this.submittedBallotFor.set(voteId);
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

  /** Opens the chrome-less presenter in a new tab; votePresenterGuard (vote#writer) is the real gate. */
  protected onPresent(): void {
    const uid = this.vote()?.uid;
    if (uid) this.document.defaultView?.open(votePresenterPath(uid), '_blank', 'noopener,noreferrer');
  }

  /** Exports the static vote slide (#4145): PNG to the clipboard where the browser allows, else a download. */
  protected async onCopySlide(): Promise<void> {
    const element = this.slideRef()?.nativeElement;
    const name = this.vote()?.name;
    if (!element || !name || this.slideBusy()) return;
    this.slideBusy.set(true);
    // The QR is generated asynchronously; capturing before it renders would copy a slide with a blank code.
    const result = (await this.slideComponent()?.whenQrReady()) ? await exportSlideImage(element, voteSlideFileName(name)) : 'failed';
    this.slideBusy.set(false);
    this.messageService.add(voteSlideToast(result));
  }

  protected onViewResults(): void {
    this.switchTab('results');
  }

  /** Routes a summary card click; clicks while results load or after they fail are ignored, as the cards' figures are not real yet. */
  protected onSummaryCardClick(action: string): void {
    if (this.loadingVoteResults() || this.voteResultsError()) return;
    switch (action as VoteDetailSummaryCardAction) {
      case VOTE_DETAIL_SUMMARY_CARD_ACTIONS.RESPONSES:
        this.switchTab('voters');
        return;
      case VOTE_DETAIL_SUMMARY_CARD_ACTIONS.COMMENTS:
        this.switchTab('comments');
        return;
      case VOTE_DETAIL_SUMMARY_CARD_ACTIONS.NOT_VOTED:
        this.onSendReminder();
        return;
    }
  }

  protected goBack(): void {
    void this.router.navigate(['/votes']);
  }

  // === Private Initializers ===
  private initVoteId(): Signal<string | null> {
    return toSignal(
      this.route.paramMap.pipe(
        map((params) => params.get('id')),
        distinctUntilChanged(),
        tap(() => this.commentPaginatorState.set(new Map()))
      ),
      { initialValue: null }
    );
  }

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
          // Cached route changes can reuse the mounted drawer; the next vote must earn its own auto-open.
          if (lastLoaded?.vote?.uid !== id) this.castDrawerVisible.set(false);
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
              console.error('Failed to load vote for detail page', { status: err?.status, message: err?.message });
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
    const response = toSignal(
      toObservable(key).pipe(
        distinctUntilChanged((a, b) => a.uid === b.uid && a.tick === b.tick),
        switchMap(({ uid }) => {
          if (!uid) {
            this.myResponseLoading.set(false);
            this.myResponseError.set(false);
            this.myResponseLoadedFor.set(null);
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
            tap(() => this.myResponseLoadedFor.set(uid)),
            finalize(() => this.myResponseLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
    // toObservable effects settle later than vote changes; never expose another vote's retained response.
    return computed(() => (response()?.vote_uid === this.vote()?.uid ? response() : null));
  }

  /**
   * Keyed on the vote uid, the refresh tick and whether a voter's ballot is recorded, so a ballot cast from this page
   * loads once it lands. The BFF returns only the caller's own ballot, on pseudo-anonymous votes too (#4331).
   */
  private initMyBallot(): Signal<MyVoteBallot | null> {
    const key = computed(() => ({
      uid: this.vote()?.uid ?? null,
      tick: this.refreshTick(),
      // canManage() is null while access resolves, and audience() reads 'voter' then — wait so a manager never fetches.
      submitted: this.voterState() === 'submitted' && this.canManage() !== null && this.audience() === 'voter' && !this.ballotPrivacyRestricted(),
    }));
    const ballot = toSignal(
      toObservable(key).pipe(
        distinctUntilChanged((a, b) => a.uid === b.uid && a.tick === b.tick && a.submitted === b.submitted),
        switchMap(({ uid, submitted }) => {
          this.myBallotError.set(false);
          if (!uid || !submitted) {
            this.myBallotLoading.set(false);
            return of(null);
          }
          this.myBallotLoading.set(true);
          return this.voteService.getMyVoteBallot(uid).pipe(
            // The service maps 404 to null; a submitted ballot must not disappear silently.
            tap((ballot) => this.myBallotError.set(ballot === null)),
            catchError(() => {
              this.myBallotError.set(true);
              return of(null);
            }),
            finalize(() => this.myBallotLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
    // Never expose another vote's retained ballot while the key settles.
    return computed(() => (ballot()?.vote_uid === this.vote()?.uid ? ballot() : null));
  }

  private initCanManage(): Signal<boolean | null> {
    const voteUid = computed(() => this.vote()?.uid ?? null);
    const access = toSignal(
      toObservable(voteUid).pipe(
        switchMap((uid) => {
          const vote = this.vote();
          if (!uid || !vote) return of(null);
          return resolveVoteCanManage(
            vote,
            (slugOrUid) => this.projectService.getProjectStrict(slugOrUid),
            (committeeUid) => this.committeeService.fetchCommittee(committeeUid)
          ).pipe(
            map((canManage) => ({ uid, canManage })),
            startWith(null)
          );
        })
      ),
      { initialValue: null }
    );
    return computed(() => (access()?.uid === this.vote()?.uid ? (access()?.canManage ?? null) : null));
  }

  /** A ballot cast from this page reads as submitted even while the refreshed response is in flight or still lags behind. */
  private initVoterState(): Signal<VoterResultsState> {
    return computed(() => {
      const state = resolveVoterResultsState(this.vote(), this.myResponse(), this.myResponseLoading(), this.myResponseError(), this.vote()?.response_status);
      return state === 'not_voted' && this.hasSubmittedBallot() ? 'submitted' : state;
    });
  }

  /** Managers always load results; voters only after close with a settled, matching, non-removed response. */
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

    // Retain only the current eligible vote's last results while a same-vote refresh is in flight.
    let loadedFor: string | null = null;
    let lastResults: VoteResultsResponse | null = null;

    const results = toSignal(
      toObservable(key).pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.tick === b?.tick),
        switchMap((resultsKey) => {
          if (!resultsKey) {
            loadedFor = null;
            lastResults = null;
            this.voteResultsStatus.set({ voteId: null, loading: false, error: false });
            return of(null);
          }
          if (loadedFor !== resultsKey.id) lastResults = null;
          loadedFor = resultsKey.id;
          this.voteResultsStatus.set({ voteId: resultsKey.id, loading: !lastResults, error: false });
          return this.voteService.getVoteResults(resultsKey.id).pipe(
            catchError(() => {
              this.voteResultsStatus.set({ voteId: resultsKey.id, loading: false, error: true });
              return of(null);
            }),
            tap((results) => (lastResults = results)),
            finalize(() => {
              this.voteResultsStatus.update((status) => (status.voteId === resultsKey.id ? { ...status, loading: false } : status));
            }),
            startWith(lastResults),
            map((payload) => ({ id: resultsKey.id, payload }))
          );
        })
      ),
      { initialValue: null }
    );
    return computed(() => (results()?.id === this.vote()?.uid ? (results()?.payload ?? null) : null));
  }

  private initLoadingVoteResults(): Signal<boolean> {
    return computed(() => {
      const status = this.voteResultsStatus();
      // Access can settle before the results effect starts: eligible readers are still waiting, not looking at an empty result.
      return status.voteId === this.vote()?.uid ? status.loading : this.showsResults();
    });
  }

  private initShowVoteDetails(): Signal<boolean> {
    return computed(() => {
      if (this.accessLoading() || this.isOutsider()) return false;
      if (this.canManage() === true) return true;
      const response = this.myResponse();
      return !this.myResponseError() && !!response && response.vote_uid === this.vote()?.uid && !response.voter_removed;
    });
  }

  private initShowVotersTab(): Signal<boolean> {
    return computed(() => {
      const vote = this.vote();
      if (!vote || this.canManage() !== true) return false;
      const status = normalizePollStatus(vote.status);
      return status === PollStatus.ACTIVE || status === PollStatus.ENDED;
    });
  }

  /**
   * Comments use detail prompts or the results fallback; the Voters tab only appears when `showVotersTab` allows it.
   * An outsider or unverified voter gets Overview alone (#4330), so a `?tab=` deep link falls back to it.
   */
  private initTabs(): Signal<readonly VoteDetailTabOption[]> {
    return computed(() => {
      if (!this.showVoteDetails()) return VOTE_DETAIL_TABS.filter((tab) => tab.key === VOTE_DETAIL_DEFAULT_TAB);
      const hasPrompts = this.commentPromptCount() > 0;
      const showVoters = this.showVotersTab();
      return VOTE_DETAIL_TABS.filter((tab) => (tab.key !== 'comments' || hasPrompts) && (tab.key !== 'voters' || showVoters)).map((tab) => ({
        ...tab,
        ...this.tabCount(tab.key),
      }));
    });
  }

  /** A `?tab=` the vote doesn't offer (no detail/result comment prompts, or Voters without access) falls back to the default tab. */
  private initActiveTab(): Signal<VoteDetailTab> {
    return computed(() => {
      const requested = this.requestedTab();
      return this.tabs().some((tab) => tab.key === requested) ? requested : VOTE_DETAIL_DEFAULT_TAB;
    });
  }

  private initIsVoteClosed(): Signal<boolean> {
    return computed(() => {
      if (normalizePollStatus(this.vote()?.status) === PollStatus.ENDED) return true;
      // Treat 100% participation as finalized even if the vote hasn't formally ended.
      const stats = this.participationStats();
      return stats.eligibleVoters > 0 && stats.participationRate >= 100;
    });
  }

  private initResultsStatusTag(): Signal<{ value: string; severity: 'success' | 'secondary' }> {
    return computed(() => {
      // Held results are never final: an ended vote can still be held while upstream catches up (#3916).
      if (this.resultsHeld()) {
        if (this.isEnded()) return { value: 'Totals pending', severity: 'secondary' };
      } else if (this.isVoteClosed()) {
        return { value: 'Final results', severity: 'secondary' };
      }
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

  /** Manager-only summary — voters get no stats. A card is clickable (#4447) only while its target is reachable. */
  private initSummaryCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const stats = this.participationStats();
      const loaded = !!this.voteResults();
      const held = this.resultsHeld();
      const disabled = this.voteResultsError();
      const dash = '—';
      // A held payload has no abstention count; leave it out rather than show a false 0 (#3916).
      const abstained = held ? 0 : stats.abstainedVoters;
      const commentsReachable = this.commentPromptCount() > 0 && !held;
      return [
        {
          value: loaded ? `${stats.totalResponses} / ${stats.eligibleVoters}` : dash,
          label: 'Responded',
          subLine: loaded ? this.respondedSubLine(stats.participationRate, abstained) : undefined,
          icon: 'fa-light fa-users',
          iconContainerClass: 'bg-blue-100 text-blue-600',
          disabled,
          ...(this.showVotersTab() && { action: VOTE_DETAIL_SUMMARY_CARD_ACTIONS.RESPONSES }),
        },
        {
          value: loaded && !held ? this.commentCount() : dash,
          label: 'Comments',
          subLine: this.commentPromptCount() > 0 ? 'Optional written responses' : 'Comments not enabled',
          icon: 'fa-light fa-comments',
          iconContainerClass: 'bg-violet-100 text-violet-600',
          disabled,
          ...(commentsReachable && { action: VOTE_DETAIL_SUMMARY_CARD_ACTIONS.COMMENTS }),
        },
        {
          value: loaded ? this.notVotedCount() : dash,
          ...this.notVotedCardText(),
          icon: 'fa-light fa-clock',
          iconContainerClass: 'bg-amber-100 text-amber-600',
          disabled,
          ...(this.isActive() && { action: VOTE_DETAIL_SUMMARY_CARD_ACTIONS.NOT_VOTED }),
        },
      ];
    });
  }

  /** Opens the cast drawer once per loaded vote for an invited voter still awaiting a ballot — the reminder email's intent. */
  private initCastDrawerAutoOpen(): void {
    const awaitingVoteUid = computed(() => (this.canCastVote() ? (this.vote()?.uid ?? null) : null));
    toObservable(awaitingVoteUid)
      .pipe(
        // A null in between (another vote, or no ballot owed) re-arms the auto-open for a vote the voter returns to.
        distinctUntilChanged(),
        filter((uid): uid is string => !!uid),
        takeUntilDestroyed()
      )
      .subscribe(() => this.castDrawerVisible.set(true));
  }

  // === Private Helpers ===
  /** Badge for a tab, or nothing: Comments waits for loaded, un-held results; zero and unknown counts show no badge (#4768). */
  private tabCount(key: VoteDetailTab): Pick<VoteDetailTabOption, 'count' | 'countLabel'> {
    if (key === 'comments') {
      const count = this.commentCount();
      if (!this.hasLoadedResults() || this.resultsHeld() || count <= 0) return {};
      return { count, countLabel: `${count} ${count === 1 ? 'comment' : 'comments'}` };
    }
    if (key === 'voters') {
      const count = this.vote()?.total_voting_request_invitations ?? 0;
      if (count <= 0) return {};
      return { count, countLabel: `${count} invited ${count === 1 ? 'voter' : 'voters'}` };
    }
    return {};
  }

  private navigateToTab(queryParams: Params): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Open, ended or draft — a draft hasn't opened for voting, so it reads neither as reminder-ready nor as closed. */
  private notVotedCardText(): Pick<StatCardItem, 'label' | 'subLine'> {
    if (this.isActive()) return { label: 'Not voted yet', subLine: 'Eligible for a reminder' };
    if (this.isEnded()) return { label: 'Did not vote', subLine: 'Voting is closed' };
    return { label: 'Not voted yet', subLine: 'Voting not open yet' };
  }

  private respondedSubLine(participationRate: number, abstained: number): string {
    const base = `${participationRate}% participation`;
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
