// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
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

  // === Computed Signals ===
  protected readonly isCreator: Signal<boolean> = computed(() => this.variant() === 'creator');
}
