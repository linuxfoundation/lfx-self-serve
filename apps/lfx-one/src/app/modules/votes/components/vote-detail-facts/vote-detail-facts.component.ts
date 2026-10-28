// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { PollStatus } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { formatVoteDeadline, getUserTimezone, getVoteVisibilityRules, normalizePollStatus } from '@lfx-one/shared/utils';
import { PopoverModule } from 'primeng/popover';

/**
 * Side cards of the vote detail page (#3913): "Vote details" (created date and comments — every other fact lives in the
 * page header, #4449) and "Visibility at a glance" — one headline line, with every voter visibility rule in a popover.
 * Presentational.
 */
@Component({
  selector: 'lfx-vote-detail-facts',
  imports: [ButtonComponent, CardComponent, PopoverModule],
  templateUrl: './vote-detail-facts.component.html',
})
export class VoteDetailFactsComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  public readonly audience = input<'voter' | 'creator'>('voter');
  /** The page includes prompts recovered from authorized results; standalone callers fall back to vote metadata. */
  public readonly commentPromptCount = input<number | null>(null);
  /** Totals and comments can remain held after close while upstream finalizes them. */
  public readonly resultsHeld = input<boolean>(false);

  // Resolved once per browser session — SSR has no `Intl` zone, so dates fall back to UTC there.
  private readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Computed Signals ===
  protected readonly isEnded: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ENDED);
  /** `creation_time` — for a draft opened later this is when it was saved, so the row reads "Created", not "Opened". */
  protected readonly createdText: Signal<string> = computed(() => {
    const created = this.vote().creation_time;
    return created ? formatVoteDeadline(created, this.viewerTimezone) : '—';
  });
  protected readonly commentsText: Signal<string> = computed(() => {
    const prompts = this.commentPromptCount() ?? this.vote().poll_comment_prompts?.length ?? 0;
    if (prompts === 0) return 'Not enabled';
    return `Optional · ${prompts} ${prompts === 1 ? 'question' : 'questions'}`;
  });
  protected readonly visibilityRules: Signal<string[]> = this.initVisibilityRules();
  /** The audience-specific first rule; the popover lists every rule including this one. */
  protected readonly visibilityHeadline: Signal<string> = computed(() => this.visibilityRules()[0] ?? '');

  // === Private Initializers ===
  private initVisibilityRules(): Signal<string[]> {
    return computed(() => {
      const status = normalizePollStatus(this.vote().status);
      const ballotsAvailable = status === PollStatus.ACTIVE || status === PollStatus.ENDED;
      return getVoteVisibilityRules(this.audience(), this.vote().pseudo_anonymity, this.isEnded(), ballotsAvailable, this.resultsHeld());
    });
  }
}
