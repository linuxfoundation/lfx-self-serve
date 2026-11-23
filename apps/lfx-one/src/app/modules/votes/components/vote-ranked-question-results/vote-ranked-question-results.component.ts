// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { RankedOutcomeCopy, RankedQuestionView, RankedStanding, RankedStandingRow } from '@lfx-one/shared/interfaces';
import { joinNames } from '@lfx-one/shared/utils';

/**
 * Ranked-choice breakdown for one question: the final outcome banner and standings (when `showOutcome`), then the rank
 * distribution. `creator` adds test ids and empty states; `voter` renders the same content without them.
 */
@Component({
  selector: 'lfx-vote-ranked-question-results',
  templateUrl: './vote-ranked-question-results.component.html',
  host: { class: 'contents' },
})
export class VoteRankedQuestionResultsComponent {
  // === Inputs ===
  public readonly question = input.required<RankedQuestionView>();
  /** One-based position in a multi-question Results view; omit for an unnumbered heading. */
  public readonly questionNumber = input<number>();
  public readonly variant = input<'creator' | 'voter'>('creator');
  /** Turns each choice's Rank 1 count into a link to the voters who ranked it first — vote managers on named votes only (#3914). */
  public readonly showVoterLinks = input<boolean>(false);
  /** Render the final outcome banner and standings — callers pass true only for ended, final results. */
  public readonly showOutcome = input<boolean>(false);

  // === Outputs ===
  /** `<question_id>:<choice_id>` of the choice whose first-choice voters were asked for. */
  public readonly viewVoters = output<string>();

  // === Computed Signals ===
  protected readonly isCreator: Signal<boolean> = computed(() => this.variant() === 'creator');
  /** Outcome banner sentence split around the bolded winner names; null without an outcome. */
  protected readonly outcomeCopy: Signal<RankedOutcomeCopy | null> = this.initOutcomeCopy();
  /** Standings rows with their rank and status text. */
  protected readonly standingRows: Signal<RankedStandingRow[]> = computed(() =>
    this.question().standings.map((row) => ({ ...row, rankText: this.ordinal(row.rank), statusText: this.standingLabel(row) }))
  );

  // === Protected Methods ===
  protected onViewVoters(choiceId: string): void {
    this.viewVoters.emit(`${this.question().questionId}:${choiceId}`);
  }

  // === Private Initializers ===
  private initOutcomeCopy(): Signal<RankedOutcomeCopy | null> {
    return computed(() => {
      const outcome = this.question().outcome;
      if (!outcome) return null;

      const names = joinNames(outcome.winnerTexts);
      const rounds = outcome.roundCount;
      const roundsText = rounds === 1 ? '1 round' : `${rounds} rounds`;
      if (outcome.result === 'none') return { lead: 'No winner could be determined.', names: '', tail: '' };
      if (outcome.kind === 'meek_stv') {
        const verb = outcome.winnerTexts.length === 1 ? 'was' : 'were';
        return { lead: '', names, tail: ` ${verb} elected by meeting the quota through proportional vote transfers.` };
      }
      if (outcome.result === 'tie') return { lead: '', names, tail: ' are tied. No single winner could be determined.' };
      if (outcome.kind === 'condorcet') return { lead: '', names, tail: ' is the winner, having defeated every other candidate in head-to-head matchups.' };
      if (outcome.condorcetFallback) {
        return {
          lead: 'No candidate beat every other candidate head-to-head, so the vote went to instant-runoff elimination. ',
          names,
          tail: rounds > 0 ? ` is the winner after ${roundsText}.` : ' is the winner.',
        };
      }
      return {
        lead: '',
        names,
        tail:
          rounds > 0 ? ` is the winner, with a majority of continuing ballots in round ${rounds}.` : ' is the winner, with a majority of continuing ballots.',
      };
    });
  }

  // === Private Helpers ===
  /** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
  private ordinal(rank: number): string {
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

  /** Right-aligned status for a standings row; null for a row with nothing to add (a runoff survivor). */
  private standingLabel(row: RankedStanding): string | null {
    switch (row.label) {
      case 'winner':
        return 'Winner';
      case 'tied':
        return 'Tied';
      case 'eliminated':
        return row.round !== null ? `Eliminated in round ${row.round}` : 'Eliminated';
      case 'elected':
        return row.round !== null ? `Elected in round ${row.round}` : 'Elected';
      case 'not_elected':
        return 'Not elected';
      default:
        return null;
    }
  }
}
