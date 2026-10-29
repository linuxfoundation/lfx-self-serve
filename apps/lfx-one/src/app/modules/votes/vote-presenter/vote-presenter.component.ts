// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, formatDate, isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import {
  VOTE_PRESENTER_BACKOFF_BASE_MS,
  VOTE_PRESENTER_BACKOFF_MAX_MS,
  VOTE_PRESENTER_COPY_CONFIRMATION_MS,
  VOTE_PRESENTER_CLOCK_TICK_MS,
  VOTE_PRESENTER_POLL_INTERVAL_MS,
  VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS,
  VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS,
} from '@lfx-one/shared/constants';
import { PollStatus, VoteRowParticipationState } from '@lfx-one/shared/enums';
import {
  RankedQuestionView,
  VotePresenterCountParts,
  VotePresenterPhase,
  VotePresenterTallyQuestion,
  VotePresenterSnapshot,
  VoteResultsOption,
  VoteResultsQuestion,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import {
  buildRankedQuestionViews,
  buildVoteResultsQuestions,
  computeVoteParticipationStats,
  computeVoteRowParticipation,
  isRankedPollType,
  toAbsoluteUrl,
  truncateVoteTitle,
  votePermalinkPath,
} from '@lfx-one/shared/utils';
import { VoteService } from '@services/vote.service';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, distinctUntilChanged, EMPTY, expand, filter, map, Observable, of, switchMap, tap, timer } from 'rxjs';

import { VoteQrComponent } from '../components/vote-qr/vote-qr.component';
import { VoteSendBallotsComponent } from '../components/vote-send-ballots/vote-send-ballots.component';
import { VoteRankedQuestionResultsComponent } from '../components/vote-ranked-question-results/vote-ranked-question-results.component';

/** Tally bar colour: the winner is emerald, a tie amber, everything else the neutral blue. Never inferred from option text. */
function tallyBarClass(option: VoteResultsOption): string {
  if (option.isWinner) return 'bg-emerald-500';
  if (option.isTied) return 'bg-amber-400';
  return 'bg-blue-400';
}

/**
 * Chrome-less presenter view for a live vote (#4140). Route: /votes/:id/present (top-level, outside MainLayout).
 *
 * Counts come only from `GET /api/votes/:uid` via {@link computeVoteRowParticipation}; `/results` is requested exactly once
 * per transition to `ended` and never while the vote is open — the voting service does not gate it, so secrecy is enforced
 * here. Polling is browser-only, visibility-aware and non-overlapping (see createVisibilityPoll); SSR renders the skeleton.
 */
