// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, formatDate, isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, LOCALE_ID, PLATFORM_ID, signal, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import {
  VOTE_CLOSE_CONFIRMATION,
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
import { createHeldResults } from '@shared/utils/held-results.util';
import { createLiveSnapshot } from '@shared/utils/live-snapshot.util';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { map, timer } from 'rxjs';

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
    ConfirmDialogModule,
    NgTemplateOutlet,
    VoteQrComponent,
    VoteRankedQuestionResultsComponent,
    VoteSendBallotsComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './vote-presenter.component.html',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class VotePresenterComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly voteService = inject(VoteService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isBrowser = isPlatformBrowser(this.platformId);
  protected readonly PollStatus = PollStatus;

  // === Route Params ===
  protected readonly voteId: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('id'))), { initialValue: null });

  // === Writable Signals ===
  private readonly locale = inject(LOCALE_ID);
  protected readonly nowMs = signal(Date.now());
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  /** True while the end request is in flight. */
  private readonly endInFlight = signal(false);
  /** The poll generation the end request's forced restart started; only a result from that generation or later settles the close. */
  private readonly awaitingGeneration = signal<number | null>(null);
  /** True while a presenter confirmation (Exit or Close) is up, so Esc cancels the dialog and never starts another action. */
  protected readonly confirmOpen = signal(false);
  /** The Send ballots child owns its own dialog; its `confirming` flag tells Esc to stay out of the way (undefined once the child is destroyed). */
  private readonly sendBallots = viewChild(VoteSendBallotsComponent);

  // === Live Data ===
  private readonly live = createLiveSnapshot({
    key: this.voteId,
    // Polls omit include_writer: the guard read it once for this session, so no FGA lookup per 5s tick. They also keep running
    // after `ended`, so a vote another manager reopens flips back to the open state; /results is still requested once per ended period.
    fetch: (id) => this.voteService.fetchVote(id, { uncached: true }),
    doc: this.doc,
    intervalMs: VOTE_PRESENTER_POLL_INTERVAL_MS,
    backoffBaseMs: VOTE_PRESENTER_BACKOFF_BASE_MS,
    backoffMaxMs: VOTE_PRESENTER_BACKOFF_MAX_MS,
    enabled: this.isBrowser,
  });
  private readonly snapshot = computed(() => {
    const live = this.live.snapshot();
    return live ? { vote: live.value, receivedAtMs: live.receivedAtMs } : null;
  });
  private readonly failures = this.live.failures;

  // === Computed Signals ===
  /** True from the confirmed Close until the request fails or the next poll lands, so the button cannot be double-fired. */
  protected readonly closing = computed(() => {
    const awaiting = this.awaitingGeneration();
    return this.endInFlight() || (awaiting !== null && this.live.landedGeneration() < awaiting);
  });
  protected readonly vote = computed(() => this.snapshot()?.vote ?? null);
  /** Set only while the vote is ended; a reopen drops it to null so `/results` is requested once per ended period. */
  private readonly endedVoteUid = computed(() => {
    const vote = this.vote();
    return vote?.status === PollStatus.ENDED ? vote.uid : null;
  });
  /**
   * `/results` is requested once per ended period and never while the vote is open (the voting service does not gate it).
   * A held payload is re-requested every {@link VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS} for at most
   * {@link VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS} requests, so the released results replace it without a reload.
   */
  private readonly heldResults = createHeldResults<VoteResultsResponse>({
    key: this.endedVoteUid,
    load: (uid) => this.voteService.getVoteResults(uid),
    isHeld: (results) => results.results_held === true,
    retryMs: VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS,
    maxAttempts: VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS,
    errorMessage: 'Failed to load vote results for the presenter',
  });
  private readonly results: Signal<VoteResultsResponse | null> = this.heldResults.results;
  protected readonly resultsError = this.heldResults.error;
  protected readonly resultsLoading = this.heldResults.loading;
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
  /** Exit asks first only while the vote is live; the result, empty, error and loading screens leave at once. */
  protected readonly confirmsExit = computed(() => this.phase() === 'active' || this.phase() === 'reconnecting');
  /** The presenter route is writer-guarded (`votePresenterGuard`), so being here means the caller can end the vote; the BFF re-checks. */
  protected readonly canClose = computed(() => this.vote()?.status === PollStatus.ACTIVE && !this.closing());
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
  private confirmHiddenTimer: ReturnType<typeof setTimeout> | null = null;
  /** The element focused when a confirmation opened, so focus returns to the triggering button when it closes. */
  private returnFocusTo: HTMLElement | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      if (this.confirmHiddenTimer) clearTimeout(this.confirmHiddenTimer);
    });
    if (this.isBrowser) {
      timer(VOTE_PRESENTER_CLOCK_TICK_MS, VOTE_PRESENTER_CLOCK_TICK_MS)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.nowMs.set(Date.now()));
    }
  }

  // === Protected Methods ===
  /** Exit asks first while the vote is live ("Stay" is the default focus); otherwise it leaves immediately. */
  protected exit(): void {
    const id = this.voteId();
    if (!this.confirmsExit() || !id) {
      this.leave(id);
      return;
    }
    this.openConfirm({
      header: 'Leave presenter',
      message: 'Leave the presenter? The vote stays open.',
      acceptLabel: 'Leave',
      rejectLabel: 'Stay',
      defaultFocus: 'reject',
      acceptButtonStyleClass: 'p-button-info p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: this.acceptFor(id, (uid) => this.leave(uid)),
    });
  }

  /** Esc is Exit, except while any confirmation is open, where PrimeNG's own handler cancels the dialog and this does nothing. */
  protected onEscape(): void {
    if (this.confirmOpen() || this.sendBallots()?.confirming()) return;
    this.exit();
  }

  /** Called a tick after a dialog hides, so the Esc keydown that closed it is still seen as "dialog open" by `onEscape`. */
  protected onConfirmHidden(): void {
    if (this.confirmHiddenTimer) clearTimeout(this.confirmHiddenTimer);
    this.confirmHiddenTimer = setTimeout(() => {
      this.confirmOpen.set(false);
      this.restoreFocus();
    });
  }

  /** Close vote: always asks first. Nothing is sent until the dialog is accepted. */
  protected onCloseClick(): void {
    const id = this.voteId();
    if (!id || !this.canClose()) return;
    this.openConfirm({
      ...VOTE_CLOSE_CONFIRMATION,
      accept: this.acceptFor(id, (uid) => this.endVote(uid)),
    });
  }

  /** Restarts the poll loop from the error state without waiting out the backoff. */
  protected retry(): void {
    this.live.restart(true);
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

  /**
   * Ends the vote through the dedicated end action (never extend). On success the poll loop is restarted so the very next
   * GET decides the state: the presenter moves to the result state only when that GET returns `ended`, and `/results` is
   * then requested once by `createHeldResults`, exactly as for a vote that ended on its own.
   */
  private endVote(id: string): void {
    if (this.closing()) return;

    this.endInFlight.set(true);
    this.voteService.endVote(id).subscribe({
      next: () => {
        this.awaitingGeneration.set(this.live.restart());
        this.endInFlight.set(false);
      },
      error: (error: unknown) => {
        this.endInFlight.set(false);
        this.messageService.add({ severity: 'error', summary: 'Unable to close the vote', detail: this.endErrorDetail(error), life: 8000 });
      },
    });
  }

  /**
   * Hands focus back to the element that opened the dialog. After an accept that element can be disabled (Close while the
   * request is in flight) or gone (the phase changed under the dialog), so focus falls back to the current Exit button.
   */
  private restoreFocus(): void {
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (target?.isConnected && !(target as HTMLButtonElement).disabled) {
      target.focus();
      return;
    }
    this.doc.querySelector<HTMLElement>('[data-testid="vote-presenter-exit"] button')?.focus();
  }

  private leave(id: string | null): void {
    void this.router.navigateByUrl(id ? votePermalinkPath(id) : '/votes');
  }

  private openConfirm(options: Confirmation): void {
    const active = this.doc.activeElement;
    this.returnFocusTo = active instanceof HTMLElement ? active : null;
    // A voter-list request still loading in Send ballots must not open its dialog over this one.
    this.sendBallots()?.abandon();
    this.confirmOpen.set(true);
    this.confirmationService.confirm(options);
  }

  /**
   * Binds a confirmation's accept to the vote it was opened for: if the route has moved to another vote while the dialog
   * was up, the accept is dropped (no request, no toast) so it can never act on the wrong vote.
   */
  private acceptFor(id: string, action: (uid: string) => void): () => void {
    return () => {
      if (id === this.voteId()) action(id);
    };
  }

  /** The upstream message when the voting service answered (for example "poll has not started"), a plain fallback otherwise. */
  private endErrorDetail(error: unknown): string {
    const body = error instanceof HttpErrorResponse ? (error.error as { error?: unknown } | null) : null;
    return typeof body?.error === 'string' && body.error ? body.error : "We couldn't confirm the vote was closed. Please try again.";
  }
}
