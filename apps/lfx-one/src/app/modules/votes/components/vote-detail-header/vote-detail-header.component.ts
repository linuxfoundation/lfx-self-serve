// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, ElementRef, inject, input, output, PLATFORM_ID, Signal, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { VOTE_METHOD_LABELS } from '@lfx-one/shared/constants';
import { Vote, VoteDetailTab, VoteDetailTabOption } from '@lfx-one/shared/interfaces';
import { formatVoteDeadline, getUserTimezone, getVoteEndedEarlyDetailTooltip, isVoteEndedEarly, normalizePollStatus } from '@lfx-one/shared/utils';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';

/**
 * Header card of the vote detail page (#3913): back link, title, status and privacy tags, group, method, close date,
 * invited voters, the page actions and the pill tab strip. Presentational — the page owns access, state and navigation.
 */
@Component({
  selector: 'lfx-vote-detail-header',
  imports: [NgClass, ButtonComponent, CardComponent, TagComponent, PollStatusLabelPipe, PollStatusSeverityPipe],
  templateUrl: './vote-detail-header.component.html',
})
export class VoteDetailHeaderComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  public readonly audience = input<'voter' | 'creator'>('voter');
  public readonly activeTab = input.required<VoteDetailTab>();
  public readonly tabs = input.required<readonly VoteDetailTabOption[]>();
  /** Active vote awaiting the viewer's ballot — shows Cast vote. */
  public readonly canCastVote = input<boolean>(false);
  /**
   * Shows only the title, status and back navigation (#4330) until manager access or a successful,
   * non-removed invitation lookup for this vote is verified, including loading and failed-lookup states.
   */
  public readonly limited = input<boolean>(false);

  // === Outputs ===
  public readonly tabChange = output<VoteDetailTab>();
  public readonly sendReminder = output<void>();
  public readonly castVote = output<void>();
  public readonly viewResults = output<void>();
  public readonly back = output<void>();

  // === View Children ===
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  // Resolved once per browser session — SSR has no `Intl` zone, so the close date falls back to UTC there.
  private readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  protected readonly canSendReminder: Signal<boolean> = computed(() => this.audience() === 'creator' && this.isActive());
  protected readonly methodLabel: Signal<string> = computed(() => {
    const pollType = this.vote().poll_type ?? PollType.GENERIC;
    return VOTE_METHOD_LABELS[pollType] || pollType;
  });
  protected readonly privacyLabel: Signal<string> = this.initPrivacyLabel();
  protected readonly closeDateText: Signal<string> = this.initCloseDateText();
  protected readonly endedEarlyNote: Signal<string | null> = this.initEndedEarlyNote();
  protected readonly invitedText: Signal<string | null> = this.initInvitedText();

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
      if (!vote.end_time) return '';
      const deadline = formatVoteDeadline(vote.end_time, this.viewerTimezone);
      return normalizePollStatus(vote.status) === PollStatus.ENDED ? `Closed ${deadline}` : `Closes ${deadline}`;
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
}
