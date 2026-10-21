// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { VOTE_METHOD_LABELS } from '@lfx-one/shared/constants';
import { Vote } from '@lfx-one/shared/interfaces';
import { formatVoteDeadline, getUserTimezone, getVoteVisibilityRules, normalizePollStatus } from '@lfx-one/shared/utils';

/**
 * Side cards of the vote detail page (#3913): "Vote details" (group, dates, method, electorate, ballot privacy,
 * comments) and "Visibility at a glance" — who sees what today, from the shared voter visibility rules. Presentational.
 */
@Component({
  selector: 'lfx-vote-detail-facts',
  imports: [CardComponent],
  templateUrl: './vote-detail-facts.component.html',
})
export class VoteDetailFactsComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly vote = input.required<Vote>();
  public readonly audience = input<'voter' | 'creator'>('voter');

  // Resolved once per browser session — SSR has no `Intl` zone, so dates fall back to UTC there.
  private readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  protected readonly isEnded: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ENDED);
  protected readonly openedText: Signal<string> = computed(() => {
    const created = this.vote().creation_time;
    return created ? formatVoteDeadline(created, this.viewerTimezone) : '—';
  });
  protected readonly closeText: Signal<string> = computed(() => {
    const end = this.vote().end_time;
    return end ? formatVoteDeadline(end, this.viewerTimezone) : '—';
  });
  protected readonly methodLabel: Signal<string> = computed(() => {
    const pollType = this.vote().poll_type ?? PollType.GENERIC;
    return VOTE_METHOD_LABELS[pollType] || pollType;
  });
  protected readonly electorateText: Signal<string> = computed(() => {
    const invited = this.vote().total_voting_request_invitations;
    if (invited === undefined || invited === null) return '—';
    return `${invited} invited ${invited === 1 ? 'voter' : 'voters'}`;
  });
  protected readonly privacyText: Signal<string> = computed(() => (this.vote().pseudo_anonymity ? 'Pseudo-anonymous' : 'Named'));
  protected readonly commentsText: Signal<string> = computed(() => {
    const prompts = this.vote().poll_comment_prompts?.length ?? 0;
    if (prompts === 0) return 'Not enabled';
    return `Optional · ${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}`;
  });
  protected readonly visibilityRules: Signal<string[]> = computed(() =>
    getVoteVisibilityRules(this.audience(), !!this.vote().pseudo_anonymity, this.isActive())
  );
}
