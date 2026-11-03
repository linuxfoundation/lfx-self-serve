// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, ElementRef, inject, input, output, PLATFORM_ID, Signal, viewChildren } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus } from '@lfx-one/shared/enums';
import { Vote, VoteDetailTab, VoteDetailTabOption } from '@lfx-one/shared/interfaces';
import { getVoteVisibilityRules, normalizePollStatus } from '@lfx-one/shared/utils';
import { PollStatusLabelPipe } from '@pipes/poll-status-label.pipe';
import { PollStatusSeverityPipe } from '@pipes/poll-status-severity.pipe';

import { VoteSendBallotsComponent } from '../vote-send-ballots/vote-send-ballots.component';

/**
 * Header card of the vote detail page (#3913): back link, title, status and privacy tags, the page actions and the pill
 * tab strip. Group, method, close date and invited voters live in the Vote details card (#5022). Presentational — the
 * page owns access, state and navigation.
 */
@Component({
  selector: 'lfx-vote-detail-header',
  imports: [NgClass, ButtonComponent, CardComponent, TagComponent, VoteSendBallotsComponent, PollStatusLabelPipe, PollStatusSeverityPipe],
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
  /** Totals and comments can remain held after close while upstream finalizes them; changes the visibility tooltip. */
  public readonly resultsHeld = input<boolean>(false);

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

  // === Computed Signals ===
  protected readonly isActive: Signal<boolean> = computed(() => normalizePollStatus(this.vote().status) === PollStatus.ACTIVE);
  protected readonly canSendReminder: Signal<boolean> = computed(() => this.audience() === 'creator' && this.isActive());
  protected readonly privacyLabel: Signal<string> = this.initPrivacyLabel();
  protected readonly visibilityText: Signal<string> = this.initVisibilityText();

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

  /** Every voter visibility rule, joined for the privacy tag's tooltip (hover and keyboard focus). */
  private initVisibilityText(): Signal<string> {
    return computed(() => {
      const vote = this.vote();
      const status = normalizePollStatus(vote.status);
      const ended = status === PollStatus.ENDED;
      const ballotsAvailable = status === PollStatus.ACTIVE || ended;
      return getVoteVisibilityRules(this.audience(), vote.pseudo_anonymity, ended, ballotsAvailable, this.resultsHeld()).join(' ');
    });
  }
}
