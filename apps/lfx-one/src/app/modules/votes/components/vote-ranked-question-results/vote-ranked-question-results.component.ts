// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { RankedQuestionView } from '@lfx-one/shared/interfaces';

/** Ranked-choice breakdown for one question. `creator` adds test ids, empty states and the round-summary banner; `voter` renders the rank rows only. */
@Component({
  selector: 'lfx-vote-ranked-question-results',
  templateUrl: './vote-ranked-question-results.component.html',
  host: { class: 'contents' },
})
export class VoteRankedQuestionResultsComponent {
  // === Inputs ===
  public readonly question = input.required<RankedQuestionView>();
  public readonly variant = input<'creator' | 'voter'>('creator');
  /** Turns each choice's Rank 1 count into a link to the voters who ranked it first — vote managers on named votes only (#3914). */
  public readonly showVoterLinks = input<boolean>(false);

  // === Outputs ===
  /** `<question_id>:<choice_id>` of the choice whose first-choice voters were asked for. */
  public readonly viewVoters = output<string>();

  // === Computed Signals ===
  protected readonly isCreator: Signal<boolean> = computed(() => this.variant() === 'creator');

  // === Protected Methods ===
  protected onViewVoters(choiceId: string): void {
    this.viewVoters.emit(`${this.question().questionId}:${choiceId}`);
  }
}
