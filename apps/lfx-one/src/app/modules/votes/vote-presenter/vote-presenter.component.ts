// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, PLATFORM_ID, signal, Signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  VOTE_PRESENTER_BACKOFF_BASE_MS,
  VOTE_PRESENTER_BACKOFF_MAX_MS,
  VOTE_PRESENTER_CLOCK_TICK_MS,
  VOTE_PRESENTER_POLL_INTERVAL_MS,
} from '@lfx-one/shared/constants';
import { PollStatus, VoteRowParticipationState } from '@lfx-one/shared/enums';
import { RankedQuestionView, VotePresenterPhase, VotePresenterSnapshot, VoteResultsQuestion, VoteResultsResponse } from '@lfx-one/shared/interfaces';
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
import { exportVoteSlide, voteSlideFileName, VoteSlideExportResult } from '@shared/utils/vote-slide.util';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';
import { TooltipModule } from 'primeng/tooltip';
import { filter, map, switchMap, timer } from 'rxjs';

import { VoteAbstainResultComponent } from '../components/vote-abstain-result/vote-abstain-result.component';
import { VoteOptionResultsComponent } from '../components/vote-option-results/vote-option-results.component';
import { VoteParticipationCardComponent } from '../components/vote-participation-card/vote-participation-card.component';
import { VoteQrComponent } from '../components/vote-qr/vote-qr.component';
import { VoteRankedQuestionResultsComponent } from '../components/vote-ranked-question-results/vote-ranked-question-results.component';
import { VoteSlideComponent } from '../components/vote-slide/vote-slide.component';

/** How long the "Link copied" confirmation stays before the button label returns. */
const COPY_CONFIRMATION_MS = 2000;

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
    DatePipe,
    TooltipModule,
    VoteAbstainResultComponent,
    VoteOptionResultsComponent,
    VoteParticipationCardComponent,
    VoteQrComponent,
    VoteRankedQuestionResultsComponent,
    VoteSlideComponent,
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
  private readonly results = signal<VoteResultsResponse | null>(null);
  protected readonly resultsError = signal(false);
  protected readonly nowMs = signal(Date.now());
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  private readonly retryTick = signal(0);
  protected readonly slideState = signal<VoteSlideExportResult | 'busy' | null>(null);
  private readonly slideRef = viewChild<ElementRef<HTMLElement>>('slide');

  // === Computed Signals ===
  protected readonly vote = computed(() => this.snapshot()?.vote ?? null);
  protected readonly phase: Signal<VotePresenterPhase> = this.initPhase();
  protected readonly participation = computed(() => {
    const vote = this.vote();
    return vote ? computeVoteRowParticipation(vote) : null;
  });
  protected readonly countText = this.initCountText();
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
  protected readonly closeTooltip = computed(() => `Ending a vote early is coming; this vote ends at ${this.vote()?.end_time ?? 'its deadline'}`);
  protected readonly showAbstain = computed(() => this.vote()?.allow_abstain === true);
  protected readonly isRanked = computed(() => isRankedPollType(this.vote()?.poll_type));
  protected readonly stats = computed(() => computeVoteParticipationStats(this.results()));
  protected readonly questions: Signal<VoteResultsQuestion[]> = computed(() => buildVoteResultsQuestions(this.results(), true));
  protected readonly rankedQuestions: Signal<RankedQuestionView[]> = computed(() => buildRankedQuestionViews(this.results()));

  /** True once `/results` has been requested for the current ended period; reset when a reopen makes the vote active again. */
  private resultsRequested = false;
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.initResultsFetch();
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
      this.copyResetTimer = setTimeout(() => this.copied.set(false), COPY_CONFIRMATION_MS);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
    }
  }

  /** Exports the static slide (#4145): PNG to the clipboard where the browser allows, else a download. */
  protected async copySlide(): Promise<void> {
    const element = this.slideRef()?.nativeElement;
    const name = this.vote()?.name;
    if (!element || !name || this.slideState() === 'busy') return;
    this.slideState.set('busy');
    this.slideState.set(await exportVoteSlide(element, voteSlideFileName(name)));
  }

  // === Private Initializers ===
  private startPolling(): void {
    toObservable(computed(() => ({ id: this.voteId(), retry: this.retryTick() })))
      .pipe(
        map(({ id }) => id),
        filter((id): id is string => !!id),
        // Polls omit include_writer: the guard read it once for this session, so no FGA lookup per 5s tick.
        switchMap((id) =>
          createVisibilityPoll(this.doc, () => this.voteService.fetchVote(id, { skipCache: true }), {
            intervalMs: VOTE_PRESENTER_POLL_INTERVAL_MS,
            backoffBaseMs: VOTE_PRESENTER_BACKOFF_BASE_MS,
            backoffMaxMs: VOTE_PRESENTER_BACKOFF_MAX_MS,
            shouldContinue: (vote) => vote.status !== PollStatus.ENDED,
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

  private initResultsFetch(): void {
    effect(() => {
      const vote = this.vote();
      if (vote?.status !== PollStatus.ENDED) {
        // Active (or never loaded): results stay unrequested and any prior ended-period snapshot is dropped.
        this.resultsRequested = false;
        untracked(() => {
          this.results.set(null);
          this.resultsError.set(false);
        });
        return;
      }
      if (this.resultsRequested) return;
      this.resultsRequested = true;
      untracked(() =>
        this.voteService.getVoteResults(vote.uid).subscribe({
          next: (results) => this.results.set(results),
          error: () => this.resultsError.set(true),
        })
      );
    });
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

  private initCountText(): Signal<string> {
    return computed(() => {
      const p = this.participation();
      if (!p) return '';
      switch (p.state) {
        case VoteRowParticipationState.PROGRESS:
          return `${p.responses} of ${p.invited} voters have cast`;
        case VoteRowParticipationState.COUNT_ONLY:
          return `${p.responses} voters have cast`;
        default:
          return 'Count unavailable';
      }
    });
  }
}
