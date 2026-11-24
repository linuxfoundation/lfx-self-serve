// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { VoteOverviewOutcome } from '@lfx-one/shared/interfaces';
import { joinNames } from '@lfx-one/shared/utils';
import { OrdinalPipe } from '@pipes/ordinal.pipe';

/**
 * Final outcome of an ended ranked question on the vote detail Overview card (#6124). `full` renders the winner banner,
 * how it was decided and the runner-up standings; `compact` (multi-question votes) one line with the names and a label
 * tag. A tie or no winner is slate, never winner-styled, and the label always names the result in words.
 */
@Component({
  selector: 'lfx-vote-overview-outcome',
  imports: [TagComponent, OrdinalPipe],
  templateUrl: './vote-overview-outcome.component.html',
  host: { class: 'block' },
})
export class VoteOverviewOutcomeComponent {
  // === Inputs ===
  public readonly outcome = input.required<VoteOverviewOutcome>();
  public readonly variant = input<'full' | 'compact'>('full');
  /** Accessible name of the outcome region, e.g. "Q2 outcome" when several questions are listed. */
  public readonly ariaLabel = input<string>('Outcome');

  // === Computed Signals ===
  protected readonly isWinner: Signal<boolean> = computed(() => this.outcome().result === 'winner');
  protected readonly isTie: Signal<boolean> = computed(() => this.outcome().result === 'tie');
  protected readonly iconClass: Signal<string> = this.initIconClass();
  protected readonly tagSeverity: Signal<'success' | 'secondary'> = computed(() => (this.isWinner() ? 'success' : 'secondary'));
  /** Winner, elected or tied names, or the no-winner sentence. */
  protected readonly names: Signal<string> = computed(() =>
    this.outcome().result === 'none' ? 'No winner could be determined' : joinNames(this.outcome().winnerTexts)
  );

  // === Private Initializers ===
  private initIconClass(): Signal<string> {
    return computed(() => {
      if (this.isWinner()) return 'fa-light fa-trophy text-emerald-700';
      if (this.isTie()) return 'fa-light fa-scale-balanced text-slate-500';
      return 'fa-light fa-circle-question text-slate-500';
    });
  }
}
