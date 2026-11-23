// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { CondorcetOutcome } from '@lfx-one/shared/enums';
import { CondorcetQuestionView } from '@lfx-one/shared/interfaces';
import { joinNames } from '@lfx-one/shared/utils';

/**
 * Condorcet IRV results for one question (#5969), ported from PCC's condorcet-poll-result: how the voting service
 * decided the winner, standings, the pairwise comparison table, the ballot ranking distribution and the candidate rank
 * summary. While the vote is open the outcome and standings give way to an in-progress note; the tables show live counts.
 */
@Component({
  selector: 'lfx-vote-condorcet-results',
  imports: [TagComponent],
  templateUrl: './vote-condorcet-results.component.html',
  host: { class: 'contents' },
})
export class VoteCondorcetResultsComponent {
  // === Inputs ===
  public readonly question = input.required<CondorcetQuestionView>();
  /** One-based position in a multi-question Results view; omit for an unnumbered heading. */
  public readonly questionNumber = input<number>();
  public readonly isClosed = input.required<boolean>();
  /** Named ballots are still loading, so the ballot section waits instead of saying they aren't available. */
  public readonly ballotsLoading = input<boolean>(false);

  // === Computed Signals ===
  protected readonly outcomeMessage: Signal<string> = this.initOutcomeMessage();
  protected readonly hasWinner: Signal<boolean> = computed(
    () => this.question().outcome === CondorcetOutcome.CONDORCET_WINNER || this.question().outcome === CondorcetOutcome.IRV_WINNER
  );
  protected readonly isTie: Signal<boolean> = computed(() => this.question().outcome === CondorcetOutcome.TIE);

  // === Protected Methods ===
  /** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
  protected ordinal(rank: number): string {
    const lastTwo = rank % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${rank}th`;
    switch (rank % 10) {
      case 1:
        return `${rank}st`;
      case 2:
        return `${rank}nd`;
      case 3:
        return `${rank}rd`;
      default:
        return `${rank}th`;
    }
  }

  // === Private Initializers ===
  private initOutcomeMessage(): Signal<string> {
    return computed(() => {
      const { outcome, winnerNames } = this.question();
      switch (outcome) {
        case CondorcetOutcome.CONDORCET_WINNER:
          return `${winnerNames[0]} is the winner, having defeated all other candidates in head-to-head matchups.`;
        case CondorcetOutcome.IRV_WINNER:
          return `No candidate beat every other candidate head-to-head, so instant-runoff elimination decided the result. ${winnerNames[0]} is declared the winner after the IRV elimination process.`;
        case CondorcetOutcome.TIE:
          return `There is a tie between ${joinNames(winnerNames)}. No single winner can be determined.`;
        default:
          return 'No winner could be determined.';
      }
    });
  }
}