@Component({
  selector: 'lfx-vote-presenter',
  imports: [
    ButtonComponent,
    CardComponent,
    DatePipe,
    NgTemplateOutlet,
    TooltipModule,
    VoteQrComponent,
    VoteRankedQuestionResultsComponent,
    VoteSendBallotsComponent,
  ],
  templateUrl: './vote-presenter.component.html',
  host: { '(document:keydown.escape)': 'exit()' },
})
export class VotePresenterComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly voteService = inject(VoteService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isBrowser = isPlatformBrowser(this.platformId);
  protected readonly PollStatus = PollStatus;

  // === Route Params ===
  protected readonly voteId: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('id'))), { initialValue: null });

  // === Writable Signals ===
  private readonly snapshot = signal<VotePresenterSnapshot | null>(null);
  private readonly failures = signal(0);
  protected readonly resultsError = signal(false);
  protected readonly resultsLoading = signal(false);
  private readonly locale = inject(LOCALE_ID);
  protected readonly nowMs = signal(Date.now());
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  private readonly retryTick = signal(0);

  // === Computed Signals ===
  protected readonly vote = computed(() => this.snapshot()?.vote ?? null);
  /** Set only while the vote is ended; a reopen drops it to null so `/results` is requested once per ended period. */
  private readonly endedVoteUid = computed(() => {
    const vote = this.vote();
    return vote?.status === PollStatus.ENDED ? vote.uid : null;
  });
  private readonly results: Signal<VoteResultsResponse | null> = this.initResults();
  private readonly formattedEndTime = computed(() => {
    const end = this.vote()?.end_time;
    return end ? formatDate(end, 'medium', this.locale) : 'its deadline';
  });
  protected readonly phase: Signal<VotePresenterPhase> = this.initPhase();
  protected readonly participation = computed(() => {
    const vote = this.vote();
    return vote ? computeVoteRowParticipation(vote) : null;
  });
  protected readonly countParts = this.initCountParts();
  protected readonly title = computed(() => truncateVoteTitle(this.vote()?.name ?? ''));
  protected readonly titleTruncated = computed(() => this.title() !== (this.vote()?.name ?? '').trim());
  protected readonly voteLink = computed(() => toAbsoluteUrl(votePermalinkPath(this.voteId() ?? ''), this.isBrowser));
  protected readonly updatedAgoSeconds = computed(() => {
    const received = this.snapshot()?.receivedAtMs;
    return received ? Math.max(0, Math.floor((this.nowMs() - received) / 1000)) : null;
  });
  protected readonly closedAt = computed(() => {
    const vote = this.vote();
    return vote?.early_end_time || vote?.end_time || null;
  });
  protected readonly closeTooltip = computed(() => `Ending a vote early is coming; this vote ends at ${this.formattedEndTime()}`);
  protected readonly showAbstain = computed(() => this.vote()?.allow_abstain === true);
  protected readonly isRanked = computed(() => isRankedPollType(this.vote()?.poll_type));
  protected readonly stats = computed(() => computeVoteParticipationStats(this.results()));
  protected readonly questions: Signal<VoteResultsQuestion[]> = computed(() => buildVoteResultsQuestions(this.results(), true));
  protected readonly rankedQuestions: Signal<RankedQuestionView[]> = computed(() => buildRankedQuestionViews(this.results()));
  /** Option rows for the Closed artboard's tally bars; the bar colour follows the result (winner, tie, other). */
  protected readonly tally: Signal<VotePresenterTallyQuestion[]> = computed(() =>
    this.questions().map((q) => ({
      questionId: q.questionId,
      question: q.question,
      rows: q.options.map((o) => ({
        id: o.choiceId,
        text: o.text,
        count: o.voteCount,
        percent: o.percentage,
        barClass: tallyBarClass(o),
      })),
    }))
  );
  /** The BFF holds an ended pseudo-anonymous vote's results until they are final; the payload then has no tallies or abstention count. */
  protected readonly resultsHeld = computed(() => this.results()?.results_held === true);
  /** True once final `/results` has arrived; until then (or after a failure, or while held) no result-derived number is shown, since the stats default to zeros. */
  protected readonly resultsReady = computed(() => this.results() !== null && !this.resultsHeld());
  /** Clock time the vote closed, formatted here because a pipe inside `??` would bind to the right operand only. */
  protected readonly closedClock = computed(() => {
    const vote = this.vote();
    const closed = this.closedAt() ?? vote?.end_time;
    return closed ? formatDate(closed, 'h:mm a', this.locale) : '';
  });
  protected readonly didNotVote = computed(() => Math.max(0, this.stats().eligibleVoters - this.stats().totalResponses));
  protected readonly ballotLabel = computed(() => (this.vote()?.pseudo_anonymity ? 'Secret' : 'Not secret'));
  /** Header pill: when the open vote closes, or when the ended vote did. */
  protected readonly statusPill = computed(() => {
    const vote = this.vote();
    if (!vote) return '';
    if (vote.status === PollStatus.ENDED) return `Vote ended · ${formatDate(this.closedAt() ?? vote.end_time, 'MMM d, h:mm a', this.locale)}`;
    return `Vote open · closes ${formatDate(vote.end_time, 'MMM d, h:mm a', this.locale)}`;
  });

  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  private polledVoteId: string | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => this.copyResetTimer && clearTimeout(this.copyResetTimer));
    if (this.isBrowser) {
      this.startPolling();
      timer(VOTE_PRESENTER_CLOCK_TICK_MS, VOTE_PRESENTER_CLOCK_TICK_MS)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.nowMs.set(Date.now()));
    }
  }

  // === Protected Methods ===
  protected exit(): void {
    const id = this.voteId();
    void this.router.navigateByUrl(id ? votePermalinkPath(id) : '/votes');
  }

  /** Restarts the poll loop from the error state without waiting out the backoff. */
  protected retry(): void {
    this.failures.set(0);
    this.retryTick.update((n) => n + 1);
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.voteLink());
      this.copyFailed.set(false);
      this.copied.set(true);
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => this.copied.set(false), VOTE_PRESENTER_COPY_CONFIRMATION_MS);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
    }
  }

  // === Private Initializers ===
  private startPolling(): void {
    toObservable(computed(() => ({ id: this.voteId(), retry: this.retryTick() })))
      .pipe(
        map(({ id }) => id),
        filter((id): id is string => !!id),
        // A new :id reuses this component: drop the previous vote's snapshot (and with it the ended-vote results) before polling it.
        tap((id) => {
          if (id !== this.polledVoteId) {
            this.snapshot.set(null);
            this.failures.set(0);
            this.resultsError.set(false);
          }
          this.polledVoteId = id;
        }),
        // Polls omit include_writer: the guard read it once for this session, so no FGA lookup per 5s tick. They also keep running
        // after `ended`, so a vote another manager reopens flips back to the open state; /results is still requested once per ended period.
        switchMap((id) =>
          createVisibilityPoll(this.doc, () => this.voteService.fetchVote(id, { uncached: true }), {
            intervalMs: VOTE_PRESENTER_POLL_INTERVAL_MS,
            backoffBaseMs: VOTE_PRESENTER_BACKOFF_BASE_MS,
            backoffMaxMs: VOTE_PRESENTER_BACKOFF_MAX_MS,
          })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        if (event.kind === 'ok') {
          this.failures.set(0);
          this.snapshot.set({ vote: event.value, receivedAtMs: Date.now() });
        } else {
          this.failures.set(event.failures);
        }
      });
  }

  /**
   * `/results` is requested once per ended period and never while the vote is open (the voting service does not gate it).
   * A held payload is re-requested every {@link VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS} for at most
   * {@link VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS} requests, so the released results replace it without a reload.
   */
  private initResults(): Signal<VoteResultsResponse | null> {
    return toSignal(
      toObservable(this.endedVoteUid).pipe(
        distinctUntilChanged(),
        tap((uid) => {
          this.resultsError.set(false);
          this.resultsLoading.set(!!uid);
        }),
        switchMap((uid) =>
          uid
            ? this.loadResults(uid).pipe(
                expand((results, index) =>
                  results?.results_held === true && index + 1 < VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS
                    ? timer(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS).pipe(switchMap(() => this.loadResults(uid)))
                    : EMPTY
                ),
                tap(() => this.resultsLoading.set(false))
              )
            : of(null)
        )
      ),
      { initialValue: null }
    );
  }

  private loadResults(uid: string): Observable<VoteResultsResponse | null> {
    return this.voteService.getVoteResults(uid).pipe(
      catchError((error) => {
        console.error('Failed to load vote results for the presenter', error);
        this.resultsError.set(true);
        return of(null);
      })
    );
  }

  private initPhase(): Signal<VotePresenterPhase> {
    return computed(() => {
      const vote = this.vote();
      if (!vote) return this.failures() > 0 ? 'error' : 'loading';
      if (vote.status === PollStatus.ENDED) return 'ended';
      if (vote.status === PollStatus.DISABLED || this.participation()?.state === VoteRowParticipationState.NO_ELECTORATE) return 'empty';
      return this.failures() > 0 ? 'reconnecting' : 'active';
    });
  }

  private initCountParts(): Signal<VotePresenterCountParts> {
    return computed(() => {
      const p = this.participation();
      if (!p) return { value: '', rest: '' };
      switch (p.state) {
        case VoteRowParticipationState.PROGRESS:
          return { value: String(p.responses), rest: `of ${p.invited} voters have cast` };
        case VoteRowParticipationState.COUNT_ONLY:
          return { value: String(p.responses), rest: 'voters have cast' };
        default:
          return { value: '', rest: 'Count unavailable' };
      }
    });
  }
}
