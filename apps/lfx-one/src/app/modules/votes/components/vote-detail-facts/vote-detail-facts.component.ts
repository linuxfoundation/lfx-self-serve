// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { VOTE_METHOD_LABELS } from '@lfx-one/shared/constants';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { formatVoteDeadline, getUserTimezone, getVoteEndedEarlyDetailTooltip, isVoteEndedEarly, normalizePollStatus } from '@lfx-one/shared/utils';
import { DueDateLabelColorPipe } from '@pipes/due-date-label-color.pipe';
import { DueDateLabelPipe } from '@pipes/due-date-label.pipe';
import { LongTimezonePipe } from '@pipes/long-timezone.pipe';
import { TooltipModule } from 'primeng/tooltip';

/**
 * "Vote details" side card of the vote detail page (#3913): created date, group, method, close date and countdown,
 * invited voters, and the voting-question and comment-prompt counts (#5022). Presentational.
 */
@Component({
  selector: 'lfx-vote-detail-facts',
  imports: [CardComponent, TooltipModule, DueDateLabelColorPipe, LongTimezonePipe],
  providers: [DueDateLabelPipe],
  templateUrl: './vote-detail-facts.component.html',
})
export class VoteDetailFactsComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dueDateLabelPipe = inject(DueDateLabelPipe);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  /** The page includes prompts recovered from authorized results; standalone callers fall back to vote metadata. */
  public readonly commentPromptCount = input<number | null>(null);

  // Resolved once per browser session — SSR has no `Intl` zone, so dates fall back to UTC there.
  protected readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Clock State ===
  private readonly countdownTick = signal(0);
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  /** `creation_time` — for a draft opened later this is when it was saved, so the row reads "Created", not "Opened". */
  protected readonly createdText: Signal<string> = computed(() => {
    const created = this.vote().creation_time;
    return created ? formatVoteDeadline(created, this.viewerTimezone) : '—';
  });
  protected readonly methodLabel: Signal<string> = computed(() => {
    const pollType = this.vote().poll_type ?? PollType.GENERIC;
    return VOTE_METHOD_LABELS[pollType] || pollType;
  });
  /** The instant shown in the close date: the early end for a vote that ended, otherwise the scheduled deadline. */
  protected readonly closeTime: Signal<string | undefined> = computed(() => {
    const vote = this.vote();
    return normalizePollStatus(vote.status) === PollStatus.ENDED ? vote.early_end_time || vote.end_time : vote.end_time;
  });
  protected readonly closeDateText: Signal<string> = this.initCloseDateText();
  protected readonly timeRemainingText: Signal<string> = this.initTimeRemainingText();
  protected readonly endedEarlyNote: Signal<string | null> = this.initEndedEarlyNote();
  protected readonly invitedText: Signal<string | null> = this.initInvitedText();
  /** Voting questions only — `null` when the metadata is missing, so the row shows a dash rather than claiming zero. */
  protected readonly voteQuestionCount: Signal<number | null> = computed(() => this.vote().poll_questions?.length ?? null);
  protected readonly resolvedCommentPromptCount: Signal<number> = computed(() => this.commentPromptCount() ?? this.vote().poll_comment_prompts?.length ?? 0);
  /** The comment configuration, not the vote's status or how many responses were written. */
  protected readonly commentsEnabled: Signal<boolean> = computed(() => this.resolvedCommentPromptCount() > 0);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.vote)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.refreshCountdownClock());
      this.destroyRef.onDestroy(() => clearTimeout(this.countdownTimer));
    }
  }

  // === Private Initializers ===
  private initCloseDateText(): Signal<string> {
    return computed(() => {
      const vote = this.vote();
      const ended = normalizePollStatus(vote.status) === PollStatus.ENDED;
      const endTime = this.closeTime();
      if (!endTime) return '';
      const deadline = formatVoteDeadline(endTime, this.viewerTimezone);
      return ended ? `Closed ${deadline}` : `Closes ${deadline}`;
    });
  }

  private initTimeRemainingText(): Signal<string> {
    return computed(() => {
      this.countdownTick();
      const endTime = this.vote().end_time;
      const deadline = new Date(endTime).getTime();
      if (!this.isActive() || Number.isNaN(deadline) || deadline <= Date.now()) return '';
      // Invoke the shared formatter on each clock invalidation, not a pure template pipe with unchanged inputs.
      return this.dueDateLabelPipe.transform(endTime, this.viewerTimezone);
    });
  }

  /** `end_time` stays the scheduled deadline when ITX ends a vote early, so say so — the same note as the votes table. */
  private initEndedEarlyNote(): Signal<string | null> {
    return computed(() => {
      const vote = this.vote();
      if (normalizePollStatus(vote.status) !== PollStatus.ENDED || !isVoteEndedEarly(vote)) return null;
      return getVoteEndedEarlyDetailTooltip(formatDate(vote.early_end_time!, 'MMM d, y', 'en-US'));
    });
  }

  private initInvitedText(): Signal<string | null> {
    return computed(() => {
      const invited = this.vote().total_voting_request_invitations;
      if (invited === undefined || invited === null) return null;
      return `${invited} invited ${invited === 1 ? 'voter' : 'voters'}`;
    });
  }

  /** Re-evaluate only at the next label boundary or exact deadline; vote changes replace the pending timeout. */
  private refreshCountdownClock(): void {
    clearTimeout(this.countdownTimer);
    this.countdownTick.update((tick) => tick + 1);
    const now = Date.now();
    const deadline = new Date(this.vote().end_time).getTime();
    if (!this.isActive() || !Number.isFinite(deadline) || deadline <= now) return;

    // In the browser viewerTimezone is the host zone; calendar midnight handles 23/25-hour DST days.
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    this.countdownTimer = setTimeout(() => this.refreshCountdownClock(), Math.min(deadline, midnight.getTime()) - now);
  }
}
