// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, input, output, PLATFORM_ID, signal, Signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { VOTE_METHOD_LABELS } from '@lfx-one/shared/constants';
import { Vote, VoteDetailTab, VoteDetailTabOption } from '@lfx-one/shared/interfaces';
import { formatVoteDeadline, getUserTimezone, getVoteEndedEarlyDetailTooltip, isVoteEndedEarly, normalizePollStatus } from '@lfx-one/shared/utils';
import { DueDateLabelColorPipe } from '@pipes/due-date-label-color.pipe';
import { DueDateLabelPipe } from '@pipes/due-date-label.pipe';
import { LongTimezonePipe } from '@pipes/long-timezone.pipe';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';
import { TooltipModule } from 'primeng/tooltip';

import { VoteSendBallotsComponent } from '../vote-send-ballots/vote-send-ballots.component';

/**
 * Header card of the vote detail page (#3913): back link, title, status and privacy tags, group, method, close date,
 * invited voters, the page actions and the pill tab strip. Presentational — the page owns access, state and navigation.
 */
@Component({
  selector: 'lfx-vote-detail-header',
  imports: [
    NgClass,
    ButtonComponent,
    CardComponent,
    TagComponent,
    TooltipModule,
    VoteSendBallotsComponent,
    DueDateLabelColorPipe,
    LongTimezonePipe,
    PollStatusLabelPipe,
    PollStatusSeverityPipe,
  ],
  providers: [DueDateLabelPipe],
  templateUrl: './vote-detail-header.component.html',
})
export class VoteDetailHeaderComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dueDateLabelPipe = inject(DueDateLabelPipe);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  public readonly audience = input<'voter' | 'creator'>('voter');
  public readonly activeTab = input.required<VoteDetailTab>();
  public readonly tabs = input.required<readonly VoteDetailTabOption[]>();
  /** Active vote awaiting the viewer's ballot — shows Cast vote. */
  public readonly canCastVote = input<boolean>(false);
  /** Manager on an active or ended vote — shows Present and Copy slide. The presenter route re-checks `vote#writer`. */
  public readonly canPresent = input<boolean>(false);
  /** Manager on an active vote — shows Send ballots now (#4363). The BFF re-checks `vote#writer`. */
  public readonly canSendBallots = input<boolean>(false);
  /** Copy slide is exporting its image, so the button shows a spinner and ignores clicks. */
  public readonly slideBusy = input<boolean>(false);
  /**
   * Shows only the title, status and back navigation (#4330) until manager access or a successful,
   * non-removed invitation lookup for this vote is verified, including loading and failed-lookup states.
   */
  public readonly limited = input<boolean>(false);

  // === Outputs ===
  public readonly tabChange = output<VoteDetailTab>();
  public readonly sendReminder = output<void>();
  public readonly castVote = output<void>();
  public readonly present = output<void>();
  public readonly copySlide = output<void>();
  public readonly viewResults = output<void>();
  public readonly back = output<void>();

  // === View Children ===
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  // Resolved once per browser session — SSR has no `Intl` zone, so the close date falls back to UTC there.
  protected readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Clock State ===
  private readonly countdownTick = signal(0);
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  protected readonly canSendReminder: Signal<boolean> = computed(() => this.audience() === 'creator' && this.isActive());
  protected readonly methodLabel: Signal<string> = computed(() => {
    const pollType = this.vote().poll_type ?? PollType.GENERIC;
    return VOTE_METHOD_LABELS[pollType] || pollType;
  });
  protected readonly privacyLabel: Signal<string> = this.initPrivacyLabel();
  /** The instant shown in the close date: the early end for a vote that ended, otherwise the scheduled deadline. */
  protected readonly closeTime: Signal<string | undefined> = computed(() => {
    const vote = this.vote();
    return normalizePollStatus(vote.status) === PollStatus.ENDED ? vote.early_end_time || vote.end_time : vote.end_time;
  });
  protected readonly closeDateText: Signal<string> = this.initCloseDateText();
  protected readonly timeRemainingText: Signal<string> = this.initTimeRemainingText();
  protected readonly endedEarlyNote: Signal<string | null> = this.initEndedEarlyNote();
  protected readonly invitedText: Signal<string | null> = this.initInvitedText();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.vote)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.refreshCountdownClock());
      this.destroyRef.onDestroy(() => clearTimeout(this.countdownTimer));
    }
  }

  // === Protected Methods ===
  /**
   * WAI-ARIA tabs keyboard model: arrows wrap, Home/End jump to the ends, and focus follows the selected tab. Arrows move
   * from the focused pill, since `activeTab` only updates once the parent's `?tab=` navigation settles.
   */
  protected onTabKeydown(event: KeyboardEvent): void {
    const keys = this.tabs().map((tab) => tab.key);
    const focusedIdx = this.tabBtns().findIndex((btn) => btn.nativeElement === event.target);
    const idx = focusedIdx >= 0 ? focusedIdx : keys.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % keys.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + keys.length) % keys.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = keys.length - 1;
    if (next === null) return;
    event.preventDefault();
    this.tabChange.emit(keys[next]);
    if (isPlatformBrowser(this.platformId)) {
      this.tabBtns()[next]?.nativeElement.focus();
    }
  }

  // === Private Initializers ===
  private initPrivacyLabel(): Signal<string> {
    return computed(() => {
      const privacy = this.vote().pseudo_anonymity;
      if (privacy === undefined || privacy === null) return 'Ballot privacy unavailable';
      return privacy ? 'Pseudo-anonymous ballot' : 'Named ballot';
    });
  }

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
